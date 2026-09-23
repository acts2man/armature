/**
 * A Supabase that lives entirely inside Playwright's request interception: a seeded
 * session, the few PostgREST tables the dashboard reads, and the edge functions the
 * visual editor calls. GitHub is never touched; the batch publish answers with a
 * fake commit (or a conflict) and records what it was asked to write.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { checkLayout, checkSiteKit } from "../../kit/validate.ts";

export const SUPABASE_URL = "https://mock.supabase.test";
export const DEMO_SITE_URL = "http://localhost:5174";
export const SITE_ID = "11111111-1111-4111-8111-111111111111";
export const AGENCY_ID = "22222222-2222-4222-8222-222222222222";
export const STAFF_ID = "33333333-3333-4333-8333-333333333333";
export const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const COMMIT_SHA = "abc1234def5678abc1234def5678abc1234def56";

const demoDir = fileURLToPath(new URL("../../examples/demo-site/content/", import.meta.url));
export const demoSchema = JSON.parse(readFileSync(`${demoDir}schema.json`, "utf8")) as unknown;
export const demoContent = JSON.parse(readFileSync(`${demoDir}pages.json`, "utf8")) as Record<string, Record<string, Record<string, unknown>>>;
export const demoKit = JSON.parse(readFileSync(`${demoDir}site-kit.json`, "utf8")) as unknown;
export const demoLayouts = Object.fromEntries(
  readdirSync(`${demoDir}layouts`)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.slice(0, -".json".length), JSON.parse(readFileSync(`${demoDir}layouts/${name}`, "utf8")) as unknown]),
) as Record<string, unknown>;

export type Role = "staff" | "client";

export type MockOptions = {
  role?: Role;
  /** Overrides the live URL (for the blocked / unreachable connection tests). */
  liveUrl?: string | null;
  /** What content-publish-batch answers. */
  publish?: "ok" | "conflict" | "failed";
  /** What site-embed-check answers. */
  embed?: { reachable: boolean; status: number | null; xFrameOptions: string | null; frameAncestors: string | null };
  /** Content returned by content-get; defaults to the demo site's files. */
  content?: Record<string, unknown>;
  /** Let Google Fonts load (for screenshots). Tests block them so nothing leaves the machine. */
  allowFonts?: boolean;
  /** What clients may do in the editor; agency staff always get the full builder. */
  editingLevel?: "content" | "style" | "builder";
  /** Layouts returned by content-get; defaults to the demo site's files. */
  layouts?: Record<string, unknown>;
  /** builder-publish: "ok" (default), or "conflict-once" (a layout conflict until the person chooses). */
  builderPublish?: "ok" | "conflict-once";
  /** REST rows present before the test starts (a draft saved on another device, templates). */
  rows?: Record<string, Record<string, unknown>[]>;
  /** Validator problems content-get reports (values the site's files hold that the editor cannot read). */
  problems?: unknown[];
  /** The site kit content-get returns; defaults to the demo site's. */
  siteKit?: unknown;
};

export type MockState = {
  publishRequests: unknown[];
  builderPublishRequests: Record<string, unknown>[];
  contentGets: number;
  /** Rows written to REST tables (drafts, templates), by table. */
  rows: Record<string, Record<string, unknown>[]>;
};

const base64url = (value: string) => Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function jwt(userId: string, email: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: userId, email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365, iat: Math.floor(Date.now() / 1000) }));
  return `${header}.${payload}.${base64url("signature")}`;
}

const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });

