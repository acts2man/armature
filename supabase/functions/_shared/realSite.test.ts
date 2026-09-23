/**
 * The first real converted site (tests/fixtures/treetestprep: its content/ folder as
 * committed) through the same code the dashboard runs: loading every builder file, the
 * content files, and a publish round trip that must write the files back unchanged.
 */
import { assertEquals } from "jsr:@std/assert@1";
import { layoutPath, serializeBuilderFile, SITE_KIT_PATH } from "../../../shared/builder/schema.ts";
import { CONTENT_PATH } from "../../../shared/contentFile.ts";
import { SCHEMA_PATH } from "../../../shared/schema.ts";
import type { LayoutDoc } from "../../../kit/types.ts";
import { loadBuilderFiles } from "./builderFiles.ts";
import { permissionsFor, runBuilderPublish } from "./builderPublish.ts";
import type { CommitFile, ContentRepo } from "./githubRepo.ts";
import { loadSiteFiles } from "./publish.ts";

const FIXTURE = new URL("../../../tests/fixtures/treetestprep/", import.meta.url);
const read = (name: string) => Deno.readTextFileSync(new URL(name, FIXTURE));
const layoutNames = [...Deno.readDirSync(new URL("layouts/", FIXTURE))].map((entry) => entry.name).filter((name) => name.endsWith(".json")).sort();

function fixtureRepo(head = "head0000") {
  const files: Record<string, string> = { [SCHEMA_PATH]: read("schema.json"), [CONTENT_PATH]: read("pages.json"), [SITE_KIT_PATH]: read("site-kit.json") };
  for (const name of layoutNames) files[`content/layouts/${name}`] = read(`layouts/${name}`);
  const commits: { message: string; files: CommitFile[] }[] = [];
  const repo: ContentRepo = {
    getBranchHead: () => Promise.resolve(head),
    readTextFile: (path) => (path in files ? Promise.resolve({ text: files[path]!, sha: `sha-${path}` }) : Promise.reject(new Error(`no ${path}`))),
    listTree: (directory) => Promise.resolve(Object.keys(files).filter((path) => path.startsWith(`${directory}/`)).map((path) => ({ path, sha: path, size: files[path]!.length }))),
    commit: (input) => {
      commits.push(input);
      return Promise.resolve({ commitSha: "new00000", commitUrl: "https://github.com/acts2man/treetestprep/commit/new00000" });
    },
  };
  return { repo, commits, files };
}

Deno.test("treetestprep: every layout and the kit load with no warnings and no problems, exactly as committed", async () => {
  const { repo, files } = fixtureRepo();
  const builder = await loadBuilderFiles(repo, "head0000");
  assertEquals(builder.warnings, []);
  assertEquals(builder.problems, []);
  assertEquals(Object.keys(builder.layouts).sort(), layoutNames.map((name) => name.slice(0, -5)));
  for (const name of layoutNames) assertEquals(builder.layouts[name.slice(0, -5)], JSON.parse(files[`content/layouts/${name}`]!));
  assertEquals(builder.siteKit, JSON.parse(files[SITE_KIT_PATH]!));
  const site = await loadSiteFiles(repo, "head0000");
  assertEquals(site.contentErrors, []);
  assertEquals(site.pages.map((page) => page.slug).includes("home"), true);
});

Deno.test("treetestprep: a publish of an edited page writes the page back with only that edit changed", async () => {
  const { repo, commits, files } = fixtureRepo();
  const home = JSON.parse(files[layoutPath("home")]!) as LayoutDoc;
  const hero = home.root[0]!;
  const heading = hero.children![0]!.children![0]!;
  const edited: LayoutDoc = { ...home, root: [{ ...hero, children: [{ ...hero.children![0]!, children: [{ ...heading, props: { ...heading.props, text: "Pass the exam, first time" } }, ...hero.children![0]!.children!.slice(1)] }, ...hero.children!.slice(1)] }, ...home.root.slice(1)] };
  await runBuilderPublish({ repo, input: { baseCommitSha: "head0000", pages: [], layouts: { home: edited }, kit: null, media: null, resolutions: {} }, userEmail: "troy@example.test", permissions: permissionsFor(true, "builder") });
  assertEquals(commits.length, 1);
  const written = JSON.parse(commits[0]!.files.find((file) => file.path === layoutPath("home"))!.content) as LayoutDoc;
  // Everything but the edited words is byte-for-byte what the file already held (canonical key order aside).
  assertEquals(serializeBuilderFile({ ...written, root: [{ ...written.root[0]!, children: [{ ...written.root[0]!.children![0]!, children: [{ ...written.root[0]!.children![0]!.children![0]!, props: heading.props }, ...written.root[0]!.children![0]!.children!.slice(1)] }, ...written.root[0]!.children!.slice(1)] }, ...written.root.slice(1)] }), serializeBuilderFile(home));
  assertEquals(written.root[0]!.children![0]!.children![0]!.props["text"], "Pass the exam, first time");
});

Deno.test("treetestprep: the kit publishes unchanged values back exactly, and a colour change alone", async () => {
  const { repo, commits, files } = fixtureRepo();
  const kit = JSON.parse(files[SITE_KIT_PATH]!) as { colors: { accent: string } };
  await runBuilderPublish({ repo, input: { baseCommitSha: "head0000", pages: [], layouts: {}, kit: { ...kit, colors: { ...kit.colors, accent: "#c9b26b" } }, media: null, resolutions: {} }, userEmail: "troy@example.test", permissions: permissionsFor(true, "builder") });
  const written = JSON.parse(commits[0]!.files.find((file) => file.path === SITE_KIT_PATH)!.content) as { colors: { accent: string } };
  assertEquals(written.colors.accent, "#c9b26b");
  assertEquals(serializeBuilderFile({ ...written, colors: { ...written.colors, accent: kit.colors.accent } }), serializeBuilderFile(kit));
});
