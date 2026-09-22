import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { CONTENT_PATH, serializeContent } from "../../../shared/contentFile.ts";
import { SCHEMA_PATH } from "../../../shared/schema.ts";
import { layoutPath, serializeBuilderFile, SITE_KIT_PATH } from "../../../shared/builder/schema.ts";
import { defaultSiteKit } from "../../../kit/defaults.ts";
import type { Element, LayoutDoc } from "../../../kit/types.ts";
import { ArmatureError } from "./errors.ts";
import type { CommitFile, ContentRepo } from "./githubRepo.ts";
import { extractUploads, permissionsFor, runBuilderPublish, type BuilderPublishInput } from "./builderPublish.ts";
import exampleSchema from "../../../shared/example/schema.json" with { type: "json" };
import exampleContent from "../../../shared/example/pages.json" with { type: "json" };

const BASE = "base000000000000000000000000000000000000";
const HEAD = "head000000000000000000000000000000000000";
const meta = { createdBy: "t", updatedAt: "2026-09-22" };
const heading = (id: string, text: string, extra: Partial<Element> = {}): Element => ({ id, type: "heading", props: { text, tag: "h2" }, style: {}, advanced: {}, meta, ...extra });
const page = (slug: string, path: string, root: Element[], label?: string): LayoutDoc => ({ version: 1, pageSlug: slug, path, root, ...(label ? { label } : {}) });

type Files = Record<string, string>;
type Recorded = { message: string; files: CommitFile[]; parentCommitSha: string };

/** A repository with a file set per commit. */
function fakeRepo(byRef: Record<string, Files>, head: string) {
  const commits: Recorded[] = [];
  const common: Files = { [SCHEMA_PATH]: JSON.stringify(exampleSchema), [CONTENT_PATH]: serializeContent(exampleContent as never) };
  const repo: ContentRepo = {
    getBranchHead: () => Promise.resolve(head),
    readTextFile: (path, ref) => {
      const files: Files = { ...common, ...(byRef[ref] ?? {}) };
      const text = files[path];
      return text === undefined ? Promise.reject(new ArmatureError("github_error", `no ${path} at ${ref}`)) : Promise.resolve({ text, sha: `${path}@${ref}` });
    },
    listTree: (directory, ref) =>
      Promise.resolve(
        Object.keys({ ...common, ...(byRef[ref] ?? {}) })
          .filter((path) => path.startsWith(`${directory}/`))
          .map((path) => ({ path, sha: path, size: 1 })),
      ),
    commit: (input) => {
      commits.push(input);
      return Promise.resolve({ commitSha: "newsha0000", commitUrl: "https://github.com/acme/site/commit/newsha0000" });
    },
  };
  return { repo, commits };
}

const file = (layout: LayoutDoc) => ({ [layoutPath(layout.pageSlug)]: serializeBuilderFile(layout) });
const input = (overrides: Partial<BuilderPublishInput>): BuilderPublishInput => ({ baseCommitSha: BASE, pages: [], layouts: {}, kit: null, media: null, resolutions: {}, ...overrides });
const staff = permissionsFor(true, "content");
const committed = (commit: Recorded | undefined, path: string) => {
  const entry = commit?.files.find((candidate) => candidate.path === path);
  return entry ? JSON.parse(entry.content) : undefined;
};

const about = page("about-us", "/about-us/", [heading("aaaaaaaa", "About"), heading("bbbbbbbb", "Team")], "About us");

Deno.test("a new builder page, the kit and a picture go out in one commit", async () => {
  const { repo, commits } = fakeRepo({ [BASE]: {} }, BASE);
  const withPicture = { ...about, root: [...about.root, { id: "imgimg01", type: "image", props: { src: "data:image/webp;base64,UklGRg==", alt: "A house" }, style: {}, advanced: {}, meta }] };
  const kit = { ...defaultSiteKit(), colors: { ...defaultSiteKit().colors, primary: "#aa0000" } };
  const outcome = await runBuilderPublish({ repo, input: input({ layouts: { "about-us": withPicture }, kit }), userEmail: "owner@example.com", permissions: staff });
  assertEquals(commits.length, 1);
  assertEquals(outcome.layouts, ["about-us"]);
  assertEquals(outcome.kit, true);
  const written = committed(commits[0], layoutPath("about-us"));
  const src = written.root[2].props.src as string;
  assert(src.startsWith("/assets/uploads/about-us-") && src.endsWith(".webp"), src);
  assert(commits[0]?.files.some((entry) => entry.path === `public${src}` && entry.encoding === "base64"));
  assertEquals(committed(commits[0], SITE_KIT_PATH).colors.primary, "#aa0000");
  assertStringIncludes(commits[0]?.message ?? "", "About us");
});

Deno.test("invalid layouts, clashing addresses and slugs are refused before anything is written", async () => {
  const { repo, commits } = fakeRepo({ [BASE]: {} }, BASE);
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": { ...about, root: [heading("BAD", "x")] } } }), userEmail: "x", permissions: staff }), ArmatureError, "element id");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": { ...about, path: "/" } } }), userEmail: "x", permissions: staff }), ArmatureError, "already uses");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "../x": about } }), userEmail: "x", permissions: staff }), ArmatureError, "not a valid page name");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": { ...about, root: [{ ...heading("cccccccc", "x"), props: { text: "x", link: { href: "javascript:alert(1)" } } }] } } }), userEmail: "x", permissions: staff }), ArmatureError, "must start with");
  assertEquals(commits.length, 0);
});