export async function installMocks(page: Page, options: MockOptions = {}): Promise<MockState> {
  const role = options.role ?? "staff";
  const userId = role === "staff" ? STAFF_ID : CLIENT_ID;
  const email = role === "staff" ? "dana@agency.example" : "sam@alderstone.example";
  const fullName = role === "staff" ? "Dana Whitfield" : "Sam Alder";
  const user = { id: userId, aud: "authenticated", role: "authenticated", email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: { full_name: fullName }, created_at: new Date().toISOString() };
  const session = { access_token: jwt(userId, email), refresh_token: "refresh-mock", token_type: "bearer", expires_in: 3600 * 24 * 365, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365, user };

  const agency = { id: AGENCY_ID, name: "Reputation Guardians", portal_name: "Reputation Guardians", logo_url: null, accent_color: "#2b3fd6", created_at: "2026-09-01T00:00:00Z" };
  const site = {
    id: SITE_ID,
    agency_id: AGENCY_ID,
    name: "Alder & Stone Custom Homes",
    repo_owner: "acme",
    repo_name: "alder-stone",
    branch: "main",
    live_url: options.liveUrl === undefined ? DEMO_SITE_URL : options.liveUrl,
    github_installation_id: 123,
    status: "connected",
    last_published_at: "2026-09-20T15:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
  };

  const state: MockState = { publishRequests: [], builderPublishRequests: [], contentGets: 0, rows: JSON.parse(JSON.stringify(options.rows ?? {})) as MockState["rows"] };
  // The content "in the repository": a batch publish updates it, as a real one would.
  const content = JSON.parse(JSON.stringify(options.content ?? demoContent)) as Record<string, Record<string, Record<string, unknown>>>;
  const layouts = JSON.parse(JSON.stringify(options.layouts ?? demoLayouts)) as Record<string, unknown>;
  const media = [
    { path: "/assets/hero.svg", bytes: 2400, kind: "image", alt: "A timber-framed house at dusk" },
    { path: "/assets/team.svg", bytes: 1800, kind: "image", alt: "" },
  ];
  let commitSha = COMMIT_SHA;
  let siteKit: unknown = options.siteKit ?? demoKit;
  /** What content-get answers: the files as the validator cleans them, plus every problem it found (exactly as the real function does). */
  const builderFiles = () => {
    const cleaned: Record<string, unknown> = {};
    const problems: unknown[] = [...(options.problems ?? [])];
    for (const [slug, raw] of Object.entries(layouts)) {
      const report = checkLayout(raw);
      if (report.value) cleaned[slug] = report.value;
      problems.push(...report.problems.map((problem) => ({ ...problem, file: `content/layouts/${slug}.json`, slug })));
    }
    const kit = checkSiteKit(siteKit);
    problems.push(...kit.problems.map((problem) => ({ ...problem, file: "content/site-kit.json" })));
    return { layouts: cleaned, siteKit: kit.value, problems };
  };

  // Nothing in these tests may leave the machine (fonts and the like).
  if (!options.allowFonts) await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: "sb-mock-auth-token", value: session },
  );

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
      return;
    }

    // --- auth ------------------------------------------------------------------
    if (path.startsWith("/auth/v1/user")) return json(route, user);
    if (path.startsWith("/auth/v1/token")) return json(route, session);
    if (path.startsWith("/auth/v1/logout")) return json(route, {});

    // --- rest ------------------------------------------------------------------
    if (path.startsWith("/rest/v1/")) {
      const table = path.slice("/rest/v1/".length);
      const wantsCount = (request.headers()["prefer"] ?? "").includes("count=");
      const countOf = (n: number) => json(route, [], 200, { "content-range": `0-${Math.max(0, n - 1)}/${n}` });
      switch (table) {
        case "agency_members":
          return json(route, role === "staff" ? [{ role: "owner", agency }] : []);
        case "site_members":
          return json(route, role === "client" ? [{ role: "client_owner", site }] : []);
        case "agencies":
          return json(route, [agency]);
        case "sites":
          if (wantsCount) return countOf(1);
          if (request.method() === "PATCH") {
            const patch = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
            (state.rows["sites"] ??= []).push(patch);
            Object.assign(site, patch);
          }
          return json(route, [site]);
        case "publishes":
          return json(route, state.rows["publishes"] ?? []);
        case "change_requests":
          if (wantsCount) return countOf(0);
          if (request.method() === "POST") return json(route, [{ id: "55555555-5555-4555-8555-555555555555" }], 201);
          return json(route, []);
        case "site_services":
          return json(route, []);
        case "site_billing":
          return json(route, []);
        case "builder_templates":
        case "builder_drafts": {
          const rows = (state.rows[table] ??= []);
          const method = request.method();
          if (method === "GET" || method === "HEAD") {
            // Honour "column=eq.value" filters (enough for id / site_id / user_id lookups).
            let shown = rows;
            for (const [column, filter] of url.searchParams) {
              if (filter.startsWith("eq.")) shown = shown.filter((row) => String(row[column]) === filter.slice(3));
            }
            const single = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
            if (single) return shown[0] ? json(route, shown[0]) : json(route, { code: "PGRST116", message: "no rows" }, 406);
            return json(route, shown);
          }
          if (method === "POST") {
            const incoming = JSON.parse(request.postData() ?? "{}") as Record<string, unknown> | Record<string, unknown>[];
            const list = Array.isArray(incoming) ? incoming : [incoming];
            const upsert = (request.headers()["prefer"] ?? "").includes("resolution=merge-duplicates");
            const saved = list.map((row) => {
              const existing = upsert ? rows.findIndex((other) => other["site_id"] === row["site_id"] && other["user_id"] === row["user_id"]) : -1;
              const full = { id: `tpl-${rows.length + 1}-${Math.random().toString(16).slice(2, 8)}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
              if (existing >= 0) rows[existing] = { ...rows[existing], ...full, id: rows[existing]!["id"] };
              else rows.push(full);
              return full;
            });
            return json(route, saved, 201);
          }
          if (method === "DELETE") {
            const filters = [...url.searchParams].filter(([, filter]) => filter.startsWith("eq."));
            state.rows[table] = rows.filter((row) => !filters.every(([column, filter]) => String(row[column]) === filter.slice(3)));
            return json(route, [], 200);
          }
          return json(route, []);
        }
        default:
          return json(route, []);
      }
    }

    // --- functions -------------------------------------------------------------
    if (path.startsWith("/functions/v1/")) {
      const name = path.slice("/functions/v1/".length);
      const body = request.postDataJSON() as Record<string, unknown>;
      switch (name) {
        case "content-get":
          state.contentGets += 1;
          if (typeof body["ref"] === "string") {
            // An older version: the home layout's "Recent builds" heading read differently then.
            const older = JSON.parse(JSON.stringify(layouts).replace('"Recent builds"', '"Builds from last spring"')) as Record<string, unknown>;
            return json(route, { ok: true, schema: demoSchema, content, commitSha: body["ref"], branch: "main", repo: "acme/alder-stone", warnings: [], problems: [], layouts: older, siteKit: builderFiles().siteKit, media, editingLevel: options.editingLevel ?? "content" });
          }
          return json(route, { ok: true, schema: demoSchema, content, commitSha, branch: "main", repo: "acme/alder-stone", warnings: [], ...builderFiles(), media, editingLevel: options.editingLevel ?? "content" });
        case "builder-publish": {
          state.builderPublishRequests.push(body);
          const resolutions = (body["resolutions"] ?? {}) as Record<string, string>;
          if (options.builderPublish === "conflict-once" && !resolutions["layout:home:hdbuilds"]) {
            return json(route, {
              ok: false,
              code: "conflict",
              message: "Someone else published changes to the same thing while you were editing.",
              fields: ['Both you and someone else changed heading "Recent builds"'],
              conflicts: [{ key: "layout:home:hdbuilds", page: "home", elementId: "hdbuilds", label: 'Both you and someone else changed heading "Recent builds"' }],
            });
          }
          for (const page of (body["pages"] ?? []) as { slug: string; fields: { section: string; field: string; value: unknown }[] }[]) {
            for (const field of page.fields) ((content[page.slug] ??= {})[field.section] ??= {})[field.field] = field.value;
          }
          const written = Object.keys((body["layouts"] ?? {}) as Record<string, unknown>);
          for (const [slug, layout] of Object.entries((body["layouts"] ?? {}) as Record<string, unknown>)) {
            if (layout === null) delete layouts[slug];
            else layouts[slug] = layout;
          }
          if (body["kit"]) siteKit = body["kit"];
          commitSha = "b0b0b0b0b1b1b1b1b2b2b2b2b3b3b3b3b4b4b4b4";
          return json(route, { ok: true, commitSha, commitUrl: `https://github.com/acme/alder-stone/commit/${commitSha}`, fields: [], images: [], slugs: written, layouts: written, kit: !!body["kit"], media: !!body["media"], merged: options.builderPublish === "conflict-once" });
        }
        case "content-publish-batch":
          state.publishRequests.push(body);
          if (options.publish === "conflict") {
            return json(route, { ok: false, code: "conflict", message: "Someone else changed this field while you were editing: Home → Hero → Headline. Nothing was published. Reload to get their version, then reapply your change.", fields: ["Home → Hero → Headline"] });
          }
          if (options.publish === "failed") return json(route, { ok: false, code: "github_error", message: "GitHub answered with HTTP 502." });
          for (const page of body["pages"] as { slug: string; fields: { section: string; field: string; value: unknown }[] }[]) {
            for (const field of page.fields) ((content[page.slug] ??= {})[field.section] ??= {})[field.field] = field.value;
          }
          commitSha = "def5678abc1234def5678abc1234def5678abc12";
          return json(route, {
            ok: true,
            commitSha: "def5678abc1234def5678abc1234def5678abc12",
            commitUrl: "https://github.com/acme/alder-stone/commit/def5678abc1234def5678abc1234def5678abc12",
            fields: (body["pages"] as { slug: string; fields: { section: string; field: string }[] }[]).flatMap((page) => page.fields.map((field) => `${page.slug}.${field.section}.${field.field}`)),
            images: [],
            slugs: (body["pages"] as { slug: string }[]).map((page) => page.slug),
          });
        case "site-embed-check":
          return json(route, { ok: true, url: site.live_url, ...(options.embed ?? { reachable: true, status: 200, xFrameOptions: null, frameAncestors: null }) });
        default:
          return json(route, { ok: false, code: "not_found", message: `No mock for ${name}` }, 404);
      }
    }

    return json(route, {}, 404);
  });

  return state;
}

export const editorUrl = (slug?: string) => `/sites/${SITE_ID}/visual${slug ? `/${slug}` : ""}`;

/** A live site on another origin that has no bridge at all, served from the test itself. */
export const PLAIN_SITE_URL = "http://plain.localhost:5199";
export async function servePlainSite(page: Page): Promise<void> {
  await page.route(`${PLAIN_SITE_URL}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A site without the bridge</title></head><body style="font-family: system-ui; padding: 40px"><h1>A plain page</h1><p>This page does not include the Armature bridge.</p></body></html>`,
    }),
  );
}
