/**
 * GitHub Contents/Git Data API helper for the git-first publish path. Ported from
 * the pilot's github.server.ts; the only change is that it is handed an
 * installation token instead of reading a personal token from the environment.
 *
 * SERVER ONLY.
 *
 * A publish is ONE commit: blobs for every changed file, a tree layered over the
 * branch's current tree, a commit, then a non-forced update of the branch ref. The
 * ref update is deliberately not forced, so GitHub itself refuses anything that is
 * not a fast-forward even if our own conflict check somehow missed a race.
 */
import { base64ToUtf8 } from "../../../shared/base64.ts";
import { ArmatureError } from "./errors.ts";
import { GITHUB_API, GITHUB_API_VERSION, USER_AGENT, redact } from "./githubApp.ts";

export type RepoConfig = {
  /** Installation access token. */
  token: string;
  /** "owner/repo" */
  repo: string;
  /** Branch that publishes commit to. */
  branch: string;
};

export type CommitFile = {
  /** Repo-relative path, e.g. "content/pages.json". */
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
};

export type CommitResult = { commitSha: string; commitUrl: string };

/**
 * The narrow slice of GitHub the publish logic needs. Implemented against the real
 * API below, and faked in tests.
 */
export interface ContentRepo {
  /** Current head commit sha of the content branch. */
  getBranchHead(): Promise<string>;
  /** UTF-8 text of a file at a given commit-ish, with its blob sha. */
  readTextFile(path: string, ref: string): Promise<{ text: string; sha: string }>;
  /** One commit updating/adding every file, then a non-forced branch ref update. */
  commit(input: {
    message: string;
    files: CommitFile[];
    parentCommitSha: string;
  }): Promise<CommitResult>;
}