Deno.test("when someone published in between, separate edits merge and the same edit asks", async () => {
  const theirs = page("about-us", "/about-us/", [heading("aaaaaaaa", "About"), heading("bbbbbbbb", "Our team")], "About us");
  const { repo, commits } = fakeRepo({ [BASE]: file(about), [HEAD]: file(theirs) }, HEAD);
  const mine = page("about-us", "/about-us/", [heading("aaaaaaaa", "About Alder & Stone"), heading("bbbbbbbb", "Team")], "About us");
  const merged = await runBuilderPublish({ repo, input: input({ layouts: { "about-us": mine } }), userEmail: "x", permissions: staff });
  assertEquals(merged.merged, true);
  const written = committed(commits[0], layoutPath("about-us"));
  assertEquals(written.root.map((element: Element) => element.props["text"]), ["About Alder & Stone", "Our team"]);

  const clash = page("about-us", "/about-us/", [heading("aaaaaaaa", "About"), heading("bbbbbbbb", "The team")], "About us");
  const error = await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": clash } }), userEmail: "x", permissions: staff }), ArmatureError);
  assertEquals(error.code, "conflict");
  assertEquals(error.conflicts.map((conflict) => conflict.key), ["layout:about-us:bbbbbbbb"]);
  const kept = await runBuilderPublish({ repo, input: input({ layouts: { "about-us": clash }, resolutions: { "layout:about-us:bbbbbbbb": "mine" } }), userEmail: "x", permissions: staff });
  assertEquals(kept.layouts, ["about-us"]);
  assertEquals(committed(commits[commits.length - 1], layoutPath("about-us")).root[1].props.text, "The team");
});

Deno.test("clients: the editing level, locks and agency-only widgets are enforced against what is committed", async () => {
  const locked = page("about-us", "/about-us/", [heading("aaaaaaaa", "About", { locked: true }), heading("bbbbbbbb", "Team"), { id: "htmlhtml", type: "html", props: { code: "<p>x</p>" }, style: {}, advanced: {}, meta }], "About us");
  const { repo, commits } = fakeRepo({ [BASE]: file(locked) }, BASE);
  const client = (level: "content" | "style" | "builder") => permissionsFor(false, level);
  const reorder = { ...locked, root: [locked.root[1]!, locked.root[0]!, locked.root[2]!] };
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": reorder } }), userEmail: "c", permissions: client("builder") }), ArmatureError, "locked and cannot be moved");
  const restyled = { ...locked, root: [{ ...locked.root[0]!, style: { color: "#ff0000" } }, locked.root[1]!, locked.root[2]!] };
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": restyled } }), userEmail: "c", permissions: client("builder") }), ArmatureError, "cannot be restyled");
  const embed = { ...locked, root: [locked.root[0]!, locked.root[1]!, { ...locked.root[2]!, props: { code: "<script>alert(1)</script>" } }] };
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": embed } }), userEmail: "c", permissions: client("builder") }), ArmatureError, "managed by the agency");
  const added = { ...locked, root: [...locked.root, heading("cccccccc", "New")] };
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": added } }), userEmail: "c", permissions: client("style") }), ArmatureError, "not add, move or remove");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": added } }), userEmail: "c", permissions: client("content") }), ArmatureError, "words and pictures only");
  assertEquals(commits.length, 0);
  // Allowed: words in a locked element, a new element at the builder level.
  const words = { ...locked, root: [{ ...locked.root[0]!, props: { text: "About us", tag: "h2" } }, locked.root[1]!, locked.root[2]!, heading("cccccccc", "New")] };
  const outcome = await runBuilderPublish({ repo, input: input({ layouts: { "about-us": words } }), userEmail: "c", permissions: client("builder") });
  assertEquals(outcome.layouts, ["about-us"]);
  // The kit is refused at the content level only.
  await assertRejects(() => runBuilderPublish({ repo, input: input({ kit: { ...defaultSiteKit(), pageBackground: "#000000" } }), userEmail: "c", permissions: client("content") }), ArmatureError, "colours and fonts");
});

Deno.test("deleting a builder page removes its file; nothing to publish is refused", async () => {
  const { repo, commits } = fakeRepo({ [BASE]: file(about) }, BASE);
  const outcome = await runBuilderPublish({ repo, input: input({ layouts: { "about-us": null } }), userEmail: "x", permissions: staff });
  assertEquals(outcome.layouts, ["about-us"]);
  assertEquals(commits[0]?.files.find((entry) => entry.path === layoutPath("about-us"))?.delete, true);
  await assertRejects(() => runBuilderPublish({ repo, input: input({}), userEmail: "x", permissions: staff }), ArmatureError, "no changes");
});

Deno.test("extractUploads refuses oversize or broken pictures and leaves links alone", async () => {
  const files = new Map<string, CommitFile>();
  const errors: string[] = [];
  const result = await extractUploads({ a: "https://example.com/x.png", b: ["data:image/png;base64,iVBORw0KGgo="], c: "data:image/png;base64,@@@" }, "home", files, errors);
  assertEquals((result as { a: string }).a, "https://example.com/x.png");
  assert(((result as { b: string[] }).b[0] ?? "").startsWith("/assets/uploads/home-"));
  assertEquals(files.size, 1);
  assertEquals(errors.length, 1);
});
