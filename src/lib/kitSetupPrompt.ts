/**
 * Builds the Claude Code prompt an agency pastes into their site's repository
 * to add or update the Armature kit.
 *
 * The prompt works DIRECTLY on the site's connected branch (usually main). No
 * test-copy branch, no branch-preview step. Because a mistake would land on
 * the live branch, Claude Code is instructed to:
 *   1. Clone the real Armature repository into a temp folder OUTSIDE the site
 *      repo (read-only) and copy the kit/ folder from it verbatim. Never write
 *      or "recreate" kit files itself.
 *   2. Build the production version of the site as it is TODAY, walk every
 *      page and take BEFORE screenshots + record the DOM's text nodes, links,
 *      image alt attributes and every <head> tag.
 *   3. Do the setup (copy the kit folder, wire up Armature, write the content
 *      files, convert coded sections into builder elements, run the pending
 *      setup steps for the current kit version).
 *   4. Rebuild the production version and take AFTER screenshots the same way.
 *   5. Verify: pixel diff <= 0.5%, visible text / links / alt / head-tags
 *      match, and the edit-mode handshake succeeds from a temporarily
 *      allowlisted local parent.
 *   6. Push ONLY when every check passes. Normal commits, never force-push.
 *      If Claude runs out of context, it pushes work-in-progress to
 *      armature/wip-setup and stops — the connected branch never sees a
 *      partial setup.
 *
 * The variables at the top come from Armature so the pasted text is complete;
 * the agency does not need to edit it.
 */
import type { KitReleaseNote, KitSetupStep } from "@kit/index.ts";

/** Default source of the real Armature kit. Agencies can override per site. */
export const DEFAULT_ARMATURE_REPO_URL = "https://github.com/acts2man/armature.git";
/** Where Claude Code clones Armature to on the machine running the session. Outside the site repo. */
export const ARMATURE_CLONE_PATH = "/tmp/armature-source";
/** The wip-branch a stopped-early session pushes to. Never the connected branch. */
export const WIP_BRANCH = "armature/wip-setup";
/** The maximum allowed pixel difference per page: 0.5%. Exposed for the tests. */
export const MAX_PIXEL_DIFF = 0.005;

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
  /** git clone URL of the Armature repo (defaults to acts2man/armature). */
  armatureRepoUrl?: string;
  /** Exact origin of the Armature dashboard (allowedOrigins in createArmatureKit). */
  dashboardOrigin?: string;
};

const H = "----------------------------------------------------------------";

const DEFAULT_DASHBOARD_ORIGIN = "https://armature-sites.netlify.app";

