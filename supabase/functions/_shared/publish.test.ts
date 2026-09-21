import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { CONTENT_PATH, cloneContent, serializeContent } from "../../../shared/contentFile.ts";
import { SCHEMA_PATH } from "../../../shared/schema.ts";
import { base64ByteLength, base64ToUtf8, utf8ToBase64 } from "../../../shared/base64.ts";
import { MAX_IMAGE_BYTES } from "../../../shared/publishTypes.ts";
import { ArmatureError } from "./errors.ts";
import type { CommitFile, ContentRepo } from "./githubRepo.ts";
import { loadSiteFiles, parsePublishRequest, runPublish } from "./publish.ts";
import exampleSchema from "../../../shared/example/schema.json" with { type: "json" };
import exampleContent from "../../../shared/example/pages.json" with { type: "json" };

type Tree = Record<string, Record<string, Record<string, unknown>>>;
const tree = () => cloneContent(exampleContent) as unknown as Tree;

const BASE_SHA = "base000000000000000000000000000000000000";
const MOVED_SHA = "moved00000000000000000000000000000000000";

type Recorded = { message: string; files: CommitFile[]; parentCommitSha: string };

/** A fake ContentRepo serving the schema and per-ref content, recording commits. */
function fakeRepo(opts: { head: string; byRef: Record<string, unknown>; schema?: unknown }) {
  const commits: Recorded[] = [];
  const repo: ContentRepo = {
    getBranchHead: () => Promise.resolve(opts.head),
    readTextFile: (path, ref) => {
      if (path === SCHEMA_PATH) {
        return Promise.resolve({ text: JSON.stringify(opts.schema ?? exampleSchema), sha: `schema-${ref}` });
      }
      if (path !== CONTENT_PATH) return Promise.reject(new ArmatureError("github_error", `unexpected path ${path}`));
      const value = opts.byRef[ref];
      if (value === undefined) return Promise.reject(new ArmatureError("github_error", `no content at ref ${ref}`));
      return Promise.resolve({ text: serializeContent(value), sha: `blob-${ref}` });
    },
    commit: (input) => {
      commits.push(input);
      return Promise.resolve({ commitSha: "newcommitsha", commitUrl: "https://github.com/acme/site/commit/newcommitsha" });
    },
  };
  return { repo, commits };
}

function committedContent(commit: Recorded): Tree {
  const file = commit.files.find((entry) => entry.path === CONTENT_PATH);
  if (!file) throw new Error("commit did not include the content file");
  return JSON.parse(base64ToUtf8(file.content)) as Tree;
}

const pngBase64 = utf8ToBase64("pretend-png-bytes");
const publish = (repo: ContentRepo, input: Parameters<typeof runPublish>[0]["input"], now?: () => number) =>
  runPublish({ repo, input, userEmail: "owner@example.com", now });

Deno.test("rejects an unknown field and commits nothing", async () => {
  const { repo, commits } = fakeRepo({ head: BASE_SHA, byRef: { [BASE_SHA]: tree() } });
  await assertRejects(
    () => publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [{ section: "hero", field: "nope", value: "x" }], images: [] }),
    ArmatureError,
    "not a field declared in the site's schema",
  );
  assertEquals(commits.length, 0);
});

Deno.test("rejects an unsafe link destination", async () => {
  const { repo, commits } = fakeRepo({ head: BASE_SHA, byRef: { [BASE_SHA]: tree() } });
  await assertRejects(
    () => publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [{ section: "hero", field: "cta", value: { label: "Go", href: "javascript:alert(1)" } }], images: [] }),
    ArmatureError,
    "must start with https://",
  );
  assertEquals(commits.length, 0);
});

Deno.test("rejects an SVG upload and an oversized image", async () => {
  const { repo, commits } = fakeRepo({ head: BASE_SHA, byRef: { [BASE_SHA]: tree() } });
  await assertRejects(
    () => publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [], images: [{ section: "hero", field: "image", filename: "evil.svg", contentType: "image/svg+xml", dataBase64: pngBase64 }] }),
    ArmatureError,
    "only PNG, JPEG and WebP",
  );
  const oversized = "A".repeat(4_400_000); // ~3.3 MB decoded, over the 3 MB limit
  assert(base64ByteLength(oversized) > MAX_IMAGE_BYTES);
  await assertRejects(
    () => publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [], images: [{ section: "hero", field: "image", filename: "huge.png", contentType: "image/png", dataBase64: oversized }] }),
    ArmatureError,
    "too large",
  );
  assertEquals(commits.length, 0);
});

