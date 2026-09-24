/**
 * github-setup — links GitHub App installations to an agency.
 *
 * Actions:
 *   install_url          → where to send the agency to install the App. `state`
 *                          carries the agency id back to the dashboard's setup page.
 *   record_installation  → the dashboard's setup page calls this with the
 *                          installation_id GitHub appended to the redirect. The
 *                          installation is verified with GitHub (using the App JWT)
 *                          before it is stored.
 *   list_installations   → installations linked to the agency.
 *
 * Authorisation: agency membership under RLS. Rows are inserted with the caller's
 * own client. No service role.
 */
import type { GithubInstallationSummary, GithubRepositorySummary, GithubSetupResponse } from "../../../shared/publishTypes.ts";
import { linkedInstallationIds, requireAgencyMember, resolveCaller } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { getInstallation, GITHUB_API, GITHUB_API_VERSION, installUrl, loadAppConfig, requestUnscopedInstallationToken, USER_AGENT } from "../_shared/githubApp.ts";
import { readJsonBody, requireString, requireUuid, serveJson } from "../_shared/http.ts";

Deno.serve(
  serveJson(async (req): Promise<GithubSetupResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const action = requireString(body, "action");
    const agencyId = requireUuid(body, "agency_id");

    const caller = await resolveCaller(req, env);
    await requireAgencyMember(caller.supabase, agencyId, caller.userId);

    if (action === "install_url") {
      const app = loadAppConfig(env);
      return { ok: true, action, url: installUrl(app, agencyId) };
    }

    if (action === "list_installations") {
      const { data, error } = await caller.supabase
        .from("github_installations")
        .select("installation_id, account_login, account_type")
        .eq("agency_id", agencyId)
        .order("created_at", { ascending: true });
      if (error) throw new ArmatureError("github_error", `Could not read installations: ${error.message}`);
      const installations = ((data ?? []) as GithubInstallationSummary[]).map((row) => ({
        installation_id: Number(row.installation_id),
        account_login: row.account_login,
        account_type: row.account_type,
      }));
      return { ok: true, action, installations };
    }

    if (action === "record_installation") {
      const rawId = body["installation_id"];
      const installationId = typeof rawId === "number" ? rawId : Number.parseInt(String(rawId ?? ""), 10);
      if (!Number.isInteger(installationId) || installationId <= 0) {
        throw new ArmatureError(
          "invalid",
          "GitHub did not send an installation id back. Start again from Projects → Add a site → Install the GitHub App.",
        );
      }

      const app = loadAppConfig(env);
      const found = await getInstallation(app, installationId);
      if (!found.installation) {
        throw new ArmatureError(
          found.status === 404 ? "not_found" : "github_error",
          found.status === 404
            ? `GitHub has no installation #${installationId} for this App. It may have been uninstalled, or GITHUB_APP_ID belongs to a different App.`
            : `GitHub could not confirm installation #${installationId}: ${found.message}`,
        );
      }
      const summary: GithubInstallationSummary = {
        installation_id: found.installation.id,
        account_login: found.installation.account.login,
        account_type: found.installation.account.type,
      };

      // Already linked to this agency? Then this is a repeat visit; nothing to do.
      const existing = await caller.supabase
        .from("github_installations")
        .select("agency_id")
        .eq("installation_id", installationId)
        .maybeSingle();
      if (existing.data) return { ok: true, action, installation: summary };

      const { error } = await caller.supabase.from("github_installations").insert({
        agency_id: agencyId,
        installation_id: installationId,
        account_login: summary.account_login,
        account_type: summary.account_type,
        created_by: caller.userId,
      });
      if (error) {
        if (error.code === "23505") {
          throw new ArmatureError(
            "conflict",
            `This GitHub installation (#${installationId} on ${summary.account_login}) is already linked to a different agency.`,
          );
        }
        throw new ArmatureError("github_error", `Could not save the installation: ${error.message}`);
      }
      return { ok: true, action, installation: summary };
    }

    if (action === "list_repositories") {
      const app = loadAppConfig(env);
      const installationIds = await linkedInstallationIds(caller.supabase, agencyId);
      const repositories: GithubRepositorySummary[] = [];
      for (const installationId of installationIds) {
        let account: { login: string; type: string } | null = null;
        try {
          const info = await getInstallation(app, installationId);
          account = info.installation ? info.installation.account : null;
        } catch {
          /* keep going with the other installations */
        }
        if (!account) continue;
        let token: string | null = null;
        try {
          const tokenResult = await requestUnscopedInstallationToken(app, installationId);
          if (tokenResult.token) token = tokenResult.token.token;
        } catch {
          continue;
        }
        if (!token) continue;
        // GitHub returns at most 100 repositories per page; agencies with more than
        // that get the first page (agencies of that size are rare, and the manual
        // owner/name fallback still works). We do NOT try to paginate 10+ pages.
        try {
          const response = await fetch(`${GITHUB_API}/installation/repositories?per_page=100`, {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: `Bearer ${token}`,
              "X-GitHub-Api-Version": GITHUB_API_VERSION,
              "User-Agent": USER_AGENT,
            },
          });
          if (!response.ok) continue;
          const body = (await response.json()) as { repositories?: { owner: { login?: string }; name: string; full_name: string; private: boolean; default_branch: string }[] };
          for (const repo of body.repositories ?? []) {
            const owner = repo.owner?.login ?? account.login;
            repositories.push({
              installation_id: installationId,
              account_login: account.login,
              owner,
              name: repo.name,
              full_name: repo.full_name,
              private: repo.private,
              default_branch: repo.default_branch,
              configure_url: `https://github.com/${account.type === "Organization" ? "organizations/" + account.login + "/" : ""}settings/installations/${installationId}`,
            });
          }
        } catch {
          continue;
        }
      }
      // Deduplicate (an owner + name should only appear once even if two installations claim it).
      const seen = new Set<string>();
      const unique = repositories.filter((repo) => {
        const key = `${repo.owner}/${repo.name}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      unique.sort((a, b) => a.full_name.localeCompare(b.full_name));
      return { ok: true, action, repositories: unique };
    }

    throw new ArmatureError("invalid", `Unknown action "${action}".`);
  }),
);
