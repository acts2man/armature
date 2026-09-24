import { assertEquals } from "jsr:@std/assert@1";
import { buildRestoreFiles, fullTree } from "./undoSiteSetup.ts";
import type { ContentRepo } from "./githubRepo.ts";

type Tree = Record<string, { sha: string; body?: string }>;

function repoFor(trees: Record<string, Tree>): ContentRepo {
  return {
    getBranchHead: () => Promise.reject(new Error("not used")),
    readTextFile: (path: string, ref: string) => {
      const tree = trees[ref];
      const entry = tree?.[path];
      if (!entry) return Promise.reject(new Error(`missing ${path}`));
      return Promise.resolve({ text: entry.body ?? "", sha: entry.sha });
    },
    listTree: (_directory: string, ref: string) => {
      const tree = trees[ref] ?? {};
      return Promise.resolve(Object.entries(tree).map(([path, { sha }]) => ({ path, sha, size: 0 })));
    },
    commit: () => Promise.reject(new Error("not used")),
  } as unknown as ContentRepo;
}

Deno.test("fullTree: returns every blob under the given ref keyed by path", async () => {
  const repo = repoFor({
    r1: {
      "index.html": { sha: "aaa" },
      "src/main.tsx": { sha: "bbb" },
      "public/logo.svg": { sha: "ccc" },
    },
  });
  const tree = await fullTree(repo, "r1");
  assertEquals(tree, { "index.html": "aaa", "src/main.tsx": "bbb", "public/logo.svg": "ccc" });
});

Deno.test("buildRestoreFiles: restores changed files and files present only in the pre-setup tree", async () => {
  const repo = repoFor({
    pre: {
      "index.html": { sha: "aaa", body: "<html>before</html>" },
      "src/App.tsx": { sha: "bbb", body: "console.log('before')" },
    },
    head: {
      "index.html": { sha: "aaz", body: "<html>after</html>" },
      "src/App.tsx": { sha: "bbb", body: "console.log('before')" },
      "src/lib/armature-kit/index.ts": { sha: "kit1", body: "// kit" },
    },
  });
  const files = await buildRestoreFiles(repo, "pre", "head");
  const byPath = Object.fromEntries(files.map((f) => [f.path, f]));

  // The changed file is restored to its pre-setup body.
  assertEquals(byPath["index.html"]?.content, "<html>before</html>");
  assertEquals(byPath["index.html"]?.delete, undefined);

  // Untouched file: skipped.
  assertEquals(byPath["src/App.tsx"], undefined);

  // File that appeared after setup is deleted.
  assertEquals(byPath["src/lib/armature-kit/index.ts"]?.delete, true);
});

Deno.test("buildRestoreFiles: returns [] when the trees match already", async () => {
  const same = {
    "index.html": { sha: "aaa", body: "" },
    "src/App.tsx": { sha: "bbb", body: "" },
  };
  const repo = repoFor({ pre: same, head: same });
  const files = await buildRestoreFiles(repo, "pre", "head");
  assertEquals(files, []);
});

Deno.test("buildRestoreFiles: restoring a file the head deleted (present only in pre) puts it back", async () => {
  const repo = repoFor({
    pre: { "content/pages.json": { sha: "aaa", body: "{}" } },
    head: {},
  });
  const files = await buildRestoreFiles(repo, "pre", "head");
  assertEquals(files.length, 1);
  assertEquals(files[0]?.path, "content/pages.json");
  assertEquals(files[0]?.content, "{}");
  assertEquals(files[0]?.delete, undefined);
});
