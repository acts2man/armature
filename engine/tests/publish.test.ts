import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectChanges, readDiff } from "../publish/changes.ts";
import { merge3 } from "../publish/merge3.ts";
import { createMockRepo } from "../publish/mockRepo.ts";
import { publishChanges } from "../publish/publish.ts";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(dir: string, ...args: string[]): string {
  const result = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

const HOME_LINES = [
  'import { Hero } from "@/components/Hero";',
  "",
  "export default function Home() {",
  "  return (",
  "    <main>",
  "      <Hero />",
  "      <section className=\"intro\">",
  "        <h1>Welcome to Armature</h1>",
  "        <p>Edit your site in place.</p>",
  "        <p>Every change becomes a commit.</p>",
  "      </section>",
  "      <section className=\"features\">",
  "        <h2>Features</h2>",
  "        <ul>",
  "          <li>Visual editing</li>",
  "          <li>Git-backed history</li>",
  "          <li>Preview before publishing</li>",
  "        </ul>",
  "      </section>",
  "    </main>",
  "  );",
  "}",
];
const HOME = HOME_LINES.join("\n") + "\n";
const STYLES = "body {\n  margin: 0;\n}\n\n.intro {\n  padding: 2rem;\n}\n";
const SEED = { "src/pages/Home.tsx": HOME, "src/styles.css": STYLES };

/** A fresh git repo holding the seed files, committed. */
function makeWorkingCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "armature-publish-"));
  temps.push(dir);
  git(dir, "init", "-q");
  for (const [path, content] of Object.entries(SEED)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "seed");
  return dir;
}

function write(dir: string, path: string, content: string | Buffer): void {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), content);
}

function withLine(index: number, line: string): string {
  const lines = [...HOME_LINES];
  lines[index] = line;
  return lines.join("\n") + "\n";
}

