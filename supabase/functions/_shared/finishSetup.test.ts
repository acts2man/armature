import { assertEquals } from "jsr:@std/assert@1";
import { branchPreviewUrl, mergeBranchViaApi, netlifyBranchSlug, netlifySiteSlug } from "./finishSetup.ts";

Deno.test("netlifyBranchSlug lowercases and replaces non-alphanumerics with hyphens", () => {
  assertEquals(netlifyBranchSlug("armature/setup"), "armature-setup");
  assertEquals(netlifyBranchSlug("Feature_XYZ"), "feature-xyz");
  assertEquals(netlifyBranchSlug("main"), "main");
});

Deno.test("netlifySiteSlug reads the *.netlify.app subdomain from a live URL", () => {
  assertEquals(netlifySiteSlug({ host: "alder-stone.netlify.app" }), "alder-stone");
  assertEquals(netlifySiteSlug({ host: "www.custom-domain.com" }), null);
  assertEquals(netlifySiteSlug({ host: "www.custom-domain.com", explicitSlug: "alder-stone" }), "alder-stone");
});

Deno.test("branchPreviewUrl builds Netlify's <branch>--<site>.netlify.app URL", () => {
  assertEquals(
    branchPreviewUrl({ liveUrl: "https://alder-stone.netlify.app/", branch: "armature/setup" }),
    "https://armature-setup--alder-stone.netlify.app",
  );
  // With a custom domain live URL, the caller passes the slug explicitly.
  assertEquals(
    branchPreviewUrl({ liveUrl: "https://www.custom-domain.com/", branch: "armature/setup", explicitSlug: "alder-stone" }),
    "https://armature-setup--alder-stone.netlify.app",
  );
  // With no way to know the slug, we return null so the UI can prompt for one.
  assertEquals(branchPreviewUrl({ liveUrl: "https://www.custom-domain.com/", branch: "armature/setup" }), null);
});

Deno.test("mergeBranchViaApi returns merged on 201, already_merged on 204, conflict on 409, missing_head on 404 with head message", async () => {
  const cases: Array<{ status: number; body: string; kind: string }> = [
    { status: 201, body: JSON.stringify({ sha: "abc123", html_url: "https://github.com/x/y/commit/abc123" }), kind: "merged" },
    { status: 204, body: "", kind: "already_merged" },
    { status: 409, body: "Merge conflict", kind: "conflict" },
    { status: 404, body: "Head does not exist", kind: "missing_head_branch" },
    { status: 404, body: "Base does not exist", kind: "missing_base_branch" },
  ];
  for (const c of cases) {
    // 204 must have no body.
    // deno-lint-ignore require-await
    const fetchImpl = (async () => new Response(c.status === 204 ? null : c.body, { status: c.status })) as unknown as typeof fetch;
    const outcome = await mergeBranchViaApi({ repo: "x/y", base: "main", head: "armature/setup", commitMessage: "m", token: "t", fetchImpl });
    assertEquals(outcome.kind, c.kind);
  }
});
