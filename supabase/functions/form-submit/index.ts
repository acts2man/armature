/**
 * form-submit — where a site's Form widget sends an entry. Public: visitors are not
 * signed in, so this runs with the service role and trusts nothing it is sent. The
 * form's fields come from the page as published in the site's repository (never from
 * the request); the entry is validated against them, rate limited per visitor and per
 * site, stored in form_submissions and emailed through Resend when the agency set a
 * sender and recipients. The visitor's IP address is never stored, only a salted hash.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, the GitHub App settings, and
 * optionally RESEND_API_KEY and FORM_IP_SALT.
 */
import { adminClient } from "../_shared/auth.ts";
import { denoEnv, envValue } from "../_shared/env.ts";
import { ArmatureError } from "../_shared/errors.ts";
import { handleFormSubmit, hashIp, parseFormInput, type FormDeps, type FormSite } from "../_shared/formSubmit.ts";
import { loadAppConfig, mintInstallationToken } from "../_shared/githubApp.ts";
import { createGithubContentRepo } from "../_shared/githubRepo.ts";
import { readJsonBody, serveJson } from "../_shared/http.ts";

/** Published layouts, cached for a minute per site and page so a busy form does not hammer GitHub. */
const layoutCache = new Map<string, { at: number; layout: unknown }>();
const CACHE_MS = 60_000;

type SiteRecord = { id: string; name: string; status: string; agency_id: string; repo_owner: string | null; repo_name: string | null; branch: string | null; github_installation_id: number | null };

Deno.serve(
  serveJson(async (req) => {
    const env = denoEnv();
    const body = await readJsonBody(req);
    const input = parseFormInput(body);
    const db = adminClient(env);
    const sites = new Map<string, SiteRecord>();

    const salt = envValue(env, "FORM_IP_SALT") || (await hashIp("armature-forms", envValue(env, "SUPABASE_SERVICE_ROLE_KEY")));
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
    const ipHash = await hashIp(ip, salt);
    const resendKey = envValue(env, "RESEND_API_KEY");

    const deps: FormDeps = {
      now: () => new Date(),
      site: async (id) => {
        const { data, error } = await db.from("sites").select("id, name, status, agency_id, repo_owner, repo_name, branch, github_installation_id").eq("id", id).maybeSingle();
        if (error) throw new ArmatureError("github_error", "The form could not be sent right now. Please try again in a moment.");
        if (!data) return null;
        const record = data as SiteRecord;
        sites.set(record.id, record);
        return { id: record.id, name: record.name, status: record.status, agencyId: record.agency_id } satisfies FormSite;
      },
      layout: async (site, page) => {
        const record = sites.get(site.id);
        if (!record?.repo_owner || !record.repo_name || !record.branch || record.github_installation_id === null) return null;
        const key = `${site.id}:${page}`;
        const cached = layoutCache.get(key);
        if (cached && Date.now() - cached.at < CACHE_MS) return cached.layout;
        const token = await mintInstallationToken(loadAppConfig(env), record.github_installation_id, record.repo_name);
        const repo = createGithubContentRepo({ token: token.token, repo: `${record.repo_owner}/${record.repo_name}`, branch: record.branch });
        let layout: unknown = null;
        try {
          const head = await repo.getBranchHead();
          layout = JSON.parse((await repo.readTextFile(`content/layouts/${page}.json`, head)).text);
        } catch {
          layout = null;
        }
        layoutCache.set(key, { at: Date.now(), layout });
        return layout;
      },
      countSince: async (filter, since) => {
        let query = db.from("form_submissions").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString());
        if (filter.ipHash) query = query.eq("ip_hash", filter.ipHash);
        if (filter.siteId) query = query.eq("site_id", filter.siteId);
        const { count, error } = await query;
        if (error) throw new ArmatureError("github_error", "The form could not be sent right now. Please try again in a moment.");
        return count ?? 0;
      },
      insert: async (entry) => {
        const { data, error } = await db
          .from("form_submissions")
          .insert({ site_id: entry.siteId, page_slug: entry.page, element_id: entry.elementId, form_name: entry.formName, data: entry.data, ip_hash: entry.ipHash, user_agent: entry.userAgent })
          .select("id")
          .single();
        if (error || !data) throw new ArmatureError("github_error", "The form could not be saved. Please try again in a moment.");
        return (data as { id: string }).id;
      },
      setEmailStatus: async (id, status) => {
        await db.from("form_submissions").update({ email_status: status }).eq("id", id);
      },
      delivery: async (siteId) => {
        const { data } = await db.from("site_services").select("form_recipients, transactional_from_address, transactional_email_provider").eq("site_id", siteId).maybeSingle();
        const row = data as { form_recipients?: string[]; transactional_from_address?: string | null; transactional_email_provider?: string | null } | null;
        if (!row || row.transactional_email_provider !== "resend") return { to: [], from: null };
        return { to: row.form_recipients ?? [], from: row.transactional_from_address ?? null };
      },
      send: resendKey
        ? async (mail) => {
            const response = await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
              body: JSON.stringify({ from: mail.from, to: mail.to, subject: mail.subject, text: mail.text, reply_to: mail.replyTo }),
            });
            return response.ok;
          }
        : undefined,
    };

    return await handleFormSubmit(input, { ipHash, userAgent: req.headers.get("user-agent") }, deps);
  }),
);
