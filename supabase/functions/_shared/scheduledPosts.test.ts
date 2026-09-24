import { assertEquals } from "jsr:@std/assert@1";
import type { CommitFile, ContentRepo } from "./githubRepo.ts";
import { fireDuePosts, handleScheduledPostsRequest, TOKEN_HEADER, tokenFromRequest, verifyToken, type ScheduledPostsDb } from "./scheduledPosts.ts";

type Row = Record<string, unknown>;

function mockDb(options: {
  scheduled?: Row[];
  siteBySite?: Record<string, Row | null>;
  rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error?: { message: string } | null };
}): { db: ScheduledPostsDb; deletedIds: string[]; rpcCalls: { name: string; args: Record<string, unknown> }[] } {
  const deletedIds: string[] = [];
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const scheduled = options.scheduled ?? [];
  const siteBySite = options.siteBySite ?? {};

  function fromScheduled() {
    return {
      select: (_columns: string) => ({
        lte: (_column: string, _value: string) => ({
          order: (_column: string, _opts: unknown) => ({
            // deno-lint-ignore require-await
            limit: async (_n: number) => ({ data: scheduled, error: null }),
          }),
        }),
      }),
      delete: () => ({
        // deno-lint-ignore require-await
        eq: async (_column: string, id: string) => {
          deletedIds.push(id);
          return { data: null, error: null };
        },
      }),
    };
  }

  function fromSites() {
    let where: string | null = null;
    return {
      select: (_columns: string) => ({
        eq: (_column: string, value: string) => {
          where = value;
          return {
            // deno-lint-ignore require-await
            maybeSingle: async () => ({ data: siteBySite[where!] ?? null, error: null }),
          };
        },
      }),
    };
  }

  const db = {
    from: (table: string) => {
      if (table === "scheduled_posts") return fromScheduled();
      if (table === "sites") return fromSites();
      throw new Error(`unexpected table ${table}`);
    },
    // deno-lint-ignore require-await
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const answer = options.rpc?.(name, args) ?? { data: null, error: null };
      return answer;
    },
  } as unknown as ScheduledPostsDb;
  return { db, deletedIds, rpcCalls };
}

Deno.test("tokenFromRequest reads X-Armature-Token, case-insensitive and trimmed", () => {
  assertEquals(tokenFromRequest(new Request("https://x/", { method: "POST", headers: { [TOKEN_HEADER]: "  abc123  " } })), "abc123");
  assertEquals(tokenFromRequest(new Request("https://x/", { method: "POST", headers: { "X-Armature-Token": "aa" } })), "aa");
  assertEquals(tokenFromRequest(new Request("https://x/", { method: "POST" })), "");
});

Deno.test("verifyToken calls the security-definer RPC and returns the boolean", async () => {
  const { db, rpcCalls } = mockDb({
    rpc: (_name, args) => ({ data: (args.candidate as string) === "sekret", error: null }),
  });
  assertEquals(await verifyToken(db, "sekret"), true);
  assertEquals(await verifyToken(db, "no"), false);
  assertEquals(rpcCalls.length, 2);
  assertEquals(rpcCalls[0]?.name, "armature_check_scheduled_posts_token");
  assertEquals(rpcCalls[0]?.args, { candidate: "sekret" });
});

Deno.test("verifyToken returns false without an RPC call when the candidate is empty", async () => {
  const { db, rpcCalls } = mockDb({ rpc: () => ({ data: true, error: null }) });
  assertEquals(await verifyToken(db, ""), false);
  assertEquals(rpcCalls.length, 0);
});

Deno.test("verifyToken returns false when the RPC itself errors", async () => {
  const { db } = mockDb({ rpc: () => ({ data: null, error: { message: "no such function" } }) });
  assertEquals(await verifyToken(db, "anything"), false);
});

Deno.test("handleScheduledPostsRequest rejects a caller with a missing token, without touching scheduled_posts", async () => {
  const { db, deletedIds, rpcCalls } = mockDb({
    scheduled: [{ id: "row-x", site_id: "site-x", post_slug: "hi", fire_at: "2026-09-24T00:00:00Z" }],
    rpc: () => ({ data: true, error: null }),
  });
  const noHeader = new Request("https://x/", { method: "POST" });
  const result = await handleScheduledPostsRequest({}, noHeader, { db });
  assertEquals(result, { ok: true, fired: [] });
  assertEquals(deletedIds, []);
  assertEquals(rpcCalls.length, 0, "an empty token short-circuits before an RPC");
});

