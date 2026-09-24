/**
 * finish-setup helpers: the "test copy" branch flow.
 *
 * After Claude Code has pushed armature/setup to the site's repo, Armature
 * offers Preview (Netlify's branch preview URL) and Go live. Go live merges
 * armature/setup into the connected branch through the GitHub API as ONE
 * merge (POST /repos/:owner/:repo/merges). Never a force-push; on conflict
 * the API returns 409 and we surface a plain-English message.
 *
 * Preview uses Netlify's deterministic branch-preview URL scheme:
 * https://<branch-slug>--<site-slug>.netlify.app. The site-slug is derived
 * from the site's live_url when it is a *.netlify.app host; when the site
 * runs on a custom domain, the caller passes it separately (Site settings
 * has an optional "Netlify site name" field for that case).
 */

const NETLIFY_APP_HOST = /^([a-z0-9-]+)\.netlify\.app$/i;

export type NetlifySite = { host?: string; explicitSlug?: string | null };

/**
 * Turn a git branch name into Netlify's branch preview slug. Netlify replaces
 * every non-alphanumeric character with a hyphen and lowercases the result.
 */
export function netlifyBranchSlug(branch: string): string {
  return branch.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Derive the Netlify site slug from a live URL or an explicit override. */
export function netlifySiteSlug({ host, explicitSlug }: NetlifySite): string | null {
  if (explicitSlug && explicitSlug.trim()) return explicitSlug.trim();
  if (!host) return null;
  const match = NETLIFY_APP_HOST.exec(host);
  return match ? match[1]!.toLowerCase() : null;
}

/** The full branch-preview URL, or null when we cannot derive the site slug. */
export function branchPreviewUrl(input: { liveUrl: string | null; explicitSlug?: string | null; branch: string }): string | null {
  const branchSlug = netlifyBranchSlug(input.branch);
  if (!branchSlug) return null;
  let host: string | undefined;
  if (input.liveUrl) {
    try {
      host = new URL(input.liveUrl).host;
    } catch {
      /* ignore */
    }
  }
  const siteSlug = netlifySiteSlug({ host, explicitSlug: input.explicitSlug ?? null });
  if (!siteSlug) return null;
  return `https://${branchSlug}--${siteSlug}.netlify.app`;
}

export type MergeOutcome =
  | { kind: "merged"; sha: string; url: string }
  | { kind: "already_merged"; head: string }
  | { kind: "conflict"; message: string }
  | { kind: "missing_head_branch" }
  | { kind: "missing_base_branch"; branch: string };

export type MergeInput = {
  repo: string; // owner/name
  base: string; // e.g. "main"
  head: string; // e.g. "armature/setup"
  commitMessage: string;
  token: string;
  fetchImpl?: typeof fetch;
};

/**
 * Call GitHub's Merges endpoint. On 201 the merge landed; on 204 the head was
 * already merged (nothing to do); on 404 the head or base branch is missing;
 * on 409 the merge would conflict. Never force-pushes.
 */
export async function mergeBranchViaApi(input: MergeInput): Promise<MergeOutcome> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${input.repo}/merges`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ base: input.base, head: input.head, commit_message: input.commitMessage }),
    });
  } catch (cause) {
    throw new Error(`Could not reach GitHub: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  if (response.status === 201) {
    const body = (await response.json().catch(() => ({}))) as { sha?: string; html_url?: string };
    return { kind: "merged", sha: body.sha ?? "", url: body.html_url ?? `https://github.com/${input.repo}` };
  }
  if (response.status === 204) {
    return { kind: "already_merged", head: input.head };
  }
  if (response.status === 409) {
    const body = await response.text().catch(() => "");
    return { kind: "conflict", message: body || "Merge conflict" };
  }
  if (response.status === 404) {
    const body = await response.text().catch(() => "");
    if (body.toLowerCase().includes("base does not exist")) return { kind: "missing_base_branch", branch: input.base };
    return { kind: "missing_head_branch" };
  }
  const body = await response.text().catch(() => "");
  throw new Error(`GitHub returned ${response.status}: ${body || "no body"}`);
}