export function createGithubContentRepo(
  config: RepoConfig,
  fetchImpl: typeof fetch = fetch,
): ContentRepo {
  const { token, repo, branch } = config;

  async function call<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${GITHUB_API}${path}`, {
        method: init?.method ?? "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "User-Agent": USER_AGENT,
          ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new ArmatureError("github_error", `Could not reach GitHub: ${redact(detail, token)}`);
    }

    if (!response.ok) {
      const raw = await response.text().catch(() => "");
      let detail = raw;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && "message" in parsed) {
          detail = String((parsed as { message: unknown }).message);
        }
      } catch {
        // keep the raw body
      }
      const message = redact(detail || response.statusText, token);

      if (response.status === 401 || response.status === 403) {
        throw new ArmatureError(
          "forbidden",
          `GitHub rejected the App's access to ${repo} (${response.status}). Check the App is still installed on this repository with Contents: Read and write. GitHub said: ${message}`,
        );
      }
      if (response.status === 404) {
        throw new ArmatureError(
          "github_error",
          `GitHub could not find ${repo}, the branch "${branch}", or the file asked for (404). GitHub said: ${message}`,
        );
      }
      if (response.status === 409 || response.status === 422) {
        throw new ArmatureError(
          "conflict",
          `GitHub refused the update because the branch moved while publishing. Reload and try again. GitHub said: ${message}`,
        );
      }
      throw new ArmatureError("github_error", `GitHub returned ${response.status}: ${message}`);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    async getBranchHead() {
      const ref = await call<{ object?: { sha?: string } }>(
        `/repos/${repo}/git/ref/heads/${branch}`,
      );
      const sha = ref.object?.sha;
      if (!sha) {
        throw new ArmatureError("github_error", `GitHub did not return a head commit for ${branch}`);
      }
      return sha;
    },

    async readTextFile(path, ref) {
      const file = await call<{ content?: string; encoding?: string; sha?: string }>(
        `/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
      );
      if (!file.sha) {
        throw new ArmatureError("github_error", `GitHub did not return a sha for ${path}`);
      }
      if (file.encoding !== "base64" || typeof file.content !== "string") {
        throw new ArmatureError(
          "github_error",
          `${path} is too large or not a text file, so it cannot be edited through the dashboard`,
        );
      }
      return { text: base64ToUtf8(file.content), sha: file.sha };
    },

    async commit({ message, files, parentCommitSha }) {
      if (files.length === 0) {
        throw new ArmatureError("invalid", "Nothing to commit");
      }

      const parent = await call<{ tree?: { sha?: string } }>(
        `/repos/${repo}/git/commits/${parentCommitSha}`,
      );
      const baseTree = parent.tree?.sha;
      if (!baseTree) {
        throw new ArmatureError(
          "github_error",
          `GitHub did not return a tree for commit ${parentCommitSha}`,
        );
      }

      const entries = [];
      for (const file of files) {
        const blob = await call<{ sha?: string }>(`/repos/${repo}/git/blobs`, {
          method: "POST",
          body: { content: file.content, encoding: file.encoding },
        });
        if (!blob.sha) {
          throw new ArmatureError(
            "github_error",
            `GitHub did not return a blob sha for ${file.path}`,
          );
        }
        entries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
      }

      const tree = await call<{ sha?: string }>(`/repos/${repo}/git/trees`, {
        method: "POST",
        body: { base_tree: baseTree, tree: entries },
      });
      if (!tree.sha) throw new ArmatureError("github_error", "GitHub did not return a tree sha");

      const commit = await call<{ sha?: string; html_url?: string }>(`/repos/${repo}/git/commits`, {
        method: "POST",
        body: { message, tree: tree.sha, parents: [parentCommitSha] },
      });
      if (!commit.sha) throw new ArmatureError("github_error", "GitHub did not return a commit sha");

      // force: false — GitHub rejects a non-fast-forward, which is the last line of
      // defence against a concurrent publish we did not detect.
      await call(`/repos/${repo}/git/refs/heads/${branch}`, {
        method: "PATCH",
        body: { sha: commit.sha, force: false },
      });

      return {
        commitSha: commit.sha,
        commitUrl: commit.html_url ?? `https://github.com/${repo}/commit/${commit.sha}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Diagnostics: probes that report instead of throwing
// ---------------------------------------------------------------------------

/** One GitHub probe result. Never contains the token. */
export type ProbeResult = {
  /** HTTP status, or 0 if the request never completed. */
  status: number;
  ok: boolean;
  /** GitHub's own message, or the transport error, with the token redacted. */
  message: string;
  /** Short commit sha, for the branch probe. */
  sha?: string;
  /** Decoded file text, for the file probes. */
  text?: string;
};

/**
 * Read-only checks used by "Check connection" and by site-connect. Unlike
 * `ContentRepo`, these report a status instead of throwing, so one failure does
 * not hide the others and the dashboard can show a full checklist.
 */
export interface GithubProbe {
  repository(): Promise<ProbeResult>;
  branch(): Promise<ProbeResult>;
  file(path: string, ref: string): Promise<ProbeResult>;
}

export function createGithubProbe(
  config: RepoConfig,
  fetchImpl: typeof fetch = fetch,
): GithubProbe {
  const { token, repo, branch } = config;

  async function probe(
    path: string,
    read?: (body: unknown) => Partial<ProbeResult>,
  ): Promise<ProbeResult> {
    let response: Response;
    try {
      response = await fetchImpl(`${GITHUB_API}${path}`, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "User-Agent": USER_AGENT,
        },
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { status: 0, ok: false, message: redact(detail, token) };
    }

    const raw = await response.text().catch(() => "");
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined;
    }

    let message = response.statusText;
    if (body && typeof body === "object" && "message" in body) {
      message = String((body as { message: unknown }).message);
    }

    const base: ProbeResult = {
      status: response.status,
      ok: response.ok,
      message: redact(message || `HTTP ${response.status}`, token),
    };
    return response.ok && read ? { ...base, ...read(body) } : base;
  }

  return {
    // A reachability check only. Whether the token can write is decided from the
    // permissions GitHub granted the token (see requestInstallationToken), never
    // from `permissions.push` here: that flag is unreliable for App tokens.
    repository: () => probe(`/repos/${repo}`),

    branch: () =>
      probe(`/repos/${repo}/git/ref/heads/${branch}`, (body) => {
        const sha =
          body && typeof body === "object" && "object" in body
            ? (body as { object?: { sha?: unknown } }).object?.sha
            : undefined;
        return typeof sha === "string" ? { sha } : {};
      }),

    file: (path: string, ref: string) =>
      probe(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`, (body) => {
        const raw = body as { content?: unknown; encoding?: unknown } | undefined;
        if (raw?.encoding === "base64" && typeof raw.content === "string") {
          try {
            return { text: base64ToUtf8(raw.content) };
          } catch {
            return {};
          }
        }
        return {};
      }),
  };
}
