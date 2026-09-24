/**
 * A typed fetch client for the engine server (engine/shared/api.ts). Every call resolves
 * to the server's own `{ ok, ... }` shape; a network failure becomes `{ ok: false, message }`
 * so the editor always has something to show. Nothing here touches React.
 */
import type { ApplyRequest, ChangesResponse, OpenRequest, OpenResponse, PublishBody, ResolveRequest, ResolveResponse, SiteStatus } from "../shared/api.ts";
import type { EditOp, EditResult, NodeRef, PublishResult, ResolvedNode } from "../shared/types.ts";

/** The server adds the stylesheets an edit touched, so the preview can reload them. */
export type EngineEditResult = EditResult & { cssChanged?: string[] };

export type EngineApi = ReturnType<typeof createEngineApi>;

type Failure = { ok: false; message: string; missingEnv?: string[] };

async function request<T extends { ok: boolean }>(url: string, init?: RequestInit): Promise<T | Failure> {
  try {
    const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
    if (!response.ok) return { ok: false, message: `The engine server answered with HTTP ${response.status}.` };
    return (await response.json()) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, message: `The engine server could not be reached (${detail}). Is it running at ${url.replace(/\/[^/]*$/, "")}?` };
  }
}

const post = <T extends { ok: boolean }>(url: string, body: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body) });

export function createEngineApi(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  const url = (path: string, query?: Record<string, string>) => {
    const search = query ? `?${new URLSearchParams(query).toString()}` : "";
    return `${base}${path}${search}`;
  };

  const api = {
    baseUrl: base,
    health: () => request<{ ok: true; version: string }>(url("/health")),
    open: (body: OpenRequest) => post<OpenResponse>(url("/sites/open"), body),
    status: (site: string) => request<SiteStatus>(url("/sites/status", { site })),
    close: (site: string) => post<{ ok: boolean }>(url("/sites/close"), { site }),
    resolve: (body: ResolveRequest) => post<ResolveResponse>(url("/nodes/resolve"), body),
    apply: (body: ApplyRequest) => post<EngineEditResult>(url("/edits/apply"), body),
    undo: (site: string) => post<EngineEditResult>(url("/edits/undo"), { site }),
    redo: (site: string) => post<EngineEditResult>(url("/edits/redo"), { site }),
    changes: (site: string) => request<ChangesResponse>(url("/changes", { site })),
    publish: (body: PublishBody) => post<PublishResult>(url("/publish"), body),
    /** Test hook (mock GitHub only): pretend someone else published `files` to the branch, to provoke a conflict. */
    simulateMove: (body: { site: string; files: Record<string, string>; message?: string }) => post<{ ok: true; commitSha: string }>(url("/publish/simulate-move"), body),

    /**
     * Polls /sites/status every `intervalMs` until the preview is ready or failed. Each
     * answer goes to `onStatus`; the final one is returned. Aborting the signal stops the
     * polling and resolves with the last answer seen.
     */
    async waitUntilReady(site: string, options: { intervalMs?: number; onStatus?: (status: SiteStatus) => void; signal?: AbortSignal } = {}): Promise<SiteStatus | Failure> {
      const interval = options.intervalMs ?? 1000;
      let last: SiteStatus | Failure = { ok: false, message: "The preview has not answered yet." };
      while (!options.signal?.aborted) {
        last = await api.status(site);
        if (last.ok) options.onStatus?.(last);
        if (!last.ok || last.status.phase === "ready" || last.status.phase === "error") return last;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, interval);
          options.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
          }, { once: true });
        });
      }
      return last;
    },

    /**
     * The checks the editor can make before asking the server to move an element: not into
     * itself or one of its own descendants, and not into another file (the server refuses
     * both too; this only keeps the drop indicator honest). A local check, no request.
     */
    checkMove(input: { target: ResolvedNode | null; parent: ResolvedNode | null; targetId: string; parentId: string; parentChain: (id: string) => string[] }): { ok: true } | Failure {
      if (input.targetId === input.parentId) return { ok: false, message: "An element cannot be moved into itself." };
      if (input.parentChain(input.parentId).includes(input.targetId)) return { ok: false, message: "An element cannot be moved inside one of its own children." };
      if (!input.target || !input.parent) return { ok: false, message: "Still reading the code behind this element." };
      if (!input.target.structure.editable) return { ok: false, message: input.target.structure.reason?.message ?? "This element cannot be moved." };
      if (!input.parent.structure.canReceiveChildren) return { ok: false, message: "This element cannot hold other elements." };
      if (input.target.file !== input.parent.file) return { ok: false, message: "Elements can only be moved within the same file." };
      return { ok: true };
    },
  };
  return api;
}

/** The NodeRef the server wants, without the extras the bridge adds for the editor. */
export function toNodeRef(node: NodeRef & Record<string, unknown>): NodeRef {
  return { loc: node.loc, usage: node.usage, indices: node.indices, ancestors: node.ancestors, component: node.component, tag: node.tag };
}

export type { EditOp };
