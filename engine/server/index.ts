/**
 * The engine server: the HTTP side of the code engine, as engine/shared/api.ts
 * describes it. One process serves every site the dashboard opens; each site gets a
 * working copy, a preview and an editing session (engine/server/sites.ts).
 *
 *   npm run engine                    starts it on ARMATURE_ENGINE_PORT (4400)
 *   createEngineServer(config)        the same server for tests, on any port
 *
 * Every reply is JSON. Handlers answer `{ ok: true, ... }` or `{ ok: false, message }`
 * with HTTP 200 so the editor always has something readable; only unknown routes
 * and the CORS preflight use other status codes.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { collectChanges, readDiff } from "../publish/changes.ts";
import { publishChanges } from "../publish/publish.ts";
import { head } from "../runner/preview.ts";
import type { OpenRequest, OpenResponse } from "../shared/api.ts";
import type { EditOp, EditResult, NodeRef } from "../shared/types.ts";
import { configFromEnv, type EngineConfig } from "./config.ts";
import { mockRepositoryFor, readCommitted, repositoryFor } from "./github.ts";
import { applyCors, BodyError, readJson, sendJson, stringField } from "./http.ts";
import { SiteError, SiteRegistry } from "./sites.ts";

export const ENGINE_VERSION = "0.1.0";

export type EngineServer = {
  /** Start listening; resolves with the port actually bound (0 picks a free one). */
  listen(port?: number): Promise<number>;
  /** Stop every preview and close the server. */
  close(): Promise<void>;
  /** The bound port, or null before listen(). */
  port(): number | null;
  sites: SiteRegistry;
};

type Body = Record<string, unknown>;
type Handler = (context: { body: Body; query: URLSearchParams }) => Promise<unknown> | unknown;

function statusOf(sites: SiteRegistry, id: string): OpenResponse {
  const state = sites.get(id);
  if (!state) return { ok: true, status: { phase: "idle" }, site: null };
  return { ok: true, status: state.status, site: state.info };
}

/** An EditResult with the stylesheets it touched, so the editor can reload them in the preview. */
function withCssChanged(result: EditResult): EditResult & { cssChanged?: string[] } {
  if (!result.ok) return result;
  const css = result.changed.filter((path) => path.toLowerCase().endsWith(".css"));
  return css.length > 0 ? { ...result, cssChanged: css } : result;
}