describe("publishChanges", () => {
  it("(a) publishes one edited file as one commit when the branch has not moved", async () => {
    const dir = makeWorkingCopy();
    const repo = createMockRepo(SEED);
    const base = repo.state.head;
    write(dir, "src/pages/Home.tsx", withLine(7, "        <h1>Welcome to the new site</h1>"));

    const result = await publishChanges({ dir, repo, baseCommitSha: base, message: "Change heading" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toEqual(["src/pages/Home.tsx"]);
    expect(result.rebased).toEqual([]);
    expect(result.diff).toContain("-        <h1>Welcome to Armature</h1>");
    expect(result.diff).toContain("+        <h1>Welcome to the new site</h1>");
    expect(repo.state.commits).toHaveLength(2);
    expect(repo.state.head).toBe(result.commitSha);
    const commit = repo.state.commits[1];
    expect(commit?.message).toBe("Change heading");
    expect(commit?.files).toHaveLength(1);
    expect(repo.state.filesAt(result.commitSha)["src/pages/Home.tsx"]).toContain("Welcome to the new site");
  });

  it("(b) includes a new binary file as base64 and a new text file as utf-8", async () => {
    const dir = makeWorkingCopy();
    const repo = createMockRepo(SEED);
    const base = repo.state.head;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    write(dir, "public/x.png", png);
    write(dir, "src/pages/About.tsx", "export default function About() {\n  return <h1>About</h1>;\n}\n");

    const changes = collectChanges(dir);
    expect(changes).toEqual([
      { path: "public/x.png", status: "added", additions: 0, deletions: 0, binary: true },
      { path: "src/pages/About.tsx", status: "added", additions: 3, deletions: 0, binary: false },
    ]);

    const diff = readDiff(dir);
    expect(diff).toContain("Binary file added: public/x.png (12 bytes)");
    expect(diff).toContain("+++ b/src/pages/About.tsx");
    expect(diff).toContain("+  return <h1>About</h1>;");

    const result = await publishChanges({ dir, repo, baseCommitSha: base, message: "Add about page and image" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toEqual(["public/x.png", "src/pages/About.tsx"]);
    const files = repo.state.commits[1]?.files ?? [];
    expect(files.find((file) => file.path === "public/x.png")).toEqual({ path: "public/x.png", content: png.toString("base64"), encoding: "base64" });
    expect(files.find((file) => file.path === "src/pages/About.tsx")?.encoding).toBe("utf-8");
  });

  it("(c) rebases a file automatically when someone else changed other lines", async () => {
    const dir = makeWorkingCopy();
    const repo = createMockRepo(SEED);
    const base = repo.state.head;
    write(dir, "src/pages/Home.tsx", withLine(7, "        <h1>Welcome to the new site</h1>"));
    repo.moveBranch({ "src/pages/Home.tsx": withLine(15, "          <li>Git-backed history, forever</li>") });

    const result = await publishChanges({ dir, repo, baseCommitSha: base, message: "Change heading" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rebased).toEqual(["src/pages/Home.tsx"]);
    const committed = repo.state.filesAt(result.commitSha)["src/pages/Home.tsx"] ?? "";
    expect(committed).toContain("<h1>Welcome to the new site</h1>");
    expect(committed).toContain("<li>Git-backed history, forever</li>");
    expect(committed.split("\n")).toHaveLength(HOME_LINES.length + 1);
    expect(repo.state.commits.at(-1)?.files.map((file) => file.path)).toEqual(["src/pages/Home.tsx"]);
  });

  it("(d) reports a conflict on the same line, then accepts a 'mine' resolution", async () => {
    const dir = makeWorkingCopy();
    const repo = createMockRepo(SEED);
    const base = repo.state.head;
    write(dir, "src/pages/Home.tsx", withLine(7, "        <h1>Welcome to the new site</h1>"));
    repo.moveBranch({ "src/pages/Home.tsx": withLine(7, "        <h1>Hello from someone else</h1>") });
    const headAfterMove = repo.state.head;

    const first = await publishChanges({ dir, repo, baseCommitSha: base, message: "Change heading" });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.code).toBe("conflict");
    expect(first.conflicts).toHaveLength(1);
    expect(first.conflicts?.[0]?.path).toBe("src/pages/Home.tsx");
    expect(first.conflicts?.[0]?.message).toContain("src/pages/Home.tsx");
    expect(first.conflicts?.[0]?.message).toContain("1 place overlaps");
    expect(repo.state.head).toBe(headAfterMove);

    const second = await publishChanges({ dir, repo, baseCommitSha: base, message: "Change heading", resolutions: { "src/pages/Home.tsx": "mine" } });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.files).toEqual(["src/pages/Home.tsx"]);
    expect(second.rebased).toEqual([]);
    expect(repo.state.filesAt(second.commitSha)["src/pages/Home.tsx"]).toContain("Welcome to the new site");
    expect(repo.state.filesAt(second.commitSha)["src/pages/Home.tsx"]).not.toContain("Hello from someone else");
  });

  it("(d2) a 'theirs' resolution drops the file and leaves nothing to publish", async () => {
    const dir = makeWorkingCopy();
    const repo = createMockRepo(SEED);
    const base = repo.state.head;
    write(dir, "src/pages/Home.tsx", withLine(7, "        <h1>Welcome to the new site</h1>"));
    repo.moveBranch({ "src/pages/Home.tsx": withLine(7, "        <h1>Hello from someone else</h1>") });

    const result = await publishChanges({ dir, repo, baseCommitSha: base, message: "Change heading", resolutions: { "src/pages/Home.tsx": "theirs" } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("nothing");
    expect(repo.state.commits).toHaveLength(2);
  });

  it("(f) refuses when there is nothing to publish", async () => {
    const dir = makeWorkingCopy();
    const repo = createMockRepo(SEED);
    const result = await publishChanges({ dir, repo, baseCommitSha: repo.state.head, message: "Nothing" });
    expect(result).toEqual({ ok: false, code: "nothing", message: "Nothing to publish yet." });
    expect(repo.state.commits).toHaveLength(1);
  });

  it("turns a repo error into a github_error result", async () => {
    const dir = makeWorkingCopy();
    const repo = createMockRepo(SEED);
    const base = repo.state.head;
    write(dir, "src/styles.css", STYLES + ".x { color: red; }\n");
    const failing = { ...repo, commit: async () => { throw new Error("GitHub returned 500: boom"); } };
    const result = await publishChanges({ dir, repo: failing, baseCommitSha: base, message: "Style" });
    expect(result).toEqual({ ok: false, code: "github_error", message: "GitHub returned 500: boom" });
  });

  it("collects modified and deleted files with line counts", () => {
    const dir = makeWorkingCopy();
    write(dir, "src/styles.css", "body {\n  margin: 0;\n  padding: 0;\n}\n");
    rmSync(join(dir, "src/pages/Home.tsx"));
    expect(collectChanges(dir)).toEqual([
      { path: "src/pages/Home.tsx", status: "deleted", additions: 0, deletions: HOME_LINES.length, binary: false },
      { path: "src/styles.css", status: "modified", additions: 1, deletions: 4, binary: false },
    ]);
    expect(readFileSync(join(dir, "src/styles.css"), "utf8")).toContain("padding: 0;");
  });
});

describe("merge3", () => {
  const base = "a\nb\nc\nd\ne\nf\ng\n";

  it("(e) identical inputs merge to themselves", () => {
    expect(merge3(base, base, base)).toEqual({ ok: true, merged: base });
  });

  it("(e) identical changes on both sides are taken once", () => {
    const changed = "a\nB\nc\nd\ne\nf\ng\n";
    expect(merge3(base, changed, changed)).toEqual({ ok: true, merged: changed });
  });

  it("(e) non-overlapping changes both apply", () => {
    const mine = "a\nB\nc\nd\ne\nf\ng\n";
    const theirs = "a\nb\nc\nd\ne\nF\ng\n";
    expect(merge3(base, mine, theirs)).toEqual({ ok: true, merged: "a\nB\nc\nd\ne\nF\ng\n" });
  });

  it("(e) overlapping different changes conflict", () => {
    const mine = "a\nb\nC1\nd\ne\nf\ng\n";
    const theirs = "a\nb\nC2\nd\ne\nf\ng\n";
    expect(merge3(base, mine, theirs)).toEqual({ ok: false, conflicts: 1 });
  });

  it("(e) counts each overlapping region once", () => {
    const mine = "A1\nb\nc\nd\ne\nf\nG1\n";
    const theirs = "A2\nb\nc\nd\ne\nf\nG2\n";
    expect(merge3(base, mine, theirs)).toEqual({ ok: false, conflicts: 2 });
  });

  it("(e) one side unchanged takes the other side wholesale", () => {
    const theirs = "a\nc\nd\nX\nY\ne\nf\ng\nh\n";
    expect(merge3(base, base, theirs)).toEqual({ ok: true, merged: theirs });
    expect(merge3(base, theirs, base)).toEqual({ ok: true, merged: theirs });
  });

  it("(e) lines appended at opposite ends both survive", () => {
    const mine = "top\n" + base;
    const theirs = base + "bottom\n";
    expect(merge3(base, mine, theirs)).toEqual({ ok: true, merged: "top\n" + base + "bottom\n" });
  });

  it("(e) a deletion on one side and an edit elsewhere on the other", () => {
    const mine = "a\nb\nc\ne\nf\ng\n";
    const theirs = "a\nb\nc\nd\ne\nf\nG\n";
    expect(merge3(base, mine, theirs)).toEqual({ ok: true, merged: "a\nb\nc\ne\nf\nG\n" });
  });

  it("(e) keeps a missing final newline when the base had none", () => {
    expect(merge3("a\nb", "a\nb", "a\nB")).toEqual({ ok: true, merged: "a\nB" });
    expect(merge3("a\nb", "a\nb\n", "A\nb")).toEqual({ ok: true, merged: "A\nb\n" });
  });

  it("(e) an empty base with different content on both sides conflicts", () => {
    expect(merge3("", "x\n", "y\n")).toEqual({ ok: false, conflicts: 1 });
    expect(merge3("", "x\n", "x\n")).toEqual({ ok: true, merged: "x\n" });
  });
});
