/**
 * content-get — the site's content/schema.json and content/pages.json as actually
 * committed on its branch, plus the head commit sha the editor must publish against.
 *
 * Authorisation: RLS. The site row is only visible to agency staff of the owning
 * agency and to client members of the site. No service role.
 */
import type { ContentGetResponse } from "../../../shared/publishTypes.ts";
import { loadAccessibleSite, requireConnectedSite, resolveCaller } from "../_shared/auth.ts";
import { denoEnv } from "../_shared/env.ts";
import { loadAppConfig, mintInstallationToken } from "../_shared/githubApp.ts";
import { createGithubContentRepo } from "../_shared/githubRepo.ts";
import { readJsonBody, requireUuid, serveJson } from "../_shared/http.ts";
import { loadSiteFiles } from "../_shared/publish.ts";

Deno.serve(
  serveJson(async (req): Promise<ContentGetResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const siteId = requireUuid(body, "site_id");

    const caller = await resolveCaller(req, env);
    const site = requireConnectedSite(await loadAccessibleSite(caller.supabase, siteId));

    const app = loadAppConfig(env);
    const token = await mintInstallationToken(app, site.github_installation_id, site.repo_name);
    const repo = createGithubContentRepo({
      token: token.token,
      repo: `${site.repo_owner}/${site.repo_name}`,
      branch: site.branch,
    });

    const head = await repo.getBranchHead();
    const files = await loadSiteFiles(repo, head);

    return {
      ok: true,
      schema: files.schema,
      content: files.content,
      commitSha: head,
      branch: site.branch,
      repo: `${site.repo_owner}/${site.repo_name}`,
      warnings: [
        ...files.contentErrors.map((error) => `Content problem (publishing is blocked until fixed in the repository): ${error}`),
        ...files.warnings,
      ],
    };
  }),
);
