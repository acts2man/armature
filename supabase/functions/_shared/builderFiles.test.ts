import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { serializeBuilderFile } from "../../../shared/builder/schema.ts";
import { defaultSiteKit } from "../../../kit/defaults.ts";
import { loadBuilderFiles } from "./builderFiles.ts";
import type { ContentRepo, TreeEntry } from "./githubRepo.ts";

const layout = {
  version: 1,
  pageSlug: "contact",
  path: "/contact/",
  label: "Contact",
  root: [{ id: "a1b2c3d4", type: "heading", props: { text: "Hello", tag: "h1" }, style: {}, advanced: {}, meta: { createdBy: "t", updatedAt: "2026-09-22" } }],
};

function fakeRepo(files: Record<string, string>): ContentRepo {
  return {
    getBranchHead: () => Promise.resolve("head"),
    listTree: (directory) =>
      Promise.resolve(
        Object.entries(files)
          .filter(([path]) => path.startsWith(`${directory}/`))
          .map(([path, text]): TreeEntry => ({ path, sha: `sha-${path}`, size: text.length })),
      ),
    readTextFile: (path) => (path in files ? Promise.resolve({ text: files[path]!, sha: `sha-${path}` }) : Promise.reject(new Error(`no ${path}`))),
    commit: () => Promise.reject(new Error("not used")),
  };
}

Deno.test("loadBuilderFiles reads valid layouts, the kit, media meta and the asset list", async () => {
  const repo = fakeRepo({
    "content/layouts/contact.json": serializeBuilderFile(layout),
    "content/site-kit.json": serializeBuilderFile(defaultSiteKit()),
    "content/media.json": JSON.stringify({ "/assets/hero.webp": { alt: "A house" } }),
    "public/assets/hero.webp": "binary",
    "public/assets/uploads/photo.jpg": "binary",
    "public/assets/notes.txt": "text",
  });
  const files = await loadBuilderFiles(repo, "head");
  assertEquals(Object.keys(files.layouts), ["contact"]);
  assertEquals(files.layouts["contact"]?.root[0]?.type, "heading");
  assertEquals(files.siteKit?.version, 1);
  assertEquals(files.media.map((file) => file.path).sort(), ["/assets/hero.webp", "/assets/uploads/photo.jpg"]);
  assertEquals(files.media.find((file) => file.path === "/assets/hero.webp")?.alt, "A house");
  assertEquals(files.warnings, []);
});

Deno.test("loadBuilderFiles skips a broken layout and a broken kit with a warning, never throwing", async () => {
  const repo = fakeRepo({
    "content/layouts/bad.json": "{ not json",
    "content/layouts/wrong.json": serializeBuilderFile({ ...layout, root: [{ ...layout.root[0], id: "TOO-LONG-ID" }] }),
    "content/layouts/contact.json": serializeBuilderFile(layout),
    "content/site-kit.json": JSON.stringify({ version: 2 }),
  });
  const files = await loadBuilderFiles(repo, "head");
  assertEquals(Object.keys(files.layouts), ["contact"]);
  assertEquals(files.siteKit, null);
  assertStringIncludes(files.warnings.join("\n"), "bad.json: not valid JSON");
  assertStringIncludes(files.warnings.join("\n"), "wrong.json");
  assertStringIncludes(files.warnings.join("\n"), "default kit applies");
});