Deno.test("rejects an empty publish, an unknown page, and a missing base sha", async () => {
  const { repo, commits } = fakeRepo({ head: BASE_SHA, byRef: { [BASE_SHA]: tree() } });
  await assertRejects(() => publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [], images: [] }), ArmatureError, "no changes to publish");
  await assertRejects(
    () => publish(repo, { slug: "not-a-page", baseCommitSha: BASE_SHA, fields: [{ section: "hero", field: "title", value: "x" }], images: [] }),
    ArmatureError,
    "is not a page this site can edit",
  );
  await assertRejects(
    () => publish(repo, { slug: "home", baseCommitSha: "", fields: [{ section: "hero", field: "title", value: "x" }], images: [] }),
    ArmatureError,
    "Reload the page",
  );
  assertEquals(commits.length, 0);
});

Deno.test("happy path: exactly one commit containing pages.json and the image", async () => {
  const { repo, commits } = fakeRepo({ head: BASE_SHA, byRef: { [BASE_SHA]: tree() } });
  const outcome = await publish(
    repo,
    {
      slug: "home",
      baseCommitSha: BASE_SHA,
      fields: [{ section: "hero", field: "title", value: "A Brand New Headline" }],
      images: [{ section: "hero", field: "image", filename: "My New Photo!.PNG", contentType: "image/png", dataBase64: pngBase64 }],
    },
    () => 1700000000000,
  );
  assertEquals(commits.length, 1);
  const commit = commits[0]!;
  assertEquals(commit.parentCommitSha, BASE_SHA);
  assertEquals(commit.files.map((file) => file.path).sort(), [
    "content/pages.json",
    "public/assets/uploads/home-1700000000000-my-new-photo.png",
  ]);
  const imageFile = commit.files.find((file) => file.path.startsWith("public/assets/uploads/"))!;
  assertEquals(imageFile.encoding, "base64");
  assertEquals(imageFile.content, pngBase64);

  const written = committedContent(commit);
  const expected = tree();
  expected["home"]!["hero"]!["title"] = "A Brand New Headline";
  expected["home"]!["hero"]!["image"] = "/assets/uploads/home-1700000000000-my-new-photo.png";
  assertEquals(written, expected);
  assertEquals(commit.message, "Content: Home updated by owner@example.com");
  assertEquals(outcome.commitSha, "newcommitsha");
  assertEquals(outcome.images, ["/assets/uploads/home-1700000000000-my-new-photo.png"]);
  const file = commit.files.find((entry) => entry.path === CONTENT_PATH)!;
  assertEquals(base64ToUtf8(file.content), serializeContent(written));
});

Deno.test("writes a list field and a link field together", async () => {
  const { repo, commits } = fakeRepo({ head: BASE_SHA, byRef: { [BASE_SHA]: tree() } });
  await publish(repo, {
    slug: "shared",
    baseCommitSha: BASE_SHA,
    fields: [
      { section: "header", field: "nav", value: [{ label: "Home", href: "/" }, { label: "Pricing", href: "/pricing/" }, { label: "Contact", href: "/contact/" }] },
      { section: "footer", field: "privacy", value: { label: "Privacy", href: "/privacy-policy/" } },
    ],
    images: [],
  });
  const written = committedContent(commits[0]!);
  assertEquals((written["shared"]!["header"]!["nav"] as unknown[]).length, 3);
  assertEquals(written["shared"]!["footer"]!["privacy"], { label: "Privacy", href: "/privacy-policy/" });
});

Deno.test("refuses a publish whose only change is a no-op", async () => {
  const current = tree();
  const { repo, commits } = fakeRepo({ head: BASE_SHA, byRef: { [BASE_SHA]: current } });
  await assertRejects(
    () => publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [{ section: "hero", field: "title", value: current["home"]!["hero"]!["title"] as string }], images: [] }),
    ArmatureError,
    "no changes to publish",
  );
  assertEquals(commits.length, 0);
});

