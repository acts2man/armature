import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { CONTENT_PATH, serializeContent } from "../../../shared/contentFile.ts";
import { SCHEMA_PATH } from "../../../shared/schema.ts";
import { layoutPath, MEDIA_META_PATH, serializeBuilderFile, SITE_KIT_PATH, trashPath } from "../../../shared/builder/schema.ts";
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
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": { ...about, root: [{ ...heading("cccccccc", "x"), props: { text: "x", link: { href: "javascript:alert(1)" } } }] } } }), userEmail: "x", permissions: staff }), ArmatureError, "a link starting with https://");
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

Deno.test("a style-level client may restyle a coded page's sections, giving it its first layout, but not add to it", async () => {
  const { repo, commits } = fakeRepo({ [BASE]: {} }, BASE);
  const section = (id: string, key: string): Element => ({ id, type: "site-section", props: { key }, style: { background: { kind: "color", color: "#f3efe6" } } as Element["style"], advanced: {}, meta });
  const restyled = page("home", "/", [section("sechero1", "hero"), section("secabout", "about")]);
  const style = permissionsFor(false, "style");
  const outcome = await runBuilderPublish({ repo, input: input({ layouts: { home: restyled } }), userEmail: "c", permissions: style });
  assertEquals(outcome.layouts, ["home"]);
  const added = { ...restyled, root: [...restyled.root, heading("cccccccc", "New")] };
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { home: added } }), userEmail: "c", permissions: style }), ArmatureError, "not add, move or remove");
  // A builder-only page is still creation, which the style level cannot do.
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": about } }), userEmail: "c", permissions: style }), ArmatureError, "cannot create or delete pages");
  assertEquals(commits.length, 1);
});

Deno.test("values the validator cannot read are kept exactly as committed, and only new ones are refused", async () => {
  // The committed page holds a colour the validator cannot read and an element with a broken id.
  const rawCommitted = {
    ...about,
    root: [{ ...heading("aaaaaaaa", "About"), style: { color: "navy-ish", typography: { fontWeight: 650 } } }, { id: "BROKEN", type: "heading", props: { text: "Old" } }, heading("bbbbbbbb", "Team")],
  };
  const { repo, commits } = fakeRepo({ [BASE]: file(rawCommitted as unknown as LayoutDoc) }, BASE);
  // The editor works on the cleaned page (no colour, a placeholder) and changes the second heading only.
  const cleaned = { ...about, root: [{ ...heading("aaaaaaaa", "About"), style: { typography: { fontWeight: 650 } } }, { id: "placehld", type: "unsupported", props: { originalType: "heading", reason: "x" }, style: {}, advanced: {}, meta }, heading("bbbbbbbb", "Our team")] };
  // The dashboard puts the raw values back before sending (shared/builder/preserve.ts); so does the function.
  await runBuilderPublish({ repo, input: input({ layouts: { "about-us": { ...cleaned, root: [{ ...cleaned.root[0]!, style: { color: "navy-ish", typography: { fontWeight: 650 } } }, { id: "BROKEN", type: "heading", props: { text: "Old" } }, cleaned.root[2]!] } } }), userEmail: "x", permissions: staff });
  const written = committed(commits[0], layoutPath("about-us")) as LayoutDoc;
  assertEquals(written.root[0]?.style, { color: "navy-ish", typography: { fontWeight: 650 } });
  assertEquals(written.root[1] as unknown, { id: "BROKEN", type: "heading", props: { text: "Old" } });
  assertEquals(written.root[2]?.props["text"], "Our team");

  // A new unreadable value is refused, and the message says what, where and what is allowed.
  const fresh = { ...cleaned, root: [{ ...cleaned.root[0]!, style: { color: "greenish" } }] };
  await assertRejects(() => runBuilderPublish({ repo, input: input({ layouts: { "about-us": fresh } }), userEmail: "x", permissions: staff }), ArmatureError, 'Style › Color is "greenish"');
  assertEquals(commits.length, 1);
});

