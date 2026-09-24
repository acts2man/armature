import type { GithubRepositorySummary } from "@shared/publishTypes.ts";

/**
 * Case-insensitive substring match, anywhere in the repository's owner or name.
 * A datalist-based dropdown matches only the beginning of one field on some
 * browsers, so the AddSite repository picker filters through this helper.
 */
export function filterRepositories(repositories: GithubRepositorySummary[], needle: string): GithubRepositorySummary[] {
  const trimmed = needle.trim().toLowerCase();
  if (!trimmed) return repositories;
  return repositories.filter((repo) => repo.full_name.toLowerCase().includes(trimmed) || repo.name.toLowerCase().includes(trimmed));
}