Deno.test("handleScheduledPostsRequest rejects a caller whose token does not match Vault", async () => {
  const { db, deletedIds } = mockDb({
    scheduled: [{ id: "row-y", site_id: "site-y", post_slug: "bye", fire_at: "2026-09-24T00:00:00Z" }],
    rpc: (_name, args) => ({ data: args.candidate === "the-real-one", error: null }),
  });
  const wrong = new Request("https://x/", { method: "POST", headers: { [TOKEN_HEADER]: "definitely-not-it" } });
  const result = await handleScheduledPostsRequest({}, wrong, { db });
  assertEquals(result, { ok: true, fired: [] });
  assertEquals(deletedIds, []);
});

Deno.test("handleScheduledPostsRequest fires when the token matches the Vault secret", async () => {
  const repo: ContentRepo = {
    getBranchHead: () => Promise.resolve("head"),
    readTextFile: (path) => Promise.resolve({ text: `{"slug":"${path}"}`, sha: "sha" }),
    listTree: () => Promise.resolve([]),
    commit: () => Promise.resolve({ commitSha: "new", commitUrl: "https://github.com/acme/site/commit/new" }),
  };
  const { db, deletedIds } = mockDb({
    scheduled: [{ id: "row-z", site_id: "site-z", post_slug: "post-z", fire_at: "2026-09-24T00:00:00Z" }],
    siteBySite: { "site-z": { id: "site-z", agency_id: "a", repo_owner: "acme", repo_name: "site", branch: "main", github_installation_id: 1 } },
    rpc: (_name, args) => ({ data: args.candidate === "the-real-one", error: null }),
  });
  const good = new Request("https://x/", { method: "POST", headers: { [TOKEN_HEADER]: "the-real-one" } });
  const result = await handleScheduledPostsRequest({}, good, {
    db,
    now: () => "2026-09-24T01:00:00Z",
    mintToken: () => Promise.resolve({ token: "ghs_test" }),
    makeRepo: () => repo,
  });
  assertEquals(result, { ok: true, fired: ["post-z"] });
  assertEquals(deletedIds, ["row-z"]);
});

Deno.test("fireDuePosts drops a row whose site has no repository (hosting-only)", async () => {
  const { db, deletedIds } = mockDb({
    scheduled: [{ id: "row-h", site_id: "site-h", post_slug: "orphan", fire_at: "2026-09-24T00:00:00Z" }],
    siteBySite: { "site-h": { id: "site-h", agency_id: "a", repo_owner: null, repo_name: null, branch: null, github_installation_id: null } },
  });
  const result = await fireDuePosts({}, db, {
    now: () => "2026-09-24T01:00:00Z",
    mintToken: () => Promise.resolve({ token: "unused" }),
    makeRepo: () => ({} as ContentRepo),
  });
  assertEquals(result, { ok: true, fired: [] });
  assertEquals(deletedIds, ["row-h"]);
});

Deno.test("fireDuePosts leaves the row alone when GitHub fails, so a later run retries", async () => {
  const repo: ContentRepo = {
    getBranchHead: () => Promise.reject(new Error("upstream 503")),
    readTextFile: () => Promise.reject(new Error("no")),
    listTree: () => Promise.resolve([]),
    commit: () => Promise.resolve({ commitSha: "", commitUrl: "" }),
  };
  const commitedFiles: CommitFile[] = [];
  const { db, deletedIds } = mockDb({
    scheduled: [{ id: "row-r", site_id: "site-r", post_slug: "retry-me", fire_at: "2026-09-24T00:00:00Z" }],
    siteBySite: { "site-r": { id: "site-r", agency_id: "a", repo_owner: "acme", repo_name: "site", branch: "main", github_installation_id: 5 } },
  });
  const result = await fireDuePosts({}, db, {
    now: () => "2026-09-24T01:00:00Z",
    mintToken: () => Promise.resolve({ token: "t" }),
    makeRepo: () => repo,
  });
  assertEquals(result, { ok: true, fired: [] });
  assertEquals(deletedIds, [], "the row is kept so the next run tries again");
  assertEquals(commitedFiles, []);
});
