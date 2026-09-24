#!/usr/bin/env node
/**
 * Record the Getting Started walkthroughs as .webm files under public/guide-videos/.
 *
 * Runs Playwright against the dashboard on http://localhost:5173 and the demo site on
 * http://localhost:5174 (both must be running — `npm run dev` in the repo root and
 * `npm run dev` inside examples/demo-site/, or set ARMATURE_E2E_PORT / ARMATURE_E2E_SITE_PORT
 * to point elsewhere). Each section drives a short scripted walk through the UI and
 * writes one .webm file, capped at 90 seconds and 5 MB.
 *
 * The recorder never touches Supabase or GitHub — it walks the pages that render
 * from the app shell alone, and the tests-style mocked fixtures under
 * tests/e2e/mocks.ts are NOT loaded here. If a real Supabase is not set up the
 * recorder will show sign-in screens; that is fine for the early stubby videos
 * (Sections 1 and 7 focus on GitHub and the sign-in flow anyway).
 *
 * The script exits non-zero if any file it wrote is larger than the 5 MB cap.
 */
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(REPO_ROOT, "public", "guide-videos");
const RAW_DIR = join(OUT_DIR, "_raw");
const MAX_BYTES = 5 * 1024 * 1024;
const DASHBOARD = `http://localhost:${process.env.ARMATURE_E2E_PORT ?? "5173"}`;