Deno.test("branch moved, different fields: merges field by field onto the moved head", async () => {
  const moved = tree();
  moved["home"]!["hero"]!["body"] = "Someone else rewrote the body copy.";
  const { repo, commits } = fakeRepo({ head: MOVED_SHA, byRef: { [BASE_SHA]: tree(), [MOVED_SHA]: moved } });
  await publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [{ section: "hero", field: "title", value: "My New Headline" }], images: [] });
  assertEquals(commits.length, 1);
  const written = committedContent(commits[0]!);
  assertEquals(written["home"]!["hero"]!["title"], "My New Headline");
  assertEquals(written["home"]!["hero"]!["body"], "Someone else rewrote the body copy.");
  assertEquals(commits[0]!.parentCommitSha, MOVED_SHA);
});

Deno.test("branch moved on another page: merges", async () => {
  const moved = tree();
  moved["shared"]!["footer"]!["copyright"] = "© 2027";
  const { repo, commits } = fakeRepo({ head: MOVED_SHA, byRef: { [BASE_SHA]: tree(), [MOVED_SHA]: moved } });
  await publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [{ section: "hero", field: "title", value: "My New Headline" }], images: [] });
  const written = committedContent(commits[0]!);
  assertEquals(written["home"]!["hero"]!["title"], "My New Headline");
  assertEquals(written["shared"]!["footer"]!["copyright"], "© 2027");
});

Deno.test("branch moved, same field: conflict naming the field, nothing committed", async () => {
  const moved = tree();
  moved["home"]!["hero"]!["title"] = "Their Headline";
  const { repo, commits } = fakeRepo({ head: MOVED_SHA, byRef: { [BASE_SHA]: tree(), [MOVED_SHA]: moved } });
  let caught: unknown;
  try {
    await publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [{ section: "hero", field: "title", value: "My Headline" }], images: [] });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ArmatureError);
  assertEquals(caught.code, "conflict");
  assertStringIncludes(caught.message, "Someone else changed");
  assertEquals(caught.fields, ["Hero → Headline"]);
  assertEquals(commits.length, 0);
});

Deno.test("branch moved and the base version is gone: conflict", async () => {
  const { repo, commits } = fakeRepo({ head: MOVED_SHA, byRef: { [MOVED_SHA]: tree() } });
  await assertRejects(
    () => publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [{ section: "hero", field: "title", value: "x" }], images: [] }),
    ArmatureError,
    "no longer available",
  );
  assertEquals(commits.length, 0);
});

Deno.test("a publish that would leave the file invalid is refused", async () => {
  const broken = tree();
  delete broken["shared"]!["footer"]!["copyright"]; // pre-existing damage in the repo
  const { repo, commits } = fakeRepo({ head: BASE_SHA, byRef: { [BASE_SHA]: broken } });
  await assertRejects(
    () => publish(repo, { slug: "home", baseCommitSha: BASE_SHA, fields: [{ section: "hero", field: "title", value: "x" }], images: [] }),
    ArmatureError,
    "would have made the content file invalid",
  );
  assertEquals(commits.length, 0);
});

Deno.test("loadSiteFiles refuses a schema that breaks the contract and surfaces content warnings", async () => {
  const bad = fakeRepo({ head: BASE_SHA, byRef: { [BASE_SHA]: tree() }, schema: { armatureContract: 2, pages: [] } });
  await assertRejects(() => loadSiteFiles(bad.repo, BASE_SHA), ArmatureError, "site contract");

  const extra = tree();
  extra["home"]!["hero"]!["legacy"] = "old";
  const ok = fakeRepo({ head: BASE_SHA, byRef: { [BASE_SHA]: extra } });
  const files = await loadSiteFiles(ok.repo, BASE_SHA);
  assertEquals(files.pages.length, 2);
  assertEquals(files.contentErrors, []);
  assertStringIncludes(files.warnings.join("\n"), "home.hero.legacy");
});

Deno.test("parsePublishRequest shapes the payload defensively", () => {
  const parsed = parsePublishRequest({
    site_id: "s",
    slug: "home",
    baseCommitSha: "abc",
    fields: [{ section: "hero", field: "title", value: "x" }, { nope: true }, "junk"],
    images: [{ section: "hero", field: "image", filename: 1, contentType: "image/png", dataBase64: "AAAA" }],
  });
  assertEquals(parsed.fields, [{ section: "hero", field: "title", value: "x" }]);
  assertEquals(parsed.images, [{ section: "hero", field: "image", filename: "", contentType: "image/png", dataBase64: "AAAA" }]);
  assertEquals(parsePublishRequest({}).fields, []);
});
