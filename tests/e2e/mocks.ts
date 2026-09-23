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
export const DEMO_SITE_URL = "http://localhost:5174";
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
  };

  const state: MockState = { publishRequests: [], builderPublishRequests: [], contentGets: 0, rows: JSON.parse(JSON.stringify(options.rows ?? {})) as MockState["rows"] };
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
          if (!url.searchParams.has("site_id")) return json(route, role === "client" ? [{ role: "client_owner", site }] : []);
          const rows = (state.rows["site_members"] ??= [{ site_id: SITE_ID, user_id: CLIENT_ID, role: "client_owner", created_at: "2026-09-02T09:00:00Z" }]);
          const matches = (row: Record<string, unknown>) => [...url.searchParams].every(([column, filter]) => !filter.startsWith("eq.") || String(row[column]) === filter.slice(3));
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
          return json(route, [{ id: STAFF_ID, email: "dana@agency.example", full_name: "Dana Whitfield", created_at: "2026-09-01T00:00:00Z", last_sign_in_at: new Date(Date.now() - 3600_000).toISOString() }, { id: CLIENT_ID, email: "sam@alderstone.example", full_name: "Sam Alder", created_at: "2026-09-02T00:00:00Z", last_sign_in_at: "2026-09-20T15:00:00Z" }]);
        case "sites":
          if (wantsCount) return countOf(1);
          if (request.method() === "PATCH") {
            const patch = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
            (state.rows["sites"] ??= []).push(patch);
            Object.assign(site, patch);
          }
          return json(route, [site]);
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
        default:
          return json(route, []);
      }
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
        case "site-embed-check":
          return json(route, { ok: true, url: site.live_url, ...(options.embed ?? { reachable: true, status: 200, xFrameOptions: null, frameAncestors: null }) });
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
