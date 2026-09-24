/**
 * A Supabase that lives entirely inside Playwright's request interception: a seeded
 * session, the few PostgREST tables the dashboard reads, and the edge functions the
 * visual editor calls. GitHub is never touched; the batch publish answers with a
 * fake commit (or a conflict) and records what it was asked to write.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { checkLayout, checkSiteKit } from "../../kit/validate.ts";

export const SUPABASE_URL = "https://mock.supabase.test";
/** Where the demo site runs (see ARMATURE_E2E_SITE_PORT in playwright.config.ts). */
export const DEMO_SITE_URL = `http://localhost:${process.env["ARMATURE_E2E_SITE_PORT"] ?? "5174"}`;
export const SITE_ID = "11111111-1111-4111-8111-111111111111";
export const AGENCY_ID = "22222222-2222-4222-8222-222222222222";
export const STAFF_ID = "33333333-3333-4333-8333-333333333333";
export const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
export const COMMIT_SHA = "abc1234def5678abc1234def5678abc1234def56";

const demoDir = fileURLToPath(new URL("../../examples/demo-site/content/", import.meta.url));
export const demoSchema = JSON.parse(readFileSync(`${demoDir}schema.json`, "utf8")) as unknown;
export const demoContent = JSON.parse(readFileSync(`${demoDir}pages.json`, "utf8")) as Record<string, Record<string, Record<string, unknown>>>;
export const demoKit = JSON.parse(readFileSync(`${demoDir}site-kit.json`, "utf8")) as unknown;
export const demoLayouts = Object.fromEntries(
  readdirSync(`${demoDir}layouts`)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.slice(0, -".json".length), JSON.parse(readFileSync(`${demoDir}layouts/${name}`, "utf8")) as unknown]),
) as Record<string, unknown>;

/** The first real converted site's content/ folder, as committed (tests/fixtures/treetestprep). */
const realDir = fileURLToPath(new URL("../fixtures/treetestprep/", import.meta.url));
export const realSchema = JSON.parse(readFileSync(`${realDir}schema.json`, "utf8")) as unknown;
export const realContent = JSON.parse(readFileSync(`${realDir}pages.json`, "utf8")) as Record<string, Record<string, Record<string, unknown>>>;
export const realKit = JSON.parse(readFileSync(`${realDir}site-kit.json`, "utf8")) as unknown;
export const realLayouts = Object.fromEntries(
  readdirSync(`${realDir}layouts`)
    .filter((name) => name.endsWith(".json"))
    .map((name) => [name.slice(0, -".json".length), JSON.parse(readFileSync(`${realDir}layouts/${name}`, "utf8")) as unknown]),
) as Record<string, unknown>;
/** Where the real site runs when tests/e2e/real-site.spec.ts is enabled (see playwright.config.ts). */
export const REAL_SITE_URL = process.env["REAL_SITE_URL"] ?? "http://localhost:5175";

export type Role = "staff" | "client";

export type MockOptions = {
  role?: Role;
  /** Overrides the live URL (for the blocked / unreachable connection tests). */
  liveUrl?: string | null;
  /** What content-publish-batch answers. */
  publish?: "ok" | "conflict" | "failed";
  /** What site-embed-check answers. */
  embed?: { reachable: boolean; status: number | null; xFrameOptions: string | null; frameAncestors: string | null };
  /** Content returned by content-get; defaults to the demo site's files. */
  content?: Record<string, unknown>;
  /** Let Google Fonts load (for screenshots). Tests block them so nothing leaves the machine. */
  allowFonts?: boolean;
  /** What clients may do in the editor; agency staff always get the full builder. */
  editingLevel?: "content" | "style" | "builder";
  /** Layouts returned by content-get; defaults to the demo site's files. */
  layouts?: Record<string, unknown>;
  /** builder-publish: "ok" (default), or "conflict-once" (a layout conflict until the person chooses). */
  builderPublish?: "ok" | "conflict-once";
  /** REST rows present before the test starts (a draft saved on another device, templates). */
  rows?: Record<string, Record<string, unknown>[]>;
  /** Validator problems content-get reports (values the site's files hold that the editor cannot read). */
  problems?: unknown[];
  /** Serve the real converted site's files (schema, pages, layouts, kit) instead of the demo's, with its live URL. */
  fixture?: "demo" | "treetestprep";
  /** The site kit content-get returns; defaults to the demo site's. */
  siteKit?: unknown;
  /**
   * More sites next to the main one, for the site switcher: the agency looks after them all,
   * and a client is a member of them too. Each is the main site with these fields changed.
   */
  moreSites?: { id: string; name: string; status?: "connected" | "needs_attention" | "hosting_only" | "needs_setup"; kit_version_in_repo?: string | null; kit_version_live?: string | null; kit_verdict?: "not_installed" | "needs_setup" | "update_available" | "up_to_date" | null; kit_probed_at?: string | null }[];
  /** More sites the agency looks after (hosting-only, so nothing tries to read their content), for the Clients screen. */
  extraSites?: { id: string; name: string }[];
  /** Kit snapshot on the primary site (defaults: current release, `up_to_date`). */
  kit?: { version_in_repo?: string | null; version_live?: string | null; verdict?: "not_installed" | "needs_setup" | "update_available" | "up_to_date" | null; probed_at?: string | null };
  /**
   * What kit-status answers on the wire (overrides the primary site's `kit` snapshot for
   * the panel view). Useful for driving the Update kit modal from a fresh probe.
   */
  kitStatus?: { inRepo?: string | null; live?: string | null; verdict?: "not_installed" | "needs_setup" | "update_available" | "up_to_date"; reason?: string };
  /** What update-kit returns; on "local-edits" it rejects the first call unless overwrite=true. */
  updateKit?: "ok" | "local-edits" | "error";
  /** What undo-kit-update returns; default "ok". */
  undoKit?: "ok" | "error";
  /** Sets sites.pre_setup_commit_sha for the primary site — used by Undo setup. */
  preSetupCommitSha?: string | null;
  /** What undo-site-setup returns; default "ok". */
  undoSiteSetup?: "ok" | "no-snapshot" | "error";
  /** github-setup responses (installations + list_repositories). */
  githubSetup?: {
    installations?: { installation_id: number; account_login: string; account_type: "User" | "Organization" }[];
    /** Full list of repositories to answer list_repositories with. */
    repositories?: { installation_id: number; account_login: string; owner: string; name: string; full_name: string; private?: boolean; default_branch?: string }[];
    /** When true, the response also carries page_cap_hit=true. */
    pageCapHit?: boolean;
    pageCap?: number;
  };
};