Deno.test("the bin: a trashed page's file moves byte for byte, restores, and cannot collide with a live page", async () => {
  // The committed file carries a value the validator cannot read (font weight as a word);
  // moving it to the bin and back must keep it exactly.
  const text = serializeBuilderFile({ ...about, root: [{ ...about.root[0]!, style: { fontWeight: "heavyish" } }, about.root[1]!] });
  const { repo, commits } = fakeRepo({ [BASE]: { [layoutPath("about-us")]: text } }, BASE);
  const client = permissionsFor(false, "content");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ trash: { "about-us": "trash" } }), userEmail: "x", permissions: client }), ArmatureError, "words and pictures only");
  const outcome = await runBuilderPublish({ repo, input: input({ trash: { "about-us": "trash" } }), userEmail: "owner@example.com", permissions: staff });
  assertEquals(outcome.trash, ["about-us"]);
  assertEquals(outcome.layouts, []);
  const commit = commits[0]!;
  assertEquals(commit.files.find((file) => file.path === layoutPath("about-us"))?.delete, true);
  assertEquals(commit.files.find((file) => file.path === trashPath("about-us"))?.content, text);
  assertStringIncludes(commit.message, "About us (to the bin)");

  // Restore from a repository where the file now sits in the bin.
  const binned = fakeRepo({ [HEAD]: { [trashPath("about-us")]: text } }, HEAD);
  const back = await runBuilderPublish({ repo: binned.repo, input: input({ baseCommitSha: HEAD, trash: { "about-us": "restore" } }), userEmail: "x", permissions: staff });
  assertEquals(back.trash, ["about-us"]);
  const restore = binned.commits[0]!;
  assertEquals(restore.files.find((file) => file.path === layoutPath("about-us"))?.content, text);
  assertEquals(restore.files.find((file) => file.path === trashPath("about-us"))?.delete, true);

  // A live page with the same name, or the same address, blocks a restore; a coded page's name too.
  const clash = fakeRepo({ [HEAD]: { [trashPath("about-us")]: text, [layoutPath("about-us")]: serializeBuilderFile(about) } }, HEAD);
  await assertRejects(() => runBuilderPublish({ repo: clash.repo, input: input({ baseCommitSha: HEAD, trash: { "about-us": "restore" } }), userEmail: "x", permissions: staff }), ArmatureError, "already exists");
  const sameAddress = fakeRepo({ [HEAD]: { [trashPath("about-us")]: text, [layoutPath("team")]: serializeBuilderFile({ ...about, pageSlug: "team", label: "Team" }) } }, HEAD);
  await assertRejects(() => runBuilderPublish({ repo: sameAddress.repo, input: input({ baseCommitSha: HEAD, trash: { "about-us": "restore" } }), userEmail: "x", permissions: staff }), ArmatureError, "already uses");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ trash: { home: "trash" } }), userEmail: "x", permissions: staff }), ArmatureError, "coded into the site");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ trash: { nowhere: "trash" } }), userEmail: "x", permissions: staff }), ArmatureError, "no page called");

  // Delete for good, from the bin only.
  const gone = await runBuilderPublish({ repo: binned.repo, input: input({ baseCommitSha: HEAD, trash: { "about-us": "delete" } }), userEmail: "x", permissions: staff });
  assertEquals(gone.trash, ["about-us"]);
  const bodyFiles = binned.commits[1]!.files.filter((file) => !file.path.startsWith("public/sitemap") && !file.path.startsWith("public/robots"));
  assertEquals(bodyFiles, [{ path: trashPath("about-us"), content: "", encoding: "utf-8", delete: true }]);
  await assertRejects(() => runBuilderPublish({ repo, input: input({ trash: { "about-us": "delete" } }), userEmail: "x", permissions: staff }), ArmatureError, "in the bin");
});