export function createEngineServer(config: EngineConfig): EngineServer {
  const sites = new SiteRegistry(config);
  const log = config.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const routes = new Map<string, Handler>();
  const route = (method: "GET" | "POST", path: string, handler: Handler) => routes.set(`${method} ${path}`, handler);

  route("GET", "/health", () => ({ ok: true, version: ENGINE_VERSION, github: config.github, sites: sites.ids() }));

  route("POST", "/sites/open", ({ body }) => {
    const request: OpenRequest = {
      site: stringField(body, "site"),
      repo: stringField(body, "repo"),
      branch: stringField(body, "branch"),
      ...(body["env"] && typeof body["env"] === "object" ? { env: body["env"] as Record<string, string> } : {}),
      ...(typeof body["token"] === "string" && body["token"] ? { token: body["token"] } : {}),
    };
    if (!/^[^/\s]+\/[^/\s]+$/.test(request.repo)) throw new BodyError(`"repo" must look like owner/name, not "${request.repo}".`);
    sites.open(request);
    return statusOf(sites, request.site);
  });

  route("GET", "/sites/status", ({ query }) => statusOf(sites, query.get("site") ?? ""));

  route("POST", "/sites/close", async ({ body }) => {
    const closed = await sites.close(stringField(body, "site"));
    return { ok: true, closed };
  });

  route("GET", "/sites/log", ({ query }) => {
    const state = sites.get(query.get("site") ?? "");
    if (!state) return { ok: false, message: "That site is not open." };
    return { ok: true, lines: state.log.tail(200) };
  });

  route("POST", "/nodes/resolve", ({ body }) => {
    const state = sites.ready(stringField(body, "site"));
    const ref = body["ref"] as NodeRef | undefined;
    if (!ref || typeof ref !== "object") throw new BodyError('"ref" is required.');
    const page = typeof body["page"] === "string" ? body["page"] : null;
    if (page !== null) {
      const info = state.info.pages.find((candidate) => candidate.path === page);
      state.session.pageFile = info ? (info.component ?? info.file) : null;
      state.session.pageTailwind = info ? info.tailwind : null;
    }
    return { ok: true, node: state.session.resolve(ref) };
  });

  route("POST", "/edits/apply", ({ body }) => {
    const state = sites.ready(stringField(body, "site"));
    const op = body["op"] as EditOp | undefined;
    if (!op || typeof op !== "object" || typeof op.op !== "string") throw new BodyError('"op" is required.');
    return withCssChanged(state.session.apply(op));
  });

  route("POST", "/edits/undo", ({ body }) => withCssChanged(sites.ready(stringField(body, "site")).session.undo()));
  route("POST", "/edits/redo", ({ body }) => withCssChanged(sites.ready(stringField(body, "site")).session.redo()));

  route("GET", "/changes", ({ query }) => {
    const state = sites.ready(query.get("site") ?? "");
    return { ok: true, files: collectChanges(state.dir), diff: readDiff(state.dir), headCommit: head(state.dir) };
  });

  route("POST", "/publish", async ({ body }) => {
    const state = sites.ready(stringField(body, "site"));
    const message = stringField(body, "message");
    const resolutions = body["resolutions"] && typeof body["resolutions"] === "object" ? (body["resolutions"] as Record<string, "mine" | "theirs">) : undefined;
    const repo = repositoryFor(config, state);
    const result = await publishChanges({
      dir: state.dir,
      repo,
      baseCommitSha: state.baseCommit,
      message,
      ...(resolutions ? { resolutions } : {}),
      // The working copy's HEAD is always the published base, so the base version
      // of a file comes from local git instead of a round trip.
      readBase: (path) => readCommitted(state.dir, path),
    });
    if (result.ok) {
      state.baseCommit = result.commitSha;
      // Record the publish locally so the next edits diff against it, and start a fresh history.
      sites.commitLocally(state, message);
      if (state.info) state.info.headCommit = head(state.dir);
    }
    return result;
  });

  /** Test hook: pretend someone else published `files` to the branch (mock mode only). */
  route("POST", "/publish/simulate-move", ({ body }) => {
    const state = sites.ready(stringField(body, "site"));
    const files = body["files"];
    if (!files || typeof files !== "object" || Array.isArray(files)) throw new BodyError('"files" must be an object of path → content.');
    const mock = mockRepositoryFor(config, state);
    const message = typeof body["message"] === "string" ? body["message"] : undefined;
    const sha = mock.moveBranch(files as Record<string, string>, message);
    return { ok: true, commitSha: sha };
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const started = Date.now();
    const url = new URL(request.url ?? "/", "http://engine.local");
    const method = (request.method ?? "GET").toUpperCase();
    applyCors(request, response, config.editorOrigins);
    let status = 200;
    try {
      if (method === "OPTIONS") {
        status = 204;
        response.statusCode = 204;
        response.end();
        return;
      }
      const handler = routes.get(`${method} ${url.pathname}`);
      if (!handler) {
        status = 404;
        sendJson(response, { ok: false, message: `No route for ${method} ${url.pathname}.` }, 404);
        return;
      }
      const body = method === "POST" ? await readJson(request) : {};
      const result = await handler({ body, query: url.searchParams });
      sendJson(response, result);
    } catch (error) {
      if (error instanceof BodyError || error instanceof SiteError) {
        sendJson(response, { ok: false, message: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      log(`! ${method} ${url.pathname}: ${error instanceof Error && error.stack ? error.stack : message}`);
      sendJson(response, { ok: false, message });
    } finally {
      log(`${method} ${url.pathname}${url.search} ${status} ${Date.now() - started}ms`);
    }
  }

  let server: Server | null = null;

  return {
    sites,
    port: () => (server?.address() as AddressInfo | null)?.port ?? null,
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        server = createServer((request, response) => {
          void handle(request, response);
        });
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server?.off("error", reject);
          resolve((server?.address() as AddressInfo).port);
        });
      });
    },
    async close() {
      await sites.closeAll();
      await new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.closeAllConnections?.();
        server.close(() => resolve());
        server = null;
      });
    },
  };
}

/** `npm run engine`: read the environment, listen, stop the previews on exit. */
async function main(): Promise<void> {
  const config = configFromEnv();
  const engine = createEngineServer(config);
  const port = await engine.listen();
  process.stdout.write(`armature engine listening on http://127.0.0.1:${port} (github: ${config.github}, cache: ${config.cacheDir})\n`);
  const stop = () => {
    engine.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
