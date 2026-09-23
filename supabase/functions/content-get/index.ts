/**
 * content-get — the site's content/schema.json and content/pages.json as actually
 * committed on its branch, plus the head commit sha the editor must publish against.
 * Site contract v2 adds the layouts, the site kit and the media list. An optional
 * `ref` (a commit sha) reads everything at that commit instead, for revision previews.
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
import { loadBuilderFiles } from "../_shared/builderFiles.ts";
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

    const ref = typeof body["ref"] === "string" && /^[0-9a-f]{7,40}$/i.test(body["ref"]) ? body["ref"] : null;
    const head = await repo.getBranchHead();
    const files = await loadSiteFiles(repo, ref ?? head);
    const builder = await loadBuilderFiles(repo, ref ?? head);

    return {
      ok: true,
      schema: files.schema,
      content: files.content,
      commitSha: ref ?? head,
      branch: site.branch,
      repo: `${site.repo_owner}/${site.repo_name}`,
      warnings: [
        ...files.contentErrors.map((error) => `Content problem (publishing is blocked until fixed in the repository): ${error}`),
        ...files.warnings,
        ...builder.warnings,
      ],
      layouts: builder.layouts,
      siteKit: builder.siteKit,
      problems: builder.problems,
      media: builder.media,
      trash: builder.trash,
      editingLevel: site.editing_level === "style" || site.editing_level === "builder" ? site.editing_level : "content",
    };
  }),
);