Deno.test("a copy is made on the server from the committed file, so unread values survive and the name and address are new", async () => {
  const text = serializeBuilderFile({ ...about, root: [{ ...about.root[0]!, style: { fontWeight: "heavyish" } }, about.root[1]!] });
  const { repo, commits } = fakeRepo({ [BASE]: { [layoutPath("about-us")]: text } }, BASE);
  const outcome = await runBuilderPublish({ repo, input: input({ copies: { "about-us-copy": { from: "about-us", label: "About us (copy)", path: "/about-us-copy/" } } }), userEmail: "x", permissions: staff });
  assertEquals(outcome.layouts, ["about-us-copy"]);
  const written = committed(commits[0], layoutPath("about-us-copy"));
  assertEquals(written.pageSlug, "about-us-copy");
  assertEquals(written.path, "/about-us-copy/");
  assertEquals(written.label, "About us (copy)");
  assertEquals(written.root[0].style.fontWeight, "heavyish");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ copies: { "about-us": { from: "about-us", label: "", path: "" } } }), userEmail: "x", permissions: staff }), ArmatureError, "already exists");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ copies: { "second": { from: "about-us", label: "Second", path: "/about-us/" } } }), userEmail: "x", permissions: staff }), ArmatureError, "already uses");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ copies: { "second": { from: "nowhere", label: "", path: "" } } }), userEmail: "x", permissions: staff }), ArmatureError, "no page called");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ copies: { "second": { from: "about-us", label: "", path: "" } } }), userEmail: "x", permissions: permissionsFor(false, "style") }), ArmatureError, "add");
});

Deno.test("the media library: uploads keep their names (made safe and unique) and a deletion takes its alt text with it", async () => {
  const { repo, commits } = fakeRepo({ [BASE]: { "public/assets/team.svg": "<svg/>", "public/assets/uploads/site-visit.webp": "x", [MEDIA_META_PATH]: serializeBuilderFile({ "/assets/team.svg": { alt: "The crew" }, "/assets/uploads/site-visit.webp": { alt: "A visit" } }) } }, BASE);
  const outcome = await runBuilderPublish({ repo, input: input({ uploads: [{ name: "Site Visit.WEBP", data: "data:image/webp;base64,UklGRg==" }, { name: "../evil name.png", data: "data:image/png;base64,iVBORw0KGgo=" }] }), userEmail: "x", permissions: permissionsFor(false, "content") });
  assertEquals(outcome.images, ["/assets/uploads/site-visit-2.webp", "/assets/uploads/evil-name.png"]);
  assert(commits[0]?.files.some((file) => file.path === "public/assets/uploads/site-visit-2.webp" && file.encoding === "base64"));
  assertStringIncludes(commits[0]?.message ?? "", "Media library");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ uploads: [{ name: "a.txt", data: "data:text/plain;base64,aGk=" }] }), userEmail: "x", permissions: staff }), ArmatureError, "not a PNG, JPEG, WebP or GIF");

  await assertRejects(() => runBuilderPublish({ repo, input: input({ deleteAssets: ["/assets/team.svg"] }), userEmail: "x", permissions: permissionsFor(false, "style") }), ArmatureError, "cannot delete pictures");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ deleteAssets: ["/assets/nowhere.png"] }), userEmail: "x", permissions: staff }), ArmatureError, "no picture at");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ deleteAssets: ["/etc/passwd"] }), userEmail: "x", permissions: staff }), ArmatureError, "not a picture on this site");
  const gone = await runBuilderPublish({ repo, input: input({ deleteAssets: ["/assets/team.svg"] }), userEmail: "x", permissions: staff });
  assertEquals(gone.deleted, ["/assets/team.svg"]);
  assertEquals(gone.media, true);
  const last = commits.at(-1)!;
  assertEquals(last.files.find((file) => file.path === "public/assets/team.svg")?.delete, true);
  assertEquals(committed(last, MEDIA_META_PATH), { "/assets/uploads/site-visit.webp": { alt: "A visit" } });
});

