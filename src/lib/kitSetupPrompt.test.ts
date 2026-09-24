import { describe, expect, it } from "vitest";
import { ARMATURE_CLONE_PATH, buildSetupPrompt, DEFAULT_ARMATURE_REPO_URL, MAX_PIXEL_DIFF, WIP_BRANCH, type SiteSetupContext } from "./kitSetupPrompt.ts";

const context = (overrides: Partial<SiteSetupContext> = {}): SiteSetupContext => ({
  repo: "acme/alder-stone",
  branch: "main",
  kitPath: "src/lib/armature-kit",
  siteId: "11111111-1111-4111-8111-111111111111",
  liveUrl: "https://alderandstone.example.com",
  supabaseUrl: "https://project.supabase.co",
  currentVersion: "2.8.0",
  fromVersion: "2.5.0",
  releases: [
    { version: "2.6.0", date: "2026-09-22", notes: ["SEO tags on every page."], steps: [{ key: "seo", label: "SEO head", detail: "Render <ArmatureHead />." }] },
    { version: "2.8.0", date: "2026-09-24", notes: ["data-armature-kit on <html>."] },
  ],
  pendingSteps: [{ key: "seo", label: "SEO head", detail: "Render <ArmatureHead />.", version: "2.6.0" }],
  ...overrides,
});

describe("buildSetupPrompt — how to get Armature", () => {
  it("prints the exact clone command with the default Armature URL, into a folder outside the site repo", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain(`git clone --depth 1 ${DEFAULT_ARMATURE_REPO_URL} ${ARMATURE_CLONE_PATH}`);
    expect(text).toContain("OUTSIDE this site's repo");
  });

  it("uses a caller-provided armatureRepoUrl when set (agencies who fork Armature)", () => {
    const text = buildSetupPrompt(context({ armatureRepoUrl: "https://github.com/agencyx/armature.git" }));
    expect(text).toContain("git clone --depth 1 https://github.com/agencyx/armature.git");
    expect(text).not.toContain(DEFAULT_ARMATURE_REPO_URL);
  });

  it("says STOP and never recreate kit files if the clone fails", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain('Do NOT write or "recreate" any kit files by hand');
    expect(text).toContain("STOP");
  });

  it("tells the session to read kit/README.md, docs/SITE_CONTRACT.md and docs/AUDIT.md first", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain(`${ARMATURE_CLONE_PATH}/kit/README.md`);
    expect(text).toContain(`${ARMATURE_CLONE_PATH}/docs/SITE_CONTRACT.md`);
    expect(text).toContain(`${ARMATURE_CLONE_PATH}/docs/AUDIT.md`);
  });

  it("names the supported frameworks and says stop on anything else", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("Vite + React Router SPA");
    expect(text).toContain("TanStack Start");
    expect(text).toContain("STOP and tell Troy which framework");
  });
});

describe("buildSetupPrompt — copy verbatim, never write kit files yourself", () => {
  it("names rsync with a whitelist and the kit-path destination", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain(`${ARMATURE_CLONE_PATH}/kit/`);
    expect(text).toContain("src/lib/armature-kit");
    expect(text).toContain("rsync -a --delete");
  });

  it("verifies the copied version.ts matches the target version and refuses hand-patching", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain(`grep -q 'KIT_VERSION = "2.8.0"'`);
    expect(text).toContain("diff -r --brief");
    expect(text).toContain("do NOT patch it by hand");
  });
});

describe("buildSetupPrompt — the full setup checklist", () => {
  it("lists every item Tree Test Prep actually needed", () => {
    const text = buildSetupPrompt(context());
    // A: createArmatureKit + allowedOrigins + siteId + form-submit endpoint
    expect(text).toContain("createArmatureKit");
    expect(text).toContain('allowedOrigins: ["https://armature-sites.netlify.app"]');
    expect(text).toContain("11111111-1111-4111-8111-111111111111");
    expect(text).toContain("form-submit endpoint");
    // B, C, D: content files
    expect(text).toContain("content/schema.json");
    expect(text).toContain("content/pages.json");
    expect(text).toContain("content/site-kit.json");
    // E: layouts + converting coded sections + registerSiteSection stays for dynamic
    expect(text).toContain("content/layouts/");
    expect(text).toContain("registerSiteSection");
    expect(text).toContain("<ArmatureSlot");
    // F: header/footer via ArmatureChrome with coded fallback
    expect(text).toContain("<ArmatureChrome");
    expect(text).toContain("_header.json");
    expect(text).toContain("_footer.json");
    // G: ArmatureRoute before 404
    expect(text).toContain("<ArmatureRoute");
    expect(text).toContain("BEFORE the 404");
    // H: SEO head via computePageHead, identical head tags
    expect(text).toContain("computePageHead");
    // I: sitemap.xml and robots.txt
    expect(text).toContain("sitemap.xml");
    expect(text).toContain("robots.txt");
    // J: blog routes present but not linked
    expect(text).toContain("PRESENT but NOT LINKED");
    // K: content check wired to kit validator
    expect(text).toContain("checkLayout");
    expect(text).toContain("checkSiteKit");
    // L: AGENTS.md
    expect(text).toContain("AGENTS.md");
  });

  it("lets the caller override the dashboard origin", () => {
    const text = buildSetupPrompt(context({ dashboardOrigin: "https://portal.acme.example" }));
    expect(text).toContain('allowedOrigins: ["https://portal.acme.example"]');
    expect(text).not.toContain('"https://armature-sites.netlify.app"');
  });
});

