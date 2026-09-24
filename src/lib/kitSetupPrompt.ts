/**
 * Builds the Claude Code prompt an agency pastes into their site's repository
 * to add or update the Armature kit.
 *
 * The prompt works DIRECTLY on the site's connected branch (usually main). No
 * test-copy branch, no branch-preview step. Because a mistake would land on
 * the live branch, Claude Code is instructed to:
 *   1. Build the production version of the site as it is TODAY, walk every
 *      page and take BEFORE screenshots + record the DOM's text nodes, links,
 *      image alt attributes and every <head> tag.
 *   2. Do the setup (copy the kit folder, wire up Armature, run the pending
 *      setup steps for the current kit version).
 *   3. Rebuild the production version and take AFTER screenshots the same way.
 *   4. Compare page-by-page. Every AFTER page must be pixel-identical to its
 *      BEFORE (≤ 0.5% pixel difference under the same resolution), with the
 *      same set of visible text, the same href/target on every link, the same
 *      alt on every image and the same title / meta / canonical / og:* tags.
 *   5. Push ONLY when every check passes. Normal commits, never force-push.
 *      If anything doesn't match, Claude fixes it (adjusting the still-coded
 *      section wrappers, restoring alt or head tags the kit dropped, etc.) or
 *      stops WITHOUT pushing and tells Troy what the mismatch was.
 *
 * The variables at the top come from Armature so the pasted text is complete;
 * the agency does not need to edit it.
 */
import type { KitReleaseNote, KitSetupStep } from "@kit/index.ts";

export type SiteSetupContext = {
  repo: string;
  /** The site's connected branch. The setup lands here directly. */
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

/** The maximum allowed pixel difference per page: 0.5%. Exposed for the tests. */
export const MAX_PIXEL_DIFF = 0.005;

export function buildSetupPrompt(ctx: SiteSetupContext): string {
  const lines: string[] = [];
  lines.push(`Please set up the Armature kit on this repository (${ctx.repo}).`);
  lines.push("");
  lines.push(H);
  lines.push("WHICH BRANCH TO WORK ON");
  lines.push(H);
  lines.push(`- Do the work directly on ${ctx.branch}, the site's connected branch. There is no test branch: Armature verifies the site matches before you push, and Undo setup restores the pre-setup state as one revert commit if anything goes wrong.`);
  lines.push(`- Every commit is a normal commit. Never force-push. Never rewrite history.`);
  lines.push(`- The kit folder is at ${ctx.kitPath}. Copy the whole folder from Armature verbatim; do not edit files inside it.`);
  lines.push("");
  lines.push(H);
  lines.push("BEFORE / AFTER VERIFICATION (do every step, in order)");
  lines.push(H);
  lines.push(`1. Check out ${ctx.branch} clean (git fetch origin && git checkout ${ctx.branch} && git pull --ff-only).`);
  lines.push(`2. Build the production version of the site as it is TODAY (npm run build && npm run preview, or the equivalent for the site's framework). Serve it locally.`);
  lines.push(`3. Walk every page (start from the home page, follow every internal link once). For each page save a BEFORE record:`);
  lines.push(`   - a full-page PNG at 1440×900 (the desktop viewport) and one at 390×844 (a phone viewport);`);
  lines.push(`   - a JSON listing every visible text node (trim whitespace; keep order);`);
  lines.push(`   - a JSON listing every link ({href, target, download, aria-label}) and every image alt attribute;`);
  lines.push(`   - a JSON listing every head tag (title, description, canonical, robots, og:*, twitter:*, hreflang, JSON-LD blocks).`);
  lines.push(`   Save all of it under .armature-verify/before/<page>/.`);
  lines.push(`4. Do the setup:`);
  if (ctx.pendingSteps.length === 0) {
    lines.push(`   - Copy the kit folder from Armature into ${ctx.kitPath} (or replace it verbatim if a version already exists).`);
    lines.push(`   - Wire up the site to render the kit's <ArmatureChrome/> and its widgets in the still-coded sections; the wrapper must render the site's own components byte-identical to today.`);
  } else {
    lines.push("   Do the pending setup steps in order:");
    let n = 1;
    for (const step of ctx.pendingSteps) {
      lines.push(`   ${n}. ${step.label} (added in ${step.version}) — ${step.detail}`);
      n += 1;
    }
  }
  lines.push(`5. Rebuild the production version and walk every page again the same way; save under .armature-verify/after/<page>/.`);
  lines.push(`6. Compare page-by-page. Every check must pass:`);
  lines.push(`   - Pixel difference between before and after screenshots: <= ${(MAX_PIXEL_DIFF * 100).toFixed(1)}% (use pixelmatch with threshold 0.1, or an equivalent). Both viewports.`);
  lines.push(`   - The visible-text list matches exactly (same strings, same order).`);
  lines.push(`   - The link list matches exactly (same href, target, download and aria-label per link, in the same order).`);
  lines.push(`   - Every image alt attribute is identical.`);
  lines.push(`   - Every head tag matches exactly (title, meta, canonical, og:*, twitter:*, hreflang, JSON-LD).`);
  lines.push(`7. If every page passes, commit and push to ${ctx.branch}. Split the setup into normal commits ("Add Armature kit ${ctx.currentVersion}", "Wire header/footer to ArmatureChrome", one per pending step). Never force-push.`);
  lines.push(`8. If anything does not match, DO NOT PUSH. Either fix the mismatch (usually a still-coded section wrapper that changed a class, or a head tag the kit hasn't been asked to render yet) and re-run the check, or stop and tell Troy exactly which page failed and how (the pixel diff percentage, or the first line of the text/link/alt/head diff). Never push a partial or "close enough" setup.`);
  lines.push(`9. Delete the .armature-verify/ folder before your final push (it does not belong on the connected branch).`);
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
  lines.push("SITE VALUES TO USE");
  lines.push(H);
  lines.push(`- Site id (for createArmatureKit's forms config):    ${ctx.siteId}`);
  lines.push(`- form-submit endpoint:  ${ctx.supabaseUrl.replace(/\/+$/, "")}/functions/v1/form-submit`);
  if (ctx.liveUrl) lines.push(`- Live URL (only used to compare against your BEFORE/AFTER screenshots if the site is already on Netlify): ${ctx.liveUrl}`);
  lines.push("");
  lines.push(H);
  lines.push("WHEN YOU ARE DONE");
  lines.push(H);
  lines.push(`Push to ${ctx.branch} once every page check has passed. Do NOT open a pull request. Once Netlify rebuilds the branch, Armature reads data-armature-kit on <html> and the site flips from Needs setup to Connected automatically. Tell Troy: "Setup pushed to ${ctx.branch} on ${ctx.repo}. If anything looks wrong on the live site, use Undo setup under Site settings — Armature will restore the pre-setup state as one revert commit."`);
  return lines.join("\n");
}