export function buildSetupPrompt(ctx: SiteSetupContext): string {
  const repoUrl = ctx.armatureRepoUrl?.trim() || DEFAULT_ARMATURE_REPO_URL;
  const dashboardOrigin = ctx.dashboardOrigin?.trim() || DEFAULT_DASHBOARD_ORIGIN;
  const supabaseUrl = ctx.supabaseUrl.replace(/\/+$/, "");
  const formEndpoint = `${supabaseUrl}/functions/v1/form-submit`;
  const lines: string[] = [];
  lines.push(`Please set up the Armature kit on this repository (${ctx.repo}).`);
  lines.push("");
  lines.push(H);
  lines.push("HOW TO GET ARMATURE (do this first)");
  lines.push(H);
  lines.push(`- Clone Armature into a temp folder OUTSIDE this site's repo, read-only:`);
  lines.push(`    git clone --depth 1 ${repoUrl} ${ARMATURE_CLONE_PATH}`);
  lines.push(`- Never push to that clone. If ${ARMATURE_CLONE_PATH} already exists from a previous run, delete it first (rm -rf ${ARMATURE_CLONE_PATH}) and re-clone so you get the current commit.`);
  lines.push(`- If the clone fails (network, private repo, wrong URL): STOP. Do NOT write or "recreate" any kit files by hand from this prompt's description. Tell Troy the clone failed and print the exact error.`);
  lines.push(`- Read these three files from the clone BEFORE writing anything:`);
  lines.push(`    ${ARMATURE_CLONE_PATH}/kit/README.md   — the site contract, install steps, SSR / SPA differences, forms, SEO, blog.`);
  lines.push(`    ${ARMATURE_CLONE_PATH}/docs/SITE_CONTRACT.md   — every message the bridge sends, the schema, what "coded" vs "builder" means.`);
  lines.push(`    ${ARMATURE_CLONE_PATH}/docs/AUDIT.md   — what already works and how it is tested; use it to spot what needs a wrapper.`);
  lines.push(`- Follow the README path for this site's framework. Detect it from package.json:`);
  lines.push(`    Vite + React Router SPA — the README's "Installing on a new site" path.`);
  lines.push(`    TanStack Start SSR — the README's "TanStack Start" notes (route.head, generateMetadata, ArmatureRoute inside the router).`);
  lines.push(`    Anything else — STOP and tell Troy which framework the site uses and that Armature does not have a documented path for it yet. Do not push.`);
  lines.push("");
  lines.push(H);
  lines.push("WHICH BRANCH TO WORK ON");
  lines.push(H);
  lines.push(`- Do the work directly on ${ctx.branch}, the site's connected branch. There is no test branch: Armature verifies the site matches before you push, and Undo setup restores the pre-setup state as one revert commit if anything goes wrong.`);
  lines.push(`- Every commit is a normal commit. Never force-push. Never rewrite history.`);
  lines.push(`- The kit folder is at ${ctx.kitPath}. Copy the WHOLE folder from ${ARMATURE_CLONE_PATH}/kit/ verbatim: rsync -a --delete --include="*.ts" --include="*.tsx" --include="*.css" --include="*.json" --exclude="*.test.*" --exclude="README.md" ${ARMATURE_CLONE_PATH}/kit/ ${ctx.kitPath}/ (or the equivalent). Never edit files inside ${ctx.kitPath}.`);
  lines.push(`- After the copy, confirm the version and file list match the source exactly:`);
  lines.push(`    grep -q 'KIT_VERSION = "${ctx.currentVersion}"' ${ctx.kitPath}/version.ts    (the version.ts you just wrote is on ${ctx.currentVersion})`);
  lines.push(`    diff -r --brief ${ARMATURE_CLONE_PATH}/kit ${ctx.kitPath} | grep -v -E "(README\\.md|\\.test\\.)"    (nothing else should print)`);
  lines.push(`- If either check fails, the copy is wrong — do NOT patch it by hand. Redo the rsync from the clone.`);
  lines.push("");
  lines.push(H);
  lines.push("THE FULL SETUP (do every step, on the connected branch)");
  lines.push(H);
  lines.push(`Do these after the kit folder is copied and before the AFTER verification. Read the kit README's "Installing on a new site" section for each item — this list is a checklist, the README has the code.`);
  lines.push(`A. Create the kit once (src/lib/armature.ts or the equivalent) using createArmatureKit with EVERY option below, exactly:`);
  lines.push(`     allowedOrigins: ["${dashboardOrigin}"]   — the Armature dashboard's origin; do not use "*".`);
  lines.push(`     schema, content, siteKit — from the JSON files below.`);
  lines.push(`     layouts: import.meta.glob("../../content/layouts/*.json", { eager: true })`);
  lines.push(`     posts: import.meta.glob("../../content/posts/*.json", { eager: true }) and postIndex from content/posts/index.json (present but not linked).`);
  lines.push(`     forms: { endpoint: "${formEndpoint}", siteId: "${ctx.siteId}" }`);
  lines.push(`B. content/schema.json — the site contract file. armatureContract: 2, a pages: [] entry per real page, sections per page with content fields. Armature's connect check reads this file, so it MUST be present and valid before the push.`);
  lines.push(`C. content/pages.json — one entry per page slug, keyed the same way as content/schema.json. Every field the schema declares has a value of the right shape. Fill it from the site's current copy — text, image paths, link URLs — do not invent placeholder text.`);
  lines.push(`D. content/site-kit.json — the site's brand pulled from its current code:`);
  lines.push(`     colors: primary, secondary, background, text (from the site's Tailwind config or CSS variables — cite the source file in a comment above each color).`);
  lines.push(`     typography: heading and body fontFamily + weight scale + heading sizes h1–h6 in px (from the Tailwind config or the site's global CSS).`);
  lines.push(`     buttons.primary + buttons.outline: background, color, borderRadius, padding, hover — mirroring the site's current buttons byte-identical.`);
  lines.push(`     container.width and container.padding — from the site's current layout container.`);
  lines.push(`     seo: siteName, siteUrl, titlePattern, defaultDescription, defaultShareImage — from the site's current <head>.`);
  lines.push(`     Anything that already varies across breakpoints goes into the responsive nested shape kit/types.ts describes.`);
  lines.push(`E. content/layouts/<slug>.json — convert every coded section into builder elements. One layout file per page, keyed by page slug.`);
  lines.push(`     Wrap the page in a container element. Break the page into sections; each section becomes a Container element with the site's original outer element's classes attached via Advanced > CSS classes.`);
  lines.push(`     Every heading, paragraph, image, link, list, video, accordion and icon-list becomes its own builder element (Heading, Text Editor, Image, Button, Icon List, Video, Accordion, and so on). Style each one through the builder's real style block — spacing, colors, typography as real settings, not raw CSS.`);
  lines.push(`     Anything that pulls live data (a database, a fetch, an API) STAYS a registered site section (registerSiteSection in createArmatureKit). Do NOT convert that to builder elements — it must keep rendering the coded component.`);
  lines.push(`     Every page renders through <ArmatureSlot slug="<page>" defaults={["<site-section-key>", …]} /> so the builder can place, move and wrap coded sections. The defaults name every site section on that page, in order.`);
  lines.push(`F. Header and footer as builder parts:`);
  lines.push(`     content/layouts/_header.json and content/layouts/_footer.json, using Site Logo, Nav Menu and any other widgets the site needs.`);
  lines.push(`     Render them through <ArmatureChrome part="header" fallback={<CodedHeader />} /> and <ArmatureChrome part="footer" fallback={<CodedFooter />} />. The coded components stay as the fallback so nothing changes visually until the layouts are known-good.`);
  lines.push(`     The mobile menu (hamburger, off-canvas or dropdown) MUST behave exactly as today: same breakpoint, same open/close animation, same z-index.`);
  lines.push(`G. <ArmatureRoute /> placed BEFORE the 404 in the router, so builder pages resolve before the catch-all.`);
  lines.push(`H. SEO head tags driven by the kit's SEO data (computePageHead in kit/seo.ts). Server-rendered head tags MUST be identical to today (title, meta description, canonical, robots, og:*, twitter:*, hreflang, JSON-LD). Confirm with the head-tag check under BEFORE / AFTER below.`);
  lines.push(`I. public/sitemap.xml and public/robots.txt regenerated on every publish (kit/seo.ts helpers). Include them in .gitignore ONLY if the site already ignores generated files — otherwise commit them.`);
  lines.push(`J. Blog routes and templates PRESENT but NOT LINKED in the menu: /blog and /blog/<slug> via <ArmaturePostList /> and <ArmaturePost slug={slug} />, and content/posts/index.json empty ({ posts: [] }). The nav in _header.json must not add a Blog item.`);
  lines.push(`K. Wire the site's own content check to the kit's validator: import checkLayout and checkSiteKit from ${ctx.kitPath}/validate.ts and run them at build time (as a Vite plugin, a prebuild script, or the framework's equivalent) so a bad layout fails the build.`);
  lines.push(`L. AGENTS.md at the repo root — rules for AI builders working on this site:`);
  lines.push(`     Do NOT edit files under ${ctx.kitPath}. It is a verbatim copy; Armature updates it via the "Update kit" button.`);
  lines.push(`     Do NOT hand-edit content/layouts/*.json or content/site-kit.json. Those come from Armature's editor. Fix a builder-side issue by editing the site's own components or by opening the visual editor.`);
  lines.push(`     New content is added as builder elements (through Armature's editor). Only genuinely dynamic sections stay as site sections in the code.`);
  lines.push(`     Every visual check runs against the PRODUCTION build (npm run build && npm run preview, or the framework's equivalent). A dev-server check does not count.`);
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
  lines.push(`4. Do the setup — every step from the FULL SETUP section above, in order.`);
  if (ctx.pendingSteps.length > 0) {
    lines.push("   Then do the pending setup steps in order (these are on top of the full-setup checklist above):");
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
  lines.push(`7. Edit-mode check (locally only). Widen the kit's allowlist so a local parent can frame the site:`);
  lines.push(`     - Temporarily set allowedOrigins in src/lib/armature.ts to include "http://localhost:5173" alongside "${dashboardOrigin}".`);
  lines.push(`     - Serve the production build.`);
  lines.push(`     - Load .armature-verify/edit-parent.html (a tiny page you write that opens the site inside an iframe with ?armature=edit and posts a hello handshake using the bridge protocol from kit/bridge.ts).`);
  lines.push(`     - Confirm: the handshake succeeds; every heading, paragraph, image, button and list on the home page reports as its own element (their data-ae-id attributes show up in the bridge's element list); a synthetic drag on any element re-renders the page correctly (no exception, no broken layout).`);
  lines.push(`     - REVERT the allowedOrigins change (back to just "${dashboardOrigin}") and delete edit-parent.html before you commit. NEVER commit a widened allowlist.`);
  lines.push(`8. If every check passes, commit and push to ${ctx.branch}. Split the setup into normal commits ("Add Armature kit ${ctx.currentVersion}", "Wire header/footer to ArmatureChrome", "Convert home page to builder layouts", one per pending step). Never force-push.`);
  lines.push(`9. If anything does not match, DO NOT PUSH. Either fix the mismatch (usually a still-coded section wrapper that changed a class, or a head tag the kit hasn't been asked to render yet) and re-run the check, or stop and tell Troy exactly which page failed and how (the pixel diff percentage, or the first line of the text/link/alt/head diff). Never push a partial or "close enough" setup.`);
  lines.push(`10. Delete the .armature-verify/ folder before your final push (it does not belong on the connected branch).`);
  lines.push("");
  lines.push(H);
  lines.push("RUNNING OUT OF ROOM");
  lines.push(H);
  lines.push(`- If your context (memory) runs low BEFORE every check has passed on ${ctx.branch}, DO NOT PUSH to ${ctx.branch}. A half-done setup on the connected branch would break the live site.`);
  lines.push(`- Instead: create branch ${WIP_BRANCH}, commit everything you have done so far to that branch, push ${WIP_BRANCH} to origin, and tell Troy in one short sentence: "Setup isn't finished. Type continue and I'll pick up where I stopped." Do not push anything to ${ctx.branch}.`);
  lines.push(`- When Troy types continue in a fresh session, resume from ${WIP_BRANCH} (git fetch origin && git checkout ${WIP_BRANCH}) and keep going with the FULL SETUP + BEFORE / AFTER checklist above. When every check finally passes, put the finished work on ${ctx.branch} (git checkout ${ctx.branch} && git merge --no-ff ${WIP_BRANCH}) and delete ${WIP_BRANCH} (locally and on origin).`);
  lines.push(`- Never squash-force or rebase ${ctx.branch} onto ${WIP_BRANCH}. Merge with a normal merge commit or (if the branches diverged) rebase ${WIP_BRANCH} onto ${ctx.branch} and merge fast-forward.`);
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
  lines.push(`- Armature dashboard origin (allowedOrigins):    ${dashboardOrigin}`);
  lines.push(`- Site id (for createArmatureKit's forms config): ${ctx.siteId}`);
  lines.push(`- form-submit endpoint:  ${formEndpoint}`);
  if (ctx.liveUrl) lines.push(`- Live URL (only used to compare against your BEFORE/AFTER screenshots if the site is already on Netlify): ${ctx.liveUrl}`);
  lines.push("");
  lines.push(H);
  lines.push("WHEN YOU ARE DONE");
  lines.push(H);
  lines.push(`Push to ${ctx.branch} once every page check has passed. Do NOT open a pull request. Once Netlify rebuilds the branch, Armature reads data-armature-kit on <html> and the site flips from Needs setup to Connected automatically. Tell Troy: "Setup pushed to ${ctx.branch} on ${ctx.repo}. If anything looks wrong on the live site, use Undo setup under Site settings — Armature will restore the pre-setup state as one revert commit."`);
  return lines.join("\n");
}