export type MockState = {
  publishRequests: unknown[];
  builderPublishRequests: Record<string, unknown>[];
  contentGets: number;
  /** Rows written to REST tables (drafts, templates), by table. */
  rows: Record<string, Record<string, unknown>[]>;
};

const base64url = (value: string) => Buffer.from(value).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function jwt(userId: string, email: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ sub: userId, email, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 365, iat: Math.floor(Date.now() / 1000) }));
  return `${header}.${payload}.${base64url("signature")}`;
}

const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });

export async function installMocks(page: Page, options: MockOptions = {}): Promise<MockState> {
  const role = options.role ?? "staff";
  const real = options.fixture === "treetestprep";
  const userId = role === "staff" ? STAFF_ID : CLIENT_ID;
  const email = role === "staff" ? "dana@agency.example" : "sam@alderstone.example";
  const fullName = role === "staff" ? "Dana Whitfield" : "Sam Alder";
  const user = { id: userId, aud: "authenticated", role: "authenticated", email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: { full_name: fullName }, created_at: new Date().toISOString() };
  const session = { access_token: jwt(userId, email), refresh_token: "refresh-mock", token_type: "bearer", expires_in: 3600 * 24 * 365, expires_at: Math.floor(Date.now() / 1000) + 3600 * 24 * 365, user };

  const agency = { id: AGENCY_ID, name: "Reputation Guardians", portal_name: "Reputation Guardians", logo_url: null, accent_color: "#2b3fd6", created_at: "2026-09-01T00:00:00Z" };
  const site = {
    id: SITE_ID,
    agency_id: AGENCY_ID,
    name: real ? "Tree Test Prep" : "Alder & Stone Custom Homes",
    repo_owner: real ? "acts2man" : "acme",
    repo_name: real ? "treetestprep" : "alder-stone",
    branch: real ? "armature/git-content" : "main",
    live_url: options.liveUrl === undefined ? (real ? REAL_SITE_URL : DEMO_SITE_URL) : options.liveUrl,
    github_installation_id: 123,
    status: "connected",
    last_published_at: "2026-09-20T15:00:00Z",
    created_at: "2026-09-01T00:00:00Z",
    kit_path: "src/lib/armature-kit",
    kit_version_in_repo: options.kit?.version_in_repo ?? "2.9.0",
    kit_version_live: options.kit?.version_live ?? "2.9.0",
    kit_verdict: options.kit?.verdict ?? "up_to_date",
    kit_probed_at: options.kit?.probed_at ?? new Date().toISOString(),
    pre_setup_commit_sha: options.preSetupCommitSha === undefined ? null : options.preSetupCommitSha,
  };

  const moreSites = (options.moreSites ?? []).map((extra) => ({
    ...site,
    ...extra,
    status: extra.status ?? "connected",
    kit_version_in_repo: extra.kit_version_in_repo === undefined ? site.kit_version_in_repo : extra.kit_version_in_repo,
    kit_version_live: extra.kit_version_live === undefined ? site.kit_version_live : extra.kit_version_live,
    kit_verdict: extra.kit_verdict === undefined ? site.kit_verdict : extra.kit_verdict,
    kit_probed_at: extra.kit_probed_at === undefined ? site.kit_probed_at : extra.kit_probed_at,
  }));
  const extraSites = (options.extraSites ?? []).map((extra) => ({ ...site, ...extra, repo_owner: null, repo_name: null, branch: null, live_url: null, github_installation_id: null, status: "hosting_only", last_published_at: null }));
  const allSites = () => [site, ...moreSites, ...extraSites];

  const state: MockState = { publishRequests: [], builderPublishRequests: [], contentGets: 0, rows: JSON.parse(JSON.stringify(options.rows ?? {})) as MockState["rows"] };
  /** Rows the profiles table answers with; client-create adds to it. */
  const profiles = (state.rows["profiles"] ??= [
    { id: STAFF_ID, email: "dana@agency.example", full_name: "Dana Whitfield", created_at: "2026-09-01T00:00:00Z", last_sign_in_at: new Date(Date.now() - 3600_000).toISOString() },
    { id: CLIENT_ID, email: "sam@alderstone.example", full_name: "Sam Alder", created_at: "2026-09-02T00:00:00Z", last_sign_in_at: "2026-09-20T15:00:00Z" },
  ]);
  // The content "in the repository": a batch publish updates it, as a real one would.
  const schema = real ? realSchema : demoSchema;
  const content = JSON.parse(JSON.stringify(options.content ?? (real ? realContent : demoContent))) as Record<string, Record<string, Record<string, unknown>>>;
  const layouts = JSON.parse(JSON.stringify(options.layouts ?? (real ? realLayouts : demoLayouts))) as Record<string, unknown>;
  const media = real
    ? [
        { path: "/assets/ken-menzer-hero.webp", bytes: 180_000, kind: "image", alt: "" },
        { path: "/assets/course-classroom.webp", bytes: 120_000, kind: "image", alt: "Students attending an arborist preparation course" },
        { path: "/assets/isa-certified-arborist-credential-badge.webp", bytes: 20_000, kind: "image", alt: "ISA Certified Arborist credential badge" },
      ]
    : [
        { path: "/assets/hero.svg", bytes: 2400, kind: "image", alt: "A timber-framed house at dusk" },
        { path: "/assets/team.svg", bytes: 1800, kind: "image", alt: "" },
      ];
  let commitSha = COMMIT_SHA;
  let siteKit: unknown = options.siteKit ?? (real ? realKit : demoKit);
  /** Builder pages in the bin (content/trash/), by slug. */
  const trashBin: Record<string, unknown> = {};
  /** What content-get answers: the files as the validator cleans them, plus every problem it found (exactly as the real function does). */
  const builderFiles = () => {
    const cleaned: Record<string, unknown> = {};
    const problems: unknown[] = [...(options.problems ?? [])];
    for (const [slug, raw] of Object.entries(layouts)) {
      const report = checkLayout(raw);
      if (report.value) cleaned[slug] = report.value;
      problems.push(...report.problems.map((problem) => ({ ...problem, file: `content/layouts/${slug}.json`, slug })));
    }
    const kit = checkSiteKit(siteKit);
    problems.push(...kit.problems.map((problem) => ({ ...problem, file: "content/site-kit.json" })));
    const trash: Record<string, unknown> = {};
    for (const [slug, raw] of Object.entries(trashBin)) {
      const report = checkLayout(raw);
      if (report.value) trash[slug] = report.value;
    }
    return { layouts: cleaned, siteKit: kit.value, problems, trash };
  };

  // Nothing in these tests may leave the machine (fonts and the like).
  if (!options.allowFonts) await page.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, (route) => route.abort());

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: "sb-mock-auth-token", value: session },
  );

  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
      return;
    }

    // --- auth ------------------------------------------------------------------
    if (path.startsWith("/auth/v1/user")) return json(route, user);
    if (path.startsWith("/auth/v1/token")) return json(route, session);
    if (path.startsWith("/auth/v1/logout")) return json(route, {});

    // --- rest ------------------------------------------------------------------
    if (path.startsWith("/rest/v1/")) {
      const table = path.slice("/rest/v1/".length);
      const wantsCount = (request.headers()["prefer"] ?? "").includes("count=");
      const countOf = (n: number) => json(route, [], 200, { "content-range": `0-${Math.max(0, n - 1)}/${n}` });
      switch (table) {
        case "agency_members":
          if (url.searchParams.has("agency_id")) return json(route, [{ agency_id: AGENCY_ID, user_id: STAFF_ID, role: "owner", created_at: "2026-09-01T00:00:00Z" }]);
          return json(route, role === "staff" ? [{ role: "owner", agency }] : []);
        case "site_members": {
          // Auth's membership read (no site_id filter) versus the Users screen's table.
          if (!url.searchParams.has("site_id")) return json(route, role === "client" ? [{ role: "client_owner", site }, ...moreSites.map((extra) => ({ role: "client_editor", site: extra }))] : []);
          const rows = (state.rows["site_members"] ??= [{ site_id: SITE_ID, user_id: CLIENT_ID, role: "client_owner", created_at: "2026-09-02T09:00:00Z" }]);
          const matches = (row: Record<string, unknown>) =>
            [...url.searchParams].every(([column, filter]) => {
              if (filter.startsWith("eq.")) return String(row[column]) === filter.slice(3);
              if (filter.startsWith("in.(")) return filter.slice(4, -1).split(",").map((part) => part.replace(/^"|"$/g, "")).includes(String(row[column]));
              return true;
            });
          if (request.method() === "POST") {
            const incoming = JSON.parse(request.postData() ?? "{}") as Record<string, unknown> | Record<string, unknown>[];
            const added = (Array.isArray(incoming) ? incoming : [incoming]).map((row) => ({ role: "client_editor", created_at: new Date().toISOString(), ...row }));
            rows.push(...added);
            return json(route, added, 201);
          }
          if (request.method() === "PATCH") {
            const patch = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
            for (const row of rows) if (matches(row)) Object.assign(row, patch);
            return json(route, rows.filter(matches));
          }
          if (request.method() === "DELETE") {
            state.rows["site_members"] = rows.filter((row) => !matches(row));
            return json(route, []);
          }
          return json(route, rows.filter(matches));
        }
        case "invites": {
          const rows = (state.rows["invites"] ??= []);
          const matches = (row: Record<string, unknown>) => [...url.searchParams].every(([column, filter]) => (filter.startsWith("eq.") ? String(row[column]) === filter.slice(3) : filter === "is.null" ? row[column] === null || row[column] === undefined : true));
          if (request.method() === "DELETE") {
            state.rows["invites"] = rows.filter((row) => !matches(row));
            return json(route, []);
          }
          return json(route, rows.filter(matches));
        }
        case "agencies":
          return json(route, [agency]);
        case "profiles":
          return json(route, profiles);
        case "sites": {
          if (wantsCount) return countOf(allSites().length);
          if (request.method() === "PATCH") {
            const patch = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
            (state.rows["sites"] ??= []).push(patch);
            Object.assign(site, patch);
          }
          const id = url.searchParams.get("id");
          if (id?.startsWith("eq.")) return json(route, allSites().filter((row) => row.id === id.slice(3)));
          return json(route, allSites());
        }
        case "publishes":
          return json(route, state.rows["publishes"] ?? []);
        case "change_requests":
          if (wantsCount) return countOf(0);
          if (request.method() === "POST") return json(route, [{ id: "55555555-5555-4555-8555-555555555555" }], 201);
          return json(route, []);
        case "site_services": {
          const rows = (state.rows["site_services"] ??= []);
          if (request.method() === "POST" || request.method() === "PATCH") {
            const patch = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
            const existing = rows.find((row) => row["site_id"] === (patch["site_id"] ?? SITE_ID));
            if (existing) Object.assign(existing, patch);
            else rows.push({ site_id: SITE_ID, form_recipients: [], notes: "", ...patch });
            return json(route, rows, 201);
          }
          return json(route, rows);
        }
        case "site_billing":
          return json(route, []);
        case "form_submissions": {
          const rows = (state.rows["form_submissions"] ??= []);
          const method = request.method();
          const matches = (row: Record<string, unknown>) =>
            [...url.searchParams].every(([column, filter]) => {
              if (column === "select" || column === "order" || column === "limit" || column === "offset") return true;
              if (filter.startsWith("eq.")) return String(row[column]) === filter.slice(3);
              if (filter.startsWith("in.(")) return filter.slice(4, -1).split(",").map((part) => part.replace(/^"|"$/g, "")).includes(String(row[column]));
              if (filter === "is.null") return row[column] === null || row[column] === undefined;
              if (filter === "not.is.null") return row[column] !== null && row[column] !== undefined;
              return true;
            });
          const shown = rows.filter(matches).sort((a, b) => String(b["created_at"]).localeCompare(String(a["created_at"])));
          if (method === "HEAD" || (method === "GET" && wantsCount && (request.headers()["prefer"] ?? "").includes("head=true"))) return countOf(shown.length);
          if (method === "GET") {
            const limit = Number(url.searchParams.get("limit") ?? "0");
            return json(route, limit > 0 ? shown.slice(0, limit) : shown, 200, wantsCount ? { "content-range": `0-${Math.max(0, shown.length - 1)}/${shown.length}` } : {});
          }
          if (method === "PATCH") {
            const patch = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
            for (const row of rows) if (matches(row)) Object.assign(row, patch);
            return json(route, rows.filter(matches));
          }
          if (method === "DELETE") {
            state.rows["form_submissions"] = rows.filter((row) => !matches(row));
            return json(route, []);
          }
          return json(route, []);
        }
        case "kit_updates": {
          const rows = (state.rows["kit_updates"] ??= []);
          const method = request.method();
          if (method === "GET") {
            let shown = rows;
            for (const [column, filter] of url.searchParams) {
              if (column === "select" || column === "order" || column === "limit") continue;
              if (filter.startsWith("eq.")) shown = shown.filter((row) => String(row[column]) === filter.slice(3));
            }
            return json(route, shown);
          }
          return json(route, []);
        }
        case "builder_templates":
        case "builder_drafts": {
          const rows = (state.rows[table] ??= []);
          const method = request.method();
          if (method === "GET" || method === "HEAD") {
            // Honour "column=eq.value" filters (enough for id / site_id / user_id lookups).
            let shown = rows;
            for (const [column, filter] of url.searchParams) {
              if (filter.startsWith("eq.")) shown = shown.filter((row) => String(row[column]) === filter.slice(3));
            }
            const single = (request.headers()["accept"] ?? "").includes("vnd.pgrst.object");
            if (single) return shown[0] ? json(route, shown[0]) : json(route, { code: "PGRST116", message: "no rows" }, 406);
            return json(route, shown);
          }
          if (method === "POST") {
            const incoming = JSON.parse(request.postData() ?? "{}") as Record<string, unknown> | Record<string, unknown>[];
            const list = Array.isArray(incoming) ? incoming : [incoming];
            const upsert = (request.headers()["prefer"] ?? "").includes("resolution=merge-duplicates");
            const saved = list.map((row) => {
              const existing = upsert ? rows.findIndex((other) => other["site_id"] === row["site_id"] && other["user_id"] === row["user_id"]) : -1;
              const full = { id: `tpl-${rows.length + 1}-${Math.random().toString(16).slice(2, 8)}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row };
              if (existing >= 0) rows[existing] = { ...rows[existing], ...full, id: rows[existing]!["id"] };
              else rows.push(full);
              return full;
            });
            return json(route, saved, 201);
          }
          if (method === "DELETE") {
            const filters = [...url.searchParams].filter(([, filter]) => filter.startsWith("eq."));
            state.rows[table] = rows.filter((row) => !filters.every(([column, filter]) => String(row[column]) === filter.slice(3)));
            return json(route, [], 200);
          }
          return json(route, []);
        }
        case "site_storage_totals":
          return json(route, [{ site_id: SITE_ID, file_count: 0, total_bytes: 0 }]);
        default:
          return json(route, []);
      }
    }

    // --- storage ---------------------------------------------------------------
    // The SiteStoragePanel reads and writes to the site-files bucket. The mocks just
    // pretend the folder is empty; anything the panel might send back is accepted.
    if (path.startsWith("/storage/v1/")) {
      if (path.includes("/object/list/")) return json(route, []);
      if (request.method() === "POST" && path.includes("/object/")) return json(route, { path: path.split("/object/")[1], Key: "site-files", Id: "mock" });
      if (request.method() === "DELETE" && path.includes("/object/")) return json(route, { data: [] });
      return json(route, {});
    }

    // --- functions -------------------------------------------------------------
    if (path.startsWith("/functions/v1/")) {
      const name = path.slice("/functions/v1/".length);
      const body = request.postDataJSON() as Record<string, unknown>;
      switch (name) {
        case "content-get":
          state.contentGets += 1;
          if (typeof body["ref"] === "string") {
            // An older version: the home layout's "Recent builds" heading read differently then.
            const older = JSON.parse(JSON.stringify(layouts).replace('"Recent builds"', '"Builds from last spring"')) as Record<string, unknown>;
            return json(route, { ok: true, schema, content, commitSha: body["ref"], branch: site.branch, repo: `${site.repo_owner}/${site.repo_name}`, warnings: [], problems: [], layouts: older, siteKit: builderFiles().siteKit, media, editingLevel: options.editingLevel ?? "content" });
          }
          return json(route, { ok: true, schema, content, commitSha, branch: site.branch, repo: `${site.repo_owner}/${site.repo_name}`, warnings: [], ...builderFiles(), media, editingLevel: options.editingLevel ?? "content" });
        case "builder-publish": {
          state.builderPublishRequests.push(body);
          const resolutions = (body["resolutions"] ?? {}) as Record<string, string>;
          if (options.builderPublish === "conflict-once" && !resolutions["layout:home:hdbuilds"]) {
            return json(route, {
              ok: false,
              code: "conflict",
              message: "Someone else published changes to the same thing while you were editing.",
              fields: ['Both you and someone else changed heading "Recent builds"'],
              conflicts: [{ key: "layout:home:hdbuilds", page: "home", elementId: "hdbuilds", label: 'Both you and someone else changed heading "Recent builds"' }],
            });
          }
          for (const page of (body["pages"] ?? []) as { slug: string; fields: { section: string; field: string; value: unknown }[] }[]) {
            for (const field of page.fields) ((content[page.slug] ??= {})[field.section] ??= {})[field.field] = field.value;
          }
          const written = Object.keys((body["layouts"] ?? {}) as Record<string, unknown>);
          for (const [slug, layout] of Object.entries((body["layouts"] ?? {}) as Record<string, unknown>)) {
            if (layout === null) delete layouts[slug];
            else layouts[slug] = layout;
          }
          if (body["kit"]) siteKit = body["kit"];
          // The bin and copies, as the function does them (the file moves or is copied as it is).
          const trashed: string[] = [];
          for (const [slug, action] of Object.entries((body["trash"] ?? {}) as Record<string, string>)) {
            if (action === "trash" && layouts[slug]) {
              trashBin[slug] = layouts[slug];
              delete layouts[slug];
            } else if (action === "restore" && trashBin[slug] && !layouts[slug]) {
              layouts[slug] = trashBin[slug];
              delete trashBin[slug];
            } else if (action === "delete" && trashBin[slug]) delete trashBin[slug];
            else return json(route, { ok: false, code: "invalid", message: `There is no page called "${slug}" for "${action}".` }, 400);
            trashed.push(slug);
          }
          for (const [slug, copy] of Object.entries((body["copies"] ?? {}) as Record<string, { from: string; label: string; path: string }>)) {
            const source = layouts[copy.from] as Record<string, unknown> | undefined;
            if (!source || layouts[slug]) return json(route, { ok: false, code: "invalid", message: `A page called "${slug}" already exists, or "${copy.from}" does not.` }, 400);
            layouts[slug] = { ...source, pageSlug: slug, label: copy.label || `${String(source["label"] ?? copy.from)} (copy)`, path: copy.path || `/${slug}/` };
            written.push(slug);
          }
          const uploaded: string[] = [];
          for (const upload of (body["uploads"] ?? []) as { name: string; data: string }[]) {
            const base = upload.name.replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "picture";
            const ext = /^data:image\/(\w+)/.exec(upload.data)?.[1]?.replace("jpeg", "jpg") ?? "png";
            let name = `${base}.${ext}`;
            let n = 2;
            while (media.some((file) => file.path === `/assets/uploads/${name}`)) name = `${base}-${n++}.${ext}`;
            media.push({ path: `/assets/uploads/${name}`, bytes: Math.floor((upload.data.length * 3) / 4), kind: "image", alt: "" });
            uploaded.push(`/assets/uploads/${name}`);
          }
          const deleted: string[] = [];
          for (const path of (body["deleteAssets"] ?? []) as string[]) {
            const index = media.findIndex((file) => file.path === path);
            if (index < 0) return json(route, { ok: false, code: "invalid", message: `There is no picture at ${path}; it may already be gone.` }, 400);
            media.splice(index, 1);
            deleted.push(path);
          }
          if (body["media"] && typeof body["media"] === "object") {
            const meta = body["media"] as Record<string, { alt: string }>;
            for (const file of media) file.alt = meta[file.path]?.alt ?? "";
          }
          commitSha = "b0b0b0b0b1b1b1b1b2b2b2b2b3b3b3b3b4b4b4b4";
          const stamp = new Date().toISOString();
          if (written.length > 0 || trashed.length > 0) (state.rows["publishes"] ??= []).unshift({ id: `pub-${stamp}`, site_id: SITE_ID, user_id: userId, page_slug: [...new Set([...written, ...trashed])].join(", "), fields_changed: [], commit_sha: commitSha, commit_url: `https://github.com/acme/alder-stone/commit/${commitSha}`, status: "committed", error: null, created_at: stamp });
          return json(route, { ok: true, commitSha, commitUrl: `https://github.com/acme/alder-stone/commit/${commitSha}`, fields: [], images: uploaded, slugs: written, layouts: written, trash: trashed, deleted, kit: !!body["kit"], media: !!body["media"], merged: options.builderPublish === "conflict-once" });
        }
        case "content-publish-batch":
          state.publishRequests.push(body);
          if (options.publish === "conflict") {
            return json(route, { ok: false, code: "conflict", message: "Someone else changed this field while you were editing: Home → Hero → Headline. Nothing was published. Reload to get their version, then reapply your change.", fields: ["Home → Hero → Headline"] });
          }
          if (options.publish === "failed") return json(route, { ok: false, code: "github_error", message: "GitHub answered with HTTP 502." });
          for (const page of body["pages"] as { slug: string; fields: { section: string; field: string; value: unknown }[] }[]) {
            for (const field of page.fields) ((content[page.slug] ??= {})[field.section] ??= {})[field.field] = field.value;
          }
          commitSha = "def5678abc1234def5678abc1234def5678abc12";
          return json(route, {
            ok: true,
            commitSha: "def5678abc1234def5678abc1234def5678abc12",
            commitUrl: "https://github.com/acme/alder-stone/commit/def5678abc1234def5678abc1234def5678abc12",
            fields: (body["pages"] as { slug: string; fields: { section: string; field: string }[] }[]).flatMap((page) => page.fields.map((field) => `${page.slug}.${field.section}.${field.field}`)),
            images: [],
            slugs: (body["pages"] as { slug: string }[]).map((page) => page.slug),
          });
        case "invite-create": {
          const email = String(body["email"] ?? "").toLowerCase();
          const rows = (state.rows["invites"] ??= []);
          const id = `inv-${rows.length + 1}`;
          const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
          rows.unshift({ id, agency_id: AGENCY_ID, site_id: body["site_id"] ?? null, email, role: body["role"], expires_at: expires, accepted_at: null, created_by: STAFF_ID, created_at: new Date().toISOString() });
          return json(route, { ok: true, invite_id: id, invite_url: `http://localhost:5173/invite/token-${id}`, expires_at: expires, emailed: false });
        }
        case "client-create": {
          // As the real function: an existing account only gains the membership; a new one is created with the flag.
          const email = String(body["email"] ?? "").toLowerCase();
          const target = allSites().find((row) => row.id === body["site_id"]);
          if (!target) return json(route, { ok: false, code: "forbidden", message: "That site does not exist, or it does not belong to your agency." });
          let profile = profiles.find((row) => row["email"] === email);
          const outcome = profile ? "already_existed" : "created";
          if (!profile) {
            profile = { id: `cccccccc-0000-4000-8000-${String(profiles.length + 1).padStart(12, "0")}`, email, full_name: body["full_name"], created_at: new Date().toISOString(), last_sign_in_at: null };
            profiles.push(profile);
          }
          const members = (state.rows["site_members"] ??= [{ site_id: SITE_ID, user_id: CLIENT_ID, role: "client_owner", created_at: "2026-09-02T09:00:00Z" }]);
          const had = members.some((row) => row["site_id"] === target.id && row["user_id"] === profile["id"]);
          if (!had) members.push({ site_id: target.id, user_id: profile["id"], role: body["role"], created_at: new Date().toISOString() });
          return json(route, {
            ok: true,
            outcome,
            email,
            site_name: target.name,
            sign_in_url: "http://localhost:5173/signin",
            message: outcome === "created" ? `An account was created for ${email} with access to ${target.name}. They will be asked to choose their own password the first time they sign in.` : `This person already has an account; they were given access to ${target.name}. Their existing password still applies.`,
          });
        }
        case "client-password-reset": {
          const profile = profiles.find((row) => row["id"] === body["user_id"]);
          if (!profile) return json(route, { ok: false, code: "forbidden", message: "Only agency staff can reset a client's password, and this person is not a client of a site your agency looks after." });
          return json(route, { ok: true, email: profile["email"], reset_url: `http://localhost:5173/signin#reset-${String(profile["id"]).slice(-4)}&type=recovery`, emailed: false });
        }
        case "site-embed-check":
          return json(route, { ok: true, url: site.live_url, ...(options.embed ?? { reachable: true, status: 200, xFrameOptions: null, frameAncestors: null }) });
        case "github-setup": {
          const action = String(body["action"] ?? "");
          if (action === "list_installations") {
            const installs = options.githubSetup?.installations ?? [
              { installation_id: 123, account_login: "acts2man", account_type: "Organization" as const },
            ];
            return json(route, { ok: true, action, installations: installs });
          }
          if (action === "list_repositories") {
            const repos = (options.githubSetup?.repositories ?? [
              { installation_id: 123, account_login: "acts2man", owner: "acts2man", name: site.repo_name ?? "armature", full_name: `${site.repo_owner ?? "acts2man"}/${site.repo_name ?? "armature"}`, private: false, default_branch: site.branch ?? "main" },
            ]).map((repo) => ({
              installation_id: repo.installation_id,
              account_login: repo.account_login,
              owner: repo.owner,
              name: repo.name,
              full_name: repo.full_name,
              private: repo.private ?? false,
              default_branch: repo.default_branch ?? "main",
              configure_url: `https://github.com/organizations/${repo.account_login}/settings/installations/${repo.installation_id}`,
            }));
            return json(route, { ok: true, action, repositories: repos, page_cap_hit: options.githubSetup?.pageCapHit ?? false, page_cap: options.githubSetup?.pageCap ?? 50 });
          }
          if (action === "install_url") {
            return json(route, { ok: true, action, url: "https://github.com/apps/armature/installations/new" });
          }
          return json(route, { ok: false, code: "invalid", message: `No mock for github-setup action ${action}` }, 400);
        }
        case "kit-status": {
          const inRepo = options.kitStatus?.inRepo === undefined ? "2.8.0" : options.kitStatus.inRepo;
          const live = options.kitStatus?.live === undefined ? "2.8.0" : options.kitStatus.live;
          const verdict = options.kitStatus?.verdict ?? "update_available";
          const current = "2.9.0";
          const reason = options.kitStatus?.reason ?? `Update available: ${inRepo ?? "unknown"} → ${current}. No new setup step; the update is a one-click job.`;
          return json(route, { ok: true, status: { current, inRepo, live, verdict, probed: [], pendingSteps: [], reason } });
        }
        case "update-kit": {
          if (options.updateKit === "error") return json(route, { ok: false, code: "github_error", message: "GitHub answered with HTTP 502." });
          if (options.updateKit === "local-edits" && body["overwrite"] !== true) {
            return json(route, { ok: false, code: "invalid", message: "The site's kit folder has local edits in 1 file: src/lib/armature-kit/index.ts. Choose Overwrite to replace them." });
          }
          const commitSha = "e11e11e1e11e11e1e11e11e1e11e11e1e11e11e1";
          const rows = (state.rows["kit_updates"] ??= []);
          const id = `ku-${rows.length + 1}`;
          rows.unshift({
            id,
            site_id: body["site_id"],
            from_version: "2.8.0",
            to_version: "2.9.0",
            commit_sha: commitSha,
            commit_url: `https://github.com/${site.repo_owner}/${site.repo_name}/commit/${commitSha}`,
            previous_commit_sha: "1234567abcdef",
            requested_by: STAFF_ID,
            status: "commit_pushed",
            status_detail: "12 added, 3 changed, 1 removed",
            live_checked_at: null,
            live_version_seen: null,
            attempts: 0,
            needs_attention_reason: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          return json(route, { ok: true, from: "2.8.0", to: "2.9.0", commit: { sha: commitSha, url: `https://github.com/${site.repo_owner}/${site.repo_name}/commit/${commitSha}` }, changed: { added: 12, changed: 3, removed: 1 }, update_id: id });
        }
        case "undo-site-setup": {
          if (options.undoSiteSetup === "no-snapshot") {
            return json(route, { ok: false, code: "invalid", message: "Armature does not have a pre-setup snapshot for this site, so Undo setup can't run." });
          }
          if (options.undoSiteSetup === "error") {
            return json(route, { ok: false, code: "github_error", message: "GitHub answered with HTTP 502." });
          }
          const commitSha = "c0ffee1c0ffee1c0ffee1c0ffee1c0ffee1c0ffe";
          return json(route, {
            ok: true,
            commit: { sha: commitSha, url: `https://github.com/${site.repo_owner}/${site.repo_name}/commit/${commitSha}` },
            changed: { restored: 4, deleted: 12 },
          });
        }
        case "undo-kit-update": {
          if (options.undoKit === "error") return json(route, { ok: false, code: "invalid", message: "This update was recorded before Armature started saving the previous commit." });
          const commitSha = "d0dd0dd0dd0dd0dd0dd0dd0dd0dd0dd0dd0dd0dd";
          const rows = (state.rows["kit_updates"] ??= []);
          const idx = rows.findIndex((row) => row["id"] === body["update_id"]);
          if (idx >= 0) rows[idx]!["status"] = "undo";
          const newId = `ku-${rows.length + 1}`;
          rows.unshift({
            id: newId,
            site_id: (rows[idx]?.["site_id"] ?? site.id) as string,
            from_version: "2.9.0",
            to_version: "2.8.0",
            commit_sha: commitSha,
            commit_url: `https://github.com/${site.repo_owner}/${site.repo_name}/commit/${commitSha}`,
            previous_commit_sha: "e11e11e1",
            requested_by: STAFF_ID,
            status: "undo_pushed",
            status_detail: "Undo",
            live_checked_at: null,
            live_version_seen: null,
            attempts: 0,
            needs_attention_reason: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
          return json(route, { ok: true, commit: { sha: commitSha, url: `https://github.com/${site.repo_owner}/${site.repo_name}/commit/${commitSha}` }, restored_version: "2.8.0", update_id: newId });
        }
        default:
          return json(route, { ok: false, code: "not_found", message: `No mock for ${name}` }, 404);
      }
    }

    return json(route, {}, 404);
  });

  return state;
}

/** Form entries for the mocked site, newest first: two unread, one read. */
export function sampleSubmissions(): Record<string, unknown>[] {
  const at = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  return [
    { id: "aaaa0001-0000-4000-8000-000000000001", site_id: SITE_ID, page_slug: "contact", element_id: "form0001", form_name: "Contact form", data: { name: "Priya Natarajan", email: "priya@example.com", phone: "0161 555 0199", message: "We are planning a two-storey extension in Didsbury and would love a quote." }, email_status: "sent", read_at: null, created_at: at(2) },
    { id: "aaaa0001-0000-4000-8000-000000000002", site_id: SITE_ID, page_slug: "home", element_id: "form0002", form_name: null, data: { "Your name": "Tom Okafor", "E-mail": "tom.okafor@example.com", "How can we help": "Do you build in Placer County?" }, email_status: "skipped", read_at: null, created_at: at(30) },
    { id: "aaaa0001-0000-4000-8000-000000000003", site_id: SITE_ID, page_slug: "contact", element_id: "form0001", form_name: "Contact form", data: { name: "Lena Fischer", email: "lena@example.com", message: "Thanks for the site visit last week. Sending the plans over now." }, email_status: "sent", read_at: at(50), created_at: at(72) },
  ];
}

export const editorUrl = (slug?: string) => `/sites/${SITE_ID}/visual${slug ? `?page=${slug}` : ""}`;

/** A live site on another origin that has no bridge at all, served from the test itself. */
export const PLAIN_SITE_URL = "http://plain.localhost:5199";
export async function servePlainSite(page: Page): Promise<void> {
  await page.route(`${PLAIN_SITE_URL}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>A site without the bridge</title></head><body style="font-family: system-ui; padding: 40px"><h1>A plain page</h1><p>This page does not include the Armature bridge.</p></body></html>`,
    }),
  );
}