describe("buildSetupPrompt — production-build verification", () => {
  it("spells out BEFORE / AFTER verification against the production build and the 0.5% pixel budget", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("PRODUCTION build");
    expect(text).toContain(".armature-verify/before/");
    expect(text).toContain(".armature-verify/after/");
    expect(text).toContain("BEFORE / AFTER VERIFICATION");
    expect(text).toContain(`${(MAX_PIXEL_DIFF * 100).toFixed(1)}%`);
    expect(text).toContain("visible-text list matches exactly");
    expect(text).toContain("link list matches exactly");
    expect(text).toContain("image alt attribute is identical");
    expect(text).toContain("head tag matches exactly");
  });

  it("adds an edit-mode handshake check with a local allowlist widened only locally", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("Edit-mode check");
    expect(text).toContain("http://localhost:5173");
    expect(text).toContain("?armature=edit");
    expect(text).toContain("data-ae-id");
    expect(text).toContain("synthetic drag");
    expect(text).toContain("REVERT the allowedOrigins");
    expect(text).toContain("NEVER commit a widened allowlist");
  });

  it("says do-not-push on mismatch and no force-push", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("DO NOT PUSH");
    expect(text).toContain("Never force-push");
    expect(text).toContain("normal commit");
  });

  it("mentions Undo setup for the safety net, but no branch merge and no PR", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("Undo setup");
    expect(text).not.toContain("branch preview");
    expect(text).not.toContain("through the GitHub API");
    expect(text).toContain("Do NOT open a pull request");
  });
});

describe("buildSetupPrompt — running out of room", () => {
  it("says use the wip branch and never push a partial setup to the connected branch", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain(WIP_BRANCH);
    expect(text).toContain("armature/wip-setup");
    expect(text).toContain("DO NOT PUSH to main");
    expect(text).toContain("Type continue");
  });

  it("uses the site's non-main connected branch in the wip resume", () => {
    const text = buildSetupPrompt(context({ branch: "production" }));
    expect(text).toContain("git checkout production");
    expect(text).toContain("DO NOT PUSH to production");
  });
});

describe("buildSetupPrompt — branch and versions", () => {
  it("names the connected branch and works directly on it (no test branch)", () => {
    const text = buildSetupPrompt(context({ branch: "main" }));
    expect(text).toContain("directly on main");
    // No test-branch language survives from the previous flow.
    expect(text).not.toContain("armature/setup");
    expect(text).not.toContain("test-copy");
    expect(text).not.toContain("test copy");
    expect(text).not.toContain("Go live");
    expect(text).not.toContain("Preview");
  });

  it("shows the target version and pending steps in order", () => {
    const text = buildSetupPrompt(context());
    expect(text).toContain("Target version: 2.8.0 (site is currently on 2.5.0)");
    expect(text).toContain("1. SEO head (added in 2.6.0) — Render <ArmatureHead />.");
  });

  it("shows the form-submit endpoint and trims trailing slash on supabaseUrl", () => {
    const text = buildSetupPrompt(context({ supabaseUrl: "https://project.supabase.co/" }));
    expect(text).toContain("form-submit endpoint:  https://project.supabase.co/functions/v1/form-submit");
    expect(text).not.toContain("STATS_ENDPOINT");
  });

  it("says 'fresh install' when the site has no current version", () => {
    const text = buildSetupPrompt(context({ fromVersion: null }));
    expect(text).toContain("(fresh install)");
  });

  it("still lists the FULL SETUP items when there are no pending steps (a fresh install)", () => {
    const text = buildSetupPrompt(context({ pendingSteps: [] }));
    // Fresh install still needs every full-setup item; only the "Do the pending setup steps in order" list is omitted.
    expect(text).toContain("content/schema.json");
    expect(text).toContain("content/pages.json");
    expect(text).not.toContain("Do the pending setup steps in order");
  });
});
