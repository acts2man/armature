import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { CONTENT_PATH } from "../../../shared/contentFile.ts";
import { utf8ToBase64 } from "../../../shared/base64.ts";
import { ArmatureError } from "./errors.ts";
import { createGithubContentRepo, createGithubProbe } from "./githubRepo.ts";

const config = { token: "ghs_notrealtoken", repo: "acme/site", branch: "main" };
const pngBase64 = utf8ToBase64("pretend-png-bytes");

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

Deno.test("createGithubContentRepo: blobs, a tree over base_tree, one commit, a NON-forced ref update", async () => {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url: href, body });
    assertEquals(new Headers(init?.headers).get("Authorization"), `Bearer ${config.token}`);
    if (href.endsWith("/git/ref/heads/main")) return json({ object: { sha: "headsha" } });
    if (href.includes("/git/commits/headsha")) return json({ tree: { sha: "treesha" } });
    if (href.endsWith("/git/blobs")) return json({ sha: `blob-${calls.length}` });
    if (href.endsWith("/git/trees")) return json({ sha: "newtreesha" });
    if (href.endsWith("/git/commits")) return json({ sha: "committed", html_url: "https://github.com/acme/site/commit/committed" });
    if (href.endsWith("/git/refs/heads/main")) return json({ object: { sha: "committed" } });
    throw new Error(`unexpected call ${method} ${href}`);
  }) as unknown as typeof fetch;

  const repo = createGithubContentRepo(config, fakeFetch);
  assertEquals(await repo.getBranchHead(), "headsha");
  const result = await repo.commit({
    message: "Content: Home updated by owner@example.com",
    parentCommitSha: "headsha",
    files: [
      { path: CONTENT_PATH, content: utf8ToBase64("{}\n"), encoding: "base64" },
      { path: "public/assets/uploads/a.png", content: pngBase64, encoding: "base64" },
    ],
  });
  assertEquals(result, { commitSha: "committed", commitUrl: "https://github.com/acme/site/commit/committed" });
  assertEquals(calls.filter((call) => call.url.endsWith("/git/blobs")).length, 2);
  const treeCall = calls.find((call) => call.url.endsWith("/git/trees"))!;
  assertEquals((treeCall.body as { base_tree: string }).base_tree, "treesha");
  assertEquals((treeCall.body as { tree: unknown[] }).tree.length, 2);
  const commitCalls = calls.filter((call) => call.method === "POST" && call.url.endsWith("/git/commits"));
  assertEquals(commitCalls.length, 1);
  assertEquals((commitCalls[0]!.body as { parents: string[] }).parents, ["headsha"]);
  const refCall = calls.find((call) => call.method === "PATCH")!;
  assertStringIncludes(refCall.url, "/git/refs/heads/main");
  assertEquals((refCall.body as { force: boolean }).force, false);
});

Deno.test("createGithubContentRepo maps 401/403 to forbidden without leaking the token", async () => {
  const fakeFetch = (async () => json({ message: `Bad credentials for ${config.token}` }, 401)) as unknown as typeof fetch;
  const repo = createGithubContentRepo(config, fakeFetch);
  let caught: unknown;
  try {
    await repo.getBranchHead();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ArmatureError);
  assertEquals(caught.code, "forbidden");
  assert(!caught.message.includes(config.token));
  assertStringIncludes(caught.message, "[redacted]");
});

Deno.test("createGithubContentRepo maps a 422 ref update to a conflict", async () => {
  const fakeFetch = (async (url: string | URL | Request) => {
    const href = String(url);
    if (href.includes("/git/commits/headsha")) return json({ tree: { sha: "treesha" } });
    if (href.endsWith("/git/blobs")) return json({ sha: "blob" });
    if (href.endsWith("/git/trees")) return json({ sha: "newtree" });
    if (href.endsWith("/git/commits")) return json({ sha: "c", html_url: "u" });
    return json({ message: "Update is not a fast forward" }, 422);
  }) as unknown as typeof fetch;
  const repo = createGithubContentRepo(config, fakeFetch);
  await assertRejects(
    () => repo.commit({ message: "m", parentCommitSha: "headsha", files: [{ path: CONTENT_PATH, content: utf8ToBase64("{}"), encoding: "base64" }] }),
    ArmatureError,
    "the branch moved while publishing",
  );
});

Deno.test("createGithubContentRepo maps a 404 to a readable hint and decodes files", async () => {
  const missing = (async () => json({ message: "Not Found" }, 404)) as unknown as typeof fetch;
  await assertRejects(() => createGithubContentRepo(config, missing).getBranchHead(), ArmatureError, "404");

  const text = '{"a": "é"}\n';
  const file = (async () => json({ sha: "blobsha", encoding: "base64", content: utf8ToBase64(text) })) as unknown as typeof fetch;
  const read = await createGithubContentRepo(config, file).readTextFile(CONTENT_PATH, "main");
  assertEquals(read, { text, sha: "blobsha" });

  const large = (async () => json({ sha: "blobsha", encoding: "none", content: "" })) as unknown as typeof fetch;
  await assertRejects(() => createGithubContentRepo(config, large).readTextFile(CONTENT_PATH, "main"), ArmatureError, "too large");
});

Deno.test("createGithubProbe reports instead of throwing", async () => {
  const push = (async () => json({ permissions: { push: true } })) as unknown as typeof fetch;
  assertEquals((await createGithubProbe(config, push).repository()).canPush, true);

  const unauthorised = (async () => json({ message: `Bad credentials ${config.token}` }, 401)) as unknown as typeof fetch;
  const result = await createGithubProbe(config, unauthorised).repository();
  assertEquals(result.ok, false);
  assertEquals(result.status, 401);
  assert(!result.message.includes(config.token));

  const down = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  assertEquals((await createGithubProbe(config, down).repository()).status, 0);

  const branch = (async () => json({ object: { sha: "0123456789abcdef" } })) as unknown as typeof fetch;
  assertEquals((await createGithubProbe(config, branch).branch()).sha, "0123456789abcdef");

  let seen = "";
  const file = (async (url: string | URL | Request) => {
    seen = String(url);
    return json({ sha: "x", encoding: "base64", content: utf8ToBase64("{}") });
  }) as unknown as typeof fetch;
  const probed = await createGithubProbe(config, file).file("content/schema.json", "feature/x");
  assertStringIncludes(seen, "/contents/content/schema.json");
  assertStringIncludes(seen, "ref=feature%2Fx");
  assertEquals(probed.text, "{}");
});
