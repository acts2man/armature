/**
 * content-publish — validate the editor's changes, merge them into the committed
 * content, and write one commit to the site's branch (which triggers the rebuild).
 *
 * Authorisation: RLS on the site row (agency staff or site member).
 * Service role: used ONLY to insert the `publishes` history row, so the history
 * cannot be forged from a browser. Every attempt on an accessible site gets a row.
 */
import type { PublishResponse } from "../../../shared/publishTypes.ts";
import { adminClient, loadAccessibleSite, resolveCaller } from "../_shared/auth.ts";
import { denoEnv, type Env } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { loadAppConfig, mintInstallationToken } from "../_shared/githubApp.ts";
import { createGithubContentRepo } from "../_shared/githubRepo.ts";
import { readJsonBody, serveJson } from "../_shared/http.ts";
import { parsePublishRequest, runPublish } from "../_shared/publish.ts";

type HistoryRow = {
  site_id: string;
  user_id: string;
  page_slug: string;
  fields_changed: string[];
  commit_sha: string | null;
  commit_url: string | null;
  status: "committed" | "conflict" | "failed";
  error: string | null;
};

async function recordAttempt(env: Env, row: HistoryRow): Promise<void> {
  try {
    const { error } = await adminClient(env).from("publishes").insert(row);
    if (error) console.error("[content-publish] could not record history:", error.message);
  } catch (error) {
    console.error("[content-publish] could not record history:", error instanceof Error ? error.message : error);
  }
}

Deno.serve(
  serveJson(async (req): Promise<PublishResponse> => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const input = parsePublishRequest(body);
    if (!input.site_id) throw new ArmatureError("invalid", 'Missing "site_id" in the request.');
    if (!input.slug) throw new ArmatureError("invalid", 'Missing "slug" in the request.');

    const caller = await resolveCaller(req, env);
    const site = await loadAccessibleSite(caller.supabase, input.site_id);

    const requestedFields = [
      ...input.fields.map((field) => `${field.section}.${field.field}`),
      ...input.images.map((image) => `${image.section}.${image.field}`),
    ];

    try {
      const app = loadAppConfig(env);
      const token = await mintInstallationToken(app, site.github_installation_id, site.repo_name);
      const repo = createGithubContentRepo({
        token: token.token,
        repo: `${site.repo_owner}/${site.repo_name}`,
        branch: site.branch,
      });

      const outcome = await runPublish({ repo, input, userEmail: caller.email || "an editor" });

      await recordAttempt(env, {
        site_id: site.id,
        user_id: caller.userId,
        page_slug: input.slug,
        fields_changed: outcome.fields,
        commit_sha: outcome.commitSha,
        commit_url: outcome.commitUrl,
        status: "committed",
        error: null,
      });

      return {
        ok: true,
        commitSha: outcome.commitSha,
        commitUrl: outcome.commitUrl,
        fields: outcome.fields,
        images: outcome.images,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordAttempt(env, {
        site_id: site.id,
        user_id: caller.userId,
        page_slug: input.slug,
        fields_changed: requestedFields,
        commit_sha: null,
        commit_url: null,
        status: error instanceof ArmatureError && error.code === "conflict" ? "conflict" : "failed",
        error: message.slice(0, 4000),
      });
      throw error;
    }
  }),
);
