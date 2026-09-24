/**
 * Builds the Claude Code prompt an agency pastes into their site's repository
 * to add or update the Armature kit. Everything specific to a site — its repo,
 * connected branch, kit path, id and stats endpoint — is filled in here so the
 * agency does not have to touch the text.
 *
 * The setup runs on a TEST-COPY branch (armature/setup) branched from the
 * connected branch, so the live branch keeps rendering the site as it is
 * today. Preview and Go live in Armature take the test copy the rest of the
 * way — Preview shows Netlify's branch preview, Go live merges armature/setup
 * into the connected branch through the GitHub API as one merge (never a
 * force-push; on conflict Armature stops and explains).
 */
import type { KitReleaseNote, KitSetupStep } from "@kit/index.ts";

/** The branch the setup prompt uses for the test-copy work. */
export const SETUP_BRANCH = "armature/setup";

export type SiteSetupContext = {
  repo: string;
  /** The connected branch — the setup prompt branches OFF this into SETUP_BRANCH. */
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
  lines.push(`Please set up the Armature kit on this repository (${ctx.repo}).`);
  lines.push("");
  lines.push(H);
  lines.push("WHICH BRANCH TO WORK ON");
  lines.push(H);
  lines.push(`- Do ALL the work on a NEW branch called ${SETUP_BRANCH}, branched from ${ctx.branch}.`);
  lines.push(`  Start with: git fetch origin && git switch -c ${SETUP_BRANCH} origin/${ctx.branch} (create it if it does not exist yet; if it does, use it).`);
  lines.push(`- Do NOT touch ${ctx.branch} directly. The live site stays exactly as it is on ${ctx.branch} today until Armature merges the setup for you.`);
  lines.push(`- When you finish, push ${SETUP_BRANCH} to origin and tell Troy to come back to Armature. Armature will then show him Preview (Netlify's branch preview of ${SETUP_BRANCH}) and Go live (merges ${SETUP_BRANCH} into ${ctx.branch} through the GitHub API as one merge — never a force-push).`);
  lines.push("");
  lines.push(H);
  lines.push("RULES (do not break any of these)");
  lines.push(H);
  lines.push(`- Every visual check runs against the site's production build (npm run build && npm run preview, or the framework's equivalent). It must look pixel-identical to the site running on ${ctx.branch} today.`);
  lines.push(`- Only push to ${SETUP_BRANCH}. Never force-push. Never rewrite history on any branch.`);
  lines.push(`- Do NOT touch main unless main IS the connected branch (${ctx.branch === "main" ? "it is — but still only via " + SETUP_BRANCH : "it is not — leave main alone entirely"}).`);
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
  lines.push(`- Site id (for createArmatureKit's forms config):    ${ctx.siteId}`);
  lines.push(`- form-submit endpoint:  ${ctx.supabaseUrl.replace(/\/+$/, "")}/functions/v1/form-submit`);
  if (ctx.liveUrl) lines.push(`- Live URL (for QA): ${ctx.liveUrl}`);
  lines.push("");
  lines.push(H);
  lines.push("WHEN YOU ARE DONE");
  lines.push(H);
  lines.push(`Commit and push to ${SETUP_BRANCH}. Do NOT open a pull request; Armature merges the branch for Troy when he presses Go live. Then tell Troy: "The test copy is on ${SETUP_BRANCH}. Open the site in Armature and press Preview to check it, then Go live when you are happy." Armature notices the version automatically once the merge lands (data-armature-kit on <html> is the signal).`);
  return lines.join("\n");
}