/** Each section's script: a sequence of { at: ms, caption, action?: (page) => Promise<void> }. */
const SCRIPTS = [
  {
    key: "agency-setup",
    title: "One-time agency setup",
    steps: [
      { at: 0, caption: "Getting started — one-time agency setup." },
      { at: 4_000, caption: "Create the GitHub App under your profile.", action: (page) => page.goto(`${DASHBOARD}/getting-started`) },
      { at: 10_000, caption: "Homepage URL, Setup URL, and Contents = Read and write." },
      { at: 16_000, caption: "Install on any account; pick All repositories or Only select." },
      { at: 24_000, caption: "Change repo access later under Installed GitHub Apps > Configure." },
      { at: 32_000, caption: "Sign in to Netlify and note your team." },
      { at: 38_000, caption: "Optional: add Resend for branded email invites." },
      { at: 44_000, caption: "That's it — every future site takes minutes." },
    ],
    duration: 50_000,
  },
  {
    key: "add-site",
    title: "Connect a new client site",
    steps: [
      { at: 0, caption: "Add a site — under two minutes once the App is installed.", action: (page) => page.goto(`${DASHBOARD}/projects`) },
      { at: 4_000, caption: "Projects > Add a site." },
      { at: 10_000, caption: "Pick the client's repo from the dropdown; branch autofills." },
      { at: 16_000, caption: "Press Check and connect: green passes, amber missing files." },
      { at: 22_000, caption: "A site with amber files saves as Needs setup — the next section fixes that." },
    ],
    duration: 30_000,
  },
  {
    key: "set-up-site",
    title: "Set up the site with the prompt",
    steps: [
      { at: 0, caption: "Set up this site — one-time per site.", action: (page) => page.goto(`${DASHBOARD}/getting-started`) },
      { at: 5_000, caption: "Copy prompt, paste into Claude Code on the web." },
      { at: 12_000, caption: "Claude works on armature/setup, never on the live branch." },
      { at: 20_000, caption: "Preview appears — check the site there." },
      { at: 28_000, caption: "Go live merges the branch via GitHub API — never a force-push." },
      { at: 36_000, caption: "Netlify rebuilds once; the site is set up." },
    ],
    duration: 42_000,
  },
  {
    key: "give-access",
    title: "Give the client access",
    steps: [
      { at: 0, caption: "Give a client access — three things.", action: (page) => page.goto(`${DASHBOARD}/getting-started`) },
      { at: 5_000, caption: "Users > Invite user, paste their email, pick editing level." },
      { at: 12_000, caption: "Words only, Words + styles, or Full builder." },
      { at: 20_000, caption: "Copy the invite link and send it however you like." },
      { at: 28_000, caption: "View as client: see the Dashboard exactly as they will." },
    ],
    duration: 36_000,
  },
  {
    key: "editing-publishing",
    title: "Editing and publishing",
    steps: [
      { at: 0, caption: "Editing and publishing — one commit per Publish.", action: (page) => page.goto(`${DASHBOARD}/getting-started`) },
      { at: 5_000, caption: "Click text to edit in place; every change is a draft." },
      { at: 12_000, caption: "Bunch edits: one publish = one commit = one Netlify build credit." },
      { at: 20_000, caption: "Press Publish; the live site updates in one to two minutes." },
      { at: 28_000, caption: "Publish history lists every publish and its commit URL." },
    ],
    duration: 36_000,
  },
  {
    key: "keep-updated",
    title: "Keeping sites up to date",
    steps: [
      { at: 0, caption: "Keeping sites up to date — kit updates.", action: (page) => page.goto(`${DASHBOARD}/getting-started`) },
      { at: 5_000, caption: "New widgets and SEO changes need a kit update." },
      { at: 12_000, caption: "Site settings > Connection > Kit > Update kit." },
      { at: 20_000, caption: "Test on one site first, then Update all — three at a time." },
      { at: 28_000, caption: "Undo restores the previous version as a fresh commit." },
    ],
    duration: 36_000,
  },
  {
    key: "troubleshoot",
    title: "Troubleshooting",
    steps: [
      { at: 0, caption: "Troubleshooting — the five common fixes.", action: (page) => page.goto(`${DASHBOARD}/getting-started`) },
      { at: 5_000, caption: "1. Redirected wrong: Installed GitHub Apps > Configure > Save." },
      { at: 12_000, caption: "2. Repo missing: tick it under Repository access on GitHub." },
      { at: 20_000, caption: "3. Editor won't load: Site settings > Connection > Check connection." },
      { at: 28_000, caption: "4. Needs attention: read the Netlify build log for the exact error." },
      { at: 36_000, caption: "5. Publish conflict: Keep yours, Keep theirs, or resolve field-by-field." },
    ],
    duration: 44_000,
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });

  // Dynamic import so this script works even when @playwright/test is not installed
  // (it is a devDependency, so a fresh checkout should have it after npm install).
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch (error) {
    console.error("[record-guide-videos] @playwright/test is not installed. Run `npm install` first.");
    console.error(error?.message ?? error);
    process.exit(1);
  }

  const launchOptions = process.env.PLAYWRIGHT_CHROMIUM || existsSync("/opt/pw-browsers/chromium")
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium" }
    : {};
  const browser = await chromium.launch(launchOptions);

  for (const script of SCRIPTS) {
    process.stderr.write(`[record-guide-videos] recording ${script.key}: ${script.title}\n`);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 720 } },
    });

    // Overlay the caption bar. Reset on every navigation via addInitScript.
    await context.addInitScript(() => {
      const install = () => {
        if (document.getElementById("__armature_caption_bar")) return;
        const bar = document.createElement("div");
        bar.id = "__armature_caption_bar";
        bar.setAttribute("aria-hidden", "true");
        Object.assign(bar.style, {
          position: "fixed",
          left: "0",
          right: "0",
          bottom: "0",
          padding: "16px 32px",
          background: "rgba(22, 32, 43, 0.92)",
          color: "#ffffff",
          font: "600 32px/1.25 ui-sans-serif, system-ui, sans-serif",
          zIndex: "2147483647",
          textAlign: "center",
        });
        document.body.appendChild(bar);
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
      else install();
      const observer = new MutationObserver(install);
      observer.observe(document.documentElement, { childList: true, subtree: false });
      /** Change the caption. */
      window.__armatureCaption = (text) => {
        install();
        const bar = document.getElementById("__armature_caption_bar");
        if (bar) bar.textContent = text;
      };
    });

    const page = await context.newPage();
    // Bail out fast on load failures so a stuck dev server doesn't leave a black recording.
    page.setDefaultTimeout(15_000);
    try {
      await page.goto(DASHBOARD, { waitUntil: "domcontentloaded" });
    } catch (error) {
      process.stderr.write(`[record-guide-videos] could not reach ${DASHBOARD}: ${error?.message ?? error}\n`);
      await context.close();
      await browser.close();
      process.exit(1);
    }

    const start = Date.now();
    let stepIndex = 0;
    while (Date.now() - start < script.duration) {
      const elapsed = Date.now() - start;
      const nextStep = script.steps[stepIndex];
      if (nextStep && elapsed >= nextStep.at) {
        try {
          if (nextStep.action) await nextStep.action(page);
          await page.evaluate((text) => window.__armatureCaption?.(text), nextStep.caption);
          process.stderr.write(`[record-guide-videos]   ${script.key} @ ${elapsed}ms: ${nextStep.caption}\n`);
        } catch (error) {
          process.stderr.write(`[record-guide-videos]   step failed: ${error?.message ?? error}\n`);
        }
        stepIndex += 1;
      }
      await sleep(200);
    }

    await context.close();

    // Playwright names the video with a random hash. Rename the newest .webm to
    // <section-key>.webm, then delete anything else in the raw folder.
    const files = (await readdir(RAW_DIR)).filter((name) => name.endsWith(".webm"));
    let latest = null;
    for (const name of files) {
      const info = await stat(join(RAW_DIR, name));
      if (!latest || info.mtimeMs > latest.mtimeMs) latest = { name, mtimeMs: info.mtimeMs };
    }
    if (!latest) throw new Error(`Playwright did not produce a video file for ${script.key}.`);
    const target = join(OUT_DIR, `${script.key}.webm`);
    await rename(join(RAW_DIR, latest.name), target);
    const info = await stat(target);
    process.stderr.write(`[record-guide-videos]   wrote ${script.key}.webm (${Math.round(info.size / 1024)} KB)\n`);
    if (info.size > MAX_BYTES) {
      throw new Error(`${script.key}.webm is ${info.size} bytes, over the ${MAX_BYTES}-byte cap. Shorten the script or lower the resolution.`);
    }
  }

  await browser.close();
  await rm(RAW_DIR, { recursive: true, force: true }).catch(() => {});
  // Refresh the .gitkeep so the folder is still tracked when everything is deleted later.
  await writeFile(join(OUT_DIR, ".gitkeep"), "");
  process.stderr.write("[record-guide-videos] done.\n");
}

main().catch((error) => {
  process.stderr.write(`[record-guide-videos] ${error?.stack ?? error}\n`);
  process.exit(1);
});
