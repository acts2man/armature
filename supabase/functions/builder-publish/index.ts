/**
 * builder-publish — the page builder's publish: content fields, pictures, layouts, the
 * site kit and media metadata in ONE commit, merged per element when someone else
 * published in between (see _shared/builderPublish.ts).
 *
 * Authorisation: RLS on the site row (agency staff or site member). What a client may
 * change follows the site's editing level and the agency's locks, checked here against
 * what is committed. Service role: used ONLY to insert the `publishes` history row.
 */
import type { BuilderPublishResponse } from "../../../shared/publishTypes.ts";
import { adminClient, loadAccessibleSite, requireConnectedSite, resolveCaller } from "../_shared/auth.ts";
import { parseBuilderPublishRequest, permissionsFor, runBuilderPublish } from "../_shared/builderPublish.ts";
import { denoEnv, type Env } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { loadAppConfig, mintInstallationToken } from "../_shared/githubApp.ts";
import { createGithubContentRepo } from "../_shared/githubRepo.ts";
import { readJsonBody, serveJson } from "../_shared/http.ts";

type HistoryRow = { site_id: string; user_id: string; page_slug: string; fields_changed: string[]; commit_sha: string | null; commit_url: string | null; status: "committed" | "conflict" | "failed"; error: string | null };

async function recordAttempt(env: Env, row: HistoryRow): Promise<void> {
  try {
    const { error } = await adminClient(env).from("publishes").insert(row);
    if (error) console.error("[builder-publish] could not record history:", error.message);
  } catch (error) {
    console.error("[builder-publish] could not record history:", error instanceof Error ? error.message : error);
  }
}

Deno.serve(
  serveJson(async (req): Promise<BuilderPublishResponse> => {
    const env = denoEnv();
    const input = parseBuilderPublishRequest(await readJsonBody(req));
    if (!input.site_id) throw new ArmatureError("invalid", 'Missing "site_id" in the request.');

    const caller = await resolveCaller(req, env);
    const site = requireConnectedSite(await loadAccessibleSite(caller.supabase, input.site_id));
    const { data: membership } = await caller.supabase.from("agency_members").select("role").eq("agency_id", site.agency_id).eq("user_id", caller.userId).maybeSingle();
    const permissions = permissionsFor(!!membership, site.editing_level);

    const requested = [
      ...input.pages.flatMap((page) => [...page.fields.map((field) => `${page.slug}.${field.section}.${field.field}`), ...page.images.map((image) => `${page.slug}.${image.section}.${image.field}`)]),
      ...Object.keys(input.layouts).map((slug) => `layout:${slug}`),
      ...(input.kit ? ["kit"] : []),
    ];

    try {
      const token = await mintInstallationToken(loadAppConfig(env), site.github_installation_id, site.repo_name);
      const repo = createGithubContentRepo({ token: token.token, repo: `${site.repo_owner}/${site.repo_name}`, branch: site.branch });
      const outcome = await runBuilderPublish({ repo, input, userEmail: caller.email || "an editor", permissions });
      await recordAttempt(env, {
        site_id: site.id,
        user_id: caller.userId,
        page_slug: outcome.slugs.join(", ") || (outcome.kit ? "site settings" : ""),
        fields_changed: [...outcome.fields, ...outcome.layouts.map((slug) => `layout:${slug}`), ...(outcome.kit ? ["kit"] : []), ...(outcome.media ? ["media"] : [])],
        commit_sha: outcome.commitSha,
        commit_url: outcome.commitUrl,
        status: "committed",
        error: null,
      });
      return { ok: true, ...outcome };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordAttempt(env, {
        site_id: site.id,
        user_id: caller.userId,
        page_slug: [...new Set([...input.pages.map((page) => page.slug), ...Object.keys(input.layouts)])].join(", "),
        fields_changed: requested,
        commit_sha: null,
        commit_url: null,
        status: error instanceof ArmatureError && error.code === "conflict" ? "conflict" : "failed",
        error: message.slice(0, 4000),
      });
      throw error;
    }
  }),
);
