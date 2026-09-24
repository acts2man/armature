/**
 * Builds the Claude Code prompt an agency pastes into their site's repository
 * to add or update the Armature kit. Everything specific to a site — its repo,
 * connected branch, kit path, id and stats endpoint — is filled in here so the
 * agency does not have to touch the text.
 *
 * The rule of the prompt is stated up front: the site's visual tests must stay
 * pixel-identical (production build only), never touch main unless it is the
 * connected branch, never force-push.
 */
import type { KitReleaseNote, KitSetupStep } from "@kit/index.ts";

export type SiteSetupContext = {
  repo: string;
  branch: string;
  kitPath: string;
  siteId: string;
  liveUrl: string | null;
  supabaseUrl: string;
  currentVersion: string;
  fromVersion: string | null;
  releases: KitReleaseNote[];
  pendingSteps: (KitSetupStep & { version: string })[];
};

const H = "----------------------------------------------------------------";

export function buildSetupPrompt(ctx: SiteSetupContext): string {
  const lines: string[] = [];
  lines.push(`Please set up the Armature kit on this repository (${ctx.repo}, branch ${ctx.branch}).`);
  lines.push("");
  lines.push(H);
  lines.push("RULES (do not break any of these)");
  lines.push(H);
  lines.push(`- Every visual check runs against the site's production build (npm run build && npm run preview, or the framework's equivalent). It must look pixel-identical to before you started.`);
  lines.push(`- Only push to the connected branch: ${ctx.branch}. Never force-push, never rewrite history on any other branch.`);
  lines.push(`- Do not touch main unless main is the connected branch (${ctx.branch === "main" ? "it is" : "it is not — leave main alone"}).`);
  lines.push(`- The kit folder is at ${ctx.kitPath}. Copy the whole folder from Armature verbatim; do not edit files inside it.`);
  lines.push("");
  lines.push(H);
  lines.push("KIT VERSION");
  lines.push(H);
  lines.push(`- Target version: ${ctx.currentVersion}${ctx.fromVersion ? ` (site is currently on ${ctx.fromVersion})` : " (fresh install)"}`);
  if (ctx.releases.length > 0) {
    lines.push("- What changed since the site's version:");
    for (const release of ctx.releases) {
      lines.push(`  - ${release.version} (${release.date}):`);
      for (const note of release.notes) lines.push(`      - ${note}`);
    }
  }
  lines.push("");
  lines.push(H);
  lines.push("STEPS FOR THIS SITE");
  lines.push(H);
  if (ctx.pendingSteps.length === 0) {
    lines.push("- Copy the entire kit folder from Armature into ${ctx.kitPath} (or, if updating, replace the folder verbatim).");
    lines.push("- Run the production build and confirm nothing visual changed.");
  } else {
    lines.push("Do these in order:");
    let n = 1;
    for (const step of ctx.pendingSteps) {
      lines.push(`${n}. ${step.label} (added in ${step.version}) — ${step.detail}`);
      n += 1;
    }
    lines.push(`${n}. Run the production build and confirm nothing visual changed.`);
  }
  lines.push("");
  lines.push(H);
  lines.push("SITE VALUES TO USE");
  lines.push(H);
  lines.push(`- Site id (for createArmatureKit's forms/stats config):    ${ctx.siteId}`);
  lines.push(`- form-submit endpoint:  ${ctx.supabaseUrl.replace(/\/+$/, "")}/functions/v1/form-submit`);
  lines.push(`- stats-ingest endpoint: ${ctx.supabaseUrl.replace(/\/+$/, "")}/functions/v1/stats-ingest`);
  if (ctx.liveUrl) lines.push(`- Live URL (for QA): ${ctx.liveUrl}`);
  lines.push("");
  lines.push(H);
  lines.push("NETLIFY ENVIRONMENT VARIABLES");
  lines.push(H);
  lines.push("Add these to Netlify → Project configuration → Environment variables (Same value for all deploy contexts):");
  lines.push(`  VITE_ARMATURE_STATS_ENDPOINT = ${ctx.supabaseUrl.replace(/\/+$/, "")}/functions/v1/stats-ingest`);
  lines.push(`  VITE_ARMATURE_STATS_SITE_ID  = ${ctx.siteId}`);
  lines.push("Then trigger a fresh deploy so the build picks them up.");
  lines.push("");
  lines.push(H);
  lines.push("WHEN YOU ARE DONE");
  lines.push(H);
  lines.push("Commit and push to the connected branch. Armature notices the new version automatically the next time the site rebuilds (data-armature-kit on <html> is the signal); the site's Kit status card in Site settings will flip to Up to date once the deploy is live.");
  return lines.join("\n");
}
