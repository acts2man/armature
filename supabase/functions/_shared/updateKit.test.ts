import { assertEquals } from "jsr:@std/assert@1";
import { commitFilesFor, planKitUpdate, readCurrentKitFiles, type KitPackage } from "./updateKit.ts";
import type { ContentRepo } from "./githubRepo.ts";

const pkg = (version: string, files: Record<string, string>): KitPackage => ({ kitVersion: version, files });

Deno.test("planKitUpdate: adds new files, changes matching-path files, removes gone files", () => {
  const currentPackage = pkg("2.8.0", { "index.ts": "new", "renderer.tsx": "new", "widgets.tsx": "same" });
  const currentFiles = { "index.ts": "old", "widgets.tsx": "same", "old-file.ts": "delete-me" };
  const plan = planKitUpdate({ kitPath: "src/lib/armature-kit", currentPackage, currentFiles });
  assertEquals(plan.toAdd, ["src/lib/armature-kit/renderer.tsx"]);
  assertEquals(plan.toChange, ["src/lib/armature-kit/index.ts"]);
  assertEquals(plan.toRemove, ["src/lib/armature-kit/old-file.ts"]);
  assertEquals(plan.localEdits, []);
});

Deno.test("planKitUpdate: reports local edits when current files differ from the previous package", () => {
  const previous = pkg("2.7.0", { "index.ts": "prev", "renderer.tsx": "prev" });
  const current = pkg("2.8.0", { "index.ts": "new", "renderer.tsx": "new" });
  const currentFiles = { "index.ts": "prev", "renderer.tsx": "site-edited-me" };
  const plan = planKitUpdate({ kitPath: "kit", currentPackage: current, currentFiles, previousPackage: previous });
  assertEquals(plan.localEdits, ["kit/renderer.tsx"]);
});

Deno.test("planKitUpdate: overwrite suppresses the local-edits list", () => {
  const previous = pkg("2.7.0", { "index.ts": "prev" });
  const current = pkg("2.8.0", { "index.ts": "new" });
  const currentFiles = { "index.ts": "site-edited" };
  const plan = planKitUpdate({ kitPath: "kit", currentPackage: current, currentFiles, previousPackage: previous, overwrite: true });
  assertEquals(plan.localEdits, []);
});

Deno.test("commitFilesFor: builds one CommitFile per add/change and delete-marker for removes", () => {
  const currentPackage = pkg("2.8.0", { "index.ts": "new-body", "renderer.tsx": "new-r" });
  const currentFiles = { "renderer.tsx": "old-r", "orphan.ts": "bye" };
  const plan = planKitUpdate({ kitPath: "kit", currentPackage, currentFiles });
  const files = commitFilesFor({ kitPath: "kit", currentPackage, currentFiles }, plan);
  const byPath = Object.fromEntries(files.map((entry) => [entry.path, entry]));
  assertEquals(byPath["kit/index.ts"]?.content, "new-body");
  assertEquals(byPath["kit/renderer.tsx"]?.content, "new-r");
  assertEquals(byPath["kit/orphan.ts"]?.delete, true);
});

Deno.test("readCurrentKitFiles reads only kit_path files with allowed extensions", async () => {
  const files: Record<string, { text: string; sha: string }> = {
    "kit/index.ts": { text: "index", sha: "1" },
    "kit/library/basic.tsx": { text: "basic", sha: "2" },
    "kit/README.md": { text: "readme", sha: "3" },
    "kit/binary.wasm": { text: "wasm", sha: "4" },
  };
  const repo: ContentRepo = {
    getBranchHead: () => Promise.resolve("head"),
    readTextFile: (path: string) => files[path] ? Promise.resolve(files[path]) : Promise.reject(new Error("missing")),
    listTree: () => Promise.resolve(Object.keys(files).map((path) => ({ path, sha: path, size: 1 }))),
    commit: () => Promise.resolve({ commitSha: "", commitUrl: "" }),
  };
  const result = await readCurrentKitFiles(repo, "kit", "head");
  assertEquals(Object.keys(result).sort(), ["index.ts", "library/basic.tsx"]);
});
