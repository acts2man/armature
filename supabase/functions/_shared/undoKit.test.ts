import { assertEquals } from "jsr:@std/assert@1";
import { buildUndoFiles, readKitFilesAtRef } from "./undoKit.ts";
import type { ContentRepo } from "./githubRepo.ts";

Deno.test("buildUndoFiles: rewrites files whose contents differ and adds ones the current head is missing", () => {
  const files = buildUndoFiles({
    kitPath: "src/lib/armature-kit",
    restoredFiles: { "index.ts": "old-index", "widgets.tsx": "same", "renderer.tsx": "old-renderer" },
    currentFiles:  { "index.ts": "new-index", "widgets.tsx": "same" },
  });
  const byPath = Object.fromEntries(files.map((entry) => [entry.path, entry]));
  assertEquals(byPath["src/lib/armature-kit/index.ts"]?.content, "old-index");
  assertEquals(byPath["src/lib/armature-kit/renderer.tsx"]?.content, "old-renderer");
  assertEquals(byPath["src/lib/armature-kit/widgets.tsx"], undefined); // identical, skipped
});

Deno.test("buildUndoFiles: emits delete markers for files present only on the current head", () => {
  const files = buildUndoFiles({
    kitPath: "kit",
    restoredFiles: { "keep.ts": "old" },
    currentFiles:  { "keep.ts": "old", "gone.ts": "later" },
  });
  const byPath = Object.fromEntries(files.map((entry) => [entry.path, entry]));
  assertEquals(byPath["kit/gone.ts"]?.delete, true);
  assertEquals(byPath["kit/gone.ts"]?.content, "");
});

Deno.test("buildUndoFiles: returns [] when both trees match", () => {
  const files = buildUndoFiles({
    kitPath: "kit",
    restoredFiles: { "a.ts": "1", "b.ts": "2" },
    currentFiles:  { "a.ts": "1", "b.ts": "2" },
  });
  assertEquals(files, []);
});

Deno.test("buildUndoFiles: strips leading and trailing slashes on kitPath", () => {
  const files = buildUndoFiles({
    kitPath: "/kit/",
    restoredFiles: { "a.ts": "1" },
    currentFiles:  {},
  });
  assertEquals(files[0]?.path, "kit/a.ts");
});

Deno.test("readKitFilesAtRef: reads only whitelisted extensions and returns kit-relative keys", async () => {
  const tree = [
    { path: "kit/index.ts", sha: "1" },
    { path: "kit/widgets.tsx", sha: "2" },
    { path: "kit/styles.css", sha: "3" },
    { path: "kit/README.md", sha: "4" },
    { path: "kit/logo.png", sha: "5" },
    { path: "kit/nested/deep.ts", sha: "6" },
    { path: "outside/other.ts", sha: "7" },
  ];
  const bodies: Record<string, string> = {
    "kit/index.ts": "index",
    "kit/widgets.tsx": "widgets",
    "kit/styles.css": "css",
    "kit/nested/deep.ts": "deep",
  };
  const repo = {
    listTree: () => Promise.resolve(tree),
    readTextFile: (path: string) => Promise.resolve({ text: bodies[path] ?? "", sha: "sha" }),
    getBranchHead: () => Promise.resolve("head"),
    commit: () => Promise.reject(new Error("unused in this test")),
  } as unknown as ContentRepo;
  const files = await readKitFilesAtRef(repo, "kit", "some-ref");
  assertEquals(files, {
    "index.ts": "index",
    "widgets.tsx": "widgets",
    "styles.css": "css",
    "nested/deep.ts": "deep",
  });
});