Deno.test("a header built in the editor publishes as content/layouts/_header.json without an address of its own", async () => {
  const { repo, commits } = fakeRepo({ [BASE]: {} }, BASE);
  const header: LayoutDoc = { version: 1, pageSlug: "_header", path: "/", label: "Header", root: [{ id: "logologo", type: "site-logo", props: { src: "/assets/logo.svg", alt: "Acme" }, style: {}, advanced: {}, meta }, { id: "navnavna", type: "nav-menu", props: { menu: "main", breakpoint: 767 }, style: {}, advanced: {}, meta }] };
  const outcome = await runBuilderPublish({ repo, input: input({ layouts: { _header: header } }), userEmail: "x", permissions: staff });
  assertEquals(outcome.layouts, ["_header"]);
  assertEquals(committed(commits[0], layoutPath("_header")).pageSlug, "_header");
  assertStringIncludes(commits[0]?.message ?? "", "Header");
  // A kit with menus goes through the same publish.
  const kit = { ...defaultSiteKit(), menus: [{ id: "main", name: "Main menu", items: [{ id: "home", label: "Home", kind: "page", page: "home" }, { id: "more", label: "More", kind: "url", href: "https://example.com", children: [{ id: "sub", label: "Sub", kind: "page", page: "about" }] }] }] };
  const withMenus = await runBuilderPublish({ repo, input: input({ kit }), userEmail: "x", permissions: staff });
  assertEquals(withMenus.kit, true);
  assertEquals(committed(commits[1], SITE_KIT_PATH).menus[0].items[1].children[0].label, "Sub");
  await assertRejects(() => runBuilderPublish({ repo, input: input({ kit: { ...kit, menus: [{ id: "bad id", name: "x", items: [] }] } }), userEmail: "x", permissions: staff }), ArmatureError, "an id of lowercase letters");
});

Deno.test("every publish writes sitemap.xml and robots.txt with the site URL from the kit's SEO block", async () => {
  const { repo, commits } = fakeRepo({ [BASE]: {} }, BASE);
  const kit = { ...defaultSiteKit(), seo: { siteName: "Acme Homes", siteUrl: "https://acmehomes.com", titlePattern: "%page% | %site%" } };
  const noindexPage: LayoutDoc = { ...about, seo: { noindex: true } };
  const outcome = await runBuilderPublish({ repo, input: input({ layouts: { "about-us": noindexPage }, kit }), userEmail: "x", permissions: staff });
  assertEquals(outcome.layouts, ["about-us"]);
  const sitemap = commits[0]?.files.find((file) => file.path === "public/sitemap.xml");
  const robots = commits[0]?.files.find((file) => file.path === "public/robots.txt");
  assert(sitemap, "sitemap.xml missing from the commit");
  assert(robots, "robots.txt missing from the commit");
  assertStringIncludes(sitemap!.content, '<?xml version="1.0"');
  // The noindex about-us page is skipped; only the home path "/" is left (the coded pages
  // in the fixture share paths and dedupe to one entry).
  assertEquals((sitemap!.content.match(/<loc>/g) ?? []).length, 1);
  assert(!sitemap!.content.includes("/about-us/"), "the noindex page should not be listed");
  assertStringIncludes(sitemap!.content, "https://acmehomes.com/");
  assertStringIncludes(robots!.content, "User-agent: *");
  assertStringIncludes(robots!.content, "Sitemap: https://acmehomes.com/sitemap.xml");
});

Deno.test("sitemap.xml and robots.txt are only rewritten when the file would change", async () => {
  // Two publishes with the same pages on the same day: the second commit should not carry
  // the SEO files. The lastmod is a calendar day (UTC), so a fixed `now` on both keeps
  // them identical.
  const fixedNow = () => Date.UTC(2026, 4, 1, 12, 0);
  const kit = { ...defaultSiteKit(), seo: { siteName: "Acme", siteUrl: "https://acme.example.com" } };
  const publishOnce = async (state: Record<string, Files>, head: string) => {
    const { repo, commits } = fakeRepo(state, head);
    await runBuilderPublish({ repo, input: input({ layouts: { "about-us": about }, kit }), userEmail: "x", permissions: staff, now: fixedNow });
    return commits[0]!;
  };
  const first = await publishOnce({ [BASE]: {} }, BASE);
  const sitemapText = first.files.find((file) => file.path === "public/sitemap.xml")?.content ?? "";
  const robotsText = first.files.find((file) => file.path === "public/robots.txt")?.content ?? "";
  assert(sitemapText && robotsText);
  const second = await publishOnce({ [HEAD]: { [layoutPath("about-us")]: serializeBuilderFile(about), [SITE_KIT_PATH]: serializeBuilderFile(kit), "public/sitemap.xml": sitemapText, "public/robots.txt": robotsText } }, HEAD);
  assertEquals(second.files.filter((file) => file.path === "public/sitemap.xml").length, 0);
  assertEquals(second.files.filter((file) => file.path === "public/robots.txt").length, 0);
});
