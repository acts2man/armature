/**
 * Fetch every repository visible to a GitHub App installation, paginating past
 * the 100-per-page limit until GitHub reports no more pages. The functions
 * here are pure over an injected `fetch`, so unit tests can drive a multi-page
 * response deterministically.
 *
 * The safety cap (default 50 pages = 5,000 repositories) keeps a runaway
 * installation from making the edge function loop forever. When the cap is
 * hit, the caller gets back `page_cap_hit = true` so the UI can say so.
 *
 * We prefer GitHub's `Link` response header because it is the canonical
 * paginator; but as a belt-and-braces we also honour `total_count` inside the
 * body — if the running total already matches or exceeds `total_count`, we
 * stop early.
 */
import type { GithubRepositorySummary } from "../../../shared/publishTypes.ts";
import { GITHUB_API, GITHUB_API_VERSION, USER_AGENT } from "./githubApp.ts";

export const DEFAULT_PAGE_CAP = 50;
export const PER_PAGE = 100;

export type GithubRepositoriesRaw = {
  total_count?: number;
  repositories?: Array<{
    owner?: { login?: string };
    name: string;
    full_name: string;
    private: boolean;
    default_branch: string;
  }>;
};

export type ListRepositoriesForInstallationOptions = {
  token: string;
  accountLogin: string;
  accountType: string;
  installationId: number;
  /** Default 50. */
  pageCap?: number;
  /** Test seam. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

export type ListRepositoriesForInstallationResult = {
  repositories: GithubRepositorySummary[];
  page_cap_hit: boolean;
  /** How many pages were actually fetched (1..pageCap). */
  pages_fetched: number;
  /** GitHub's total_count for the installation, when returned. */
  total_count?: number;
};

/** Very small `Link` header parser: returns true when a rel="next" URL is present. */
export function hasNextLink(header: string | null): boolean {
  if (!header) return false;
  // GitHub's format: <url1>; rel="next", <url2>; rel="last"
  return /rel\s*=\s*"?next"?/i.test(header);
}

export async function listRepositoriesForInstallation(options: ListRepositoriesForInstallationOptions): Promise<ListRepositoriesForInstallationResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pageCap = Math.max(1, options.pageCap ?? DEFAULT_PAGE_CAP);
  const repositories: GithubRepositorySummary[] = [];
  const configureUrl =
    `https://github.com/${options.accountType === "Organization" ? "organizations/" + options.accountLogin + "/" : ""}settings/installations/${options.installationId}`;

  let page = 1;
  let pageCapHit = false;
  let lastTotalCount: number | undefined;
  while (page <= pageCap) {
    const response = await fetchImpl(`${GITHUB_API}/installation/repositories?per_page=${PER_PAGE}&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${options.token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": USER_AGENT,
      },
    });
    if (!response.ok) break;
    const body = (await response.json()) as GithubRepositoriesRaw;
    lastTotalCount = body.total_count;
    for (const repo of body.repositories ?? []) {
      const owner = repo.owner?.login ?? options.accountLogin;
      repositories.push({
        installation_id: options.installationId,
        account_login: options.accountLogin,
        owner,
        name: repo.name,
        full_name: repo.full_name,
        private: repo.private,
        default_branch: repo.default_branch,
        configure_url: configureUrl,
      });
    }
    if (typeof body.total_count === "number" && repositories.filter((row) => row.installation_id === options.installationId).length >= body.total_count) {
      // We fetched every repository the installation reports.
      return { repositories, page_cap_hit: false, pages_fetched: page, total_count: body.total_count };
    }
    if (!hasNextLink(response.headers.get("link"))) {
      return { repositories, page_cap_hit: false, pages_fetched: page, total_count: lastTotalCount };
    }
    if (page === pageCap) {
      pageCapHit = true;
      break;
    }
    page += 1;
  }
  return { repositories, page_cap_hit: pageCapHit, pages_fetched: page, total_count: lastTotalCount };
}
