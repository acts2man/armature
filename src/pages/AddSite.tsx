/**
 * Add a site, two ways: connect a GitHub repository (link the App, name the
 * repository, read the checklist), or add a hosting-only client (a name and a
 * live URL) whose repository can be connected later. With ?upgrade=<site id>
 * the repository path connects a repository to that hosting-only site in place.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { CheckList } from "@/components/CheckList.tsx";
import { IconGithub, IconGlobe, IconRefresh } from "@/components/icons.tsx";
import { Button, Field, Input, LinkButton, Notice, PageHeader, Panel, Pill, Segmented, Select, Skeleton, SrOnly } from "@/components/ui.tsx";
import { callFunction } from "@/lib/functions.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Site } from "@/lib/types.ts";
import type { GithubSetupResponse, SiteConnectRequest, SiteConnectResponse } from "@shared/publishTypes.ts";

type InstallationsResponse = Extract<GithubSetupResponse, { action: "list_installations" }>;
type InstallUrlResponse = Extract<GithubSetupResponse, { action: "install_url" }>;

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

type ParsedRepo = { owner: string; name: string };

/**
 * Accepts "owner/name", "https://github.com/owner/name", a deeper GitHub URL such
 * as ".../owner/name/tree/main", or "git@github.com:owner/name.git".
 */
function parseRepo(raw: string): ParsedRepo | null {
  let path = raw.trim();
  if (!path) return null;
  const https = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(path);
  const ssh = /^git@github\.com:(.+)$/i.exec(path);
  if (https) path = https[1] ?? "";
  else if (ssh) path = ssh[1] ?? "";
  const parts = path.split("/").filter((part) => part.length > 0);
  const owner = parts[0];
  const name = parts[1]?.replace(/\.git$/, "");
  if (!owner || !name || !NAME_PATTERN.test(owner) || !NAME_PATTERN.test(name)) return null;
  return { owner, name };
}

type FormState = { repo: string; branch: string; name: string; liveUrl: string };
type FormErrors = Partial<Record<keyof FormState, string>>;

const EMPTY_FORM: FormState = { repo: "", branch: "main", name: "", liveUrl: "" };

function StepTitle({ number, children }: { number: number; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-soft text-[12px] font-bold text-blue">
        {number}
      </span>
      <span>
        <SrOnly>Step {number}: </SrOnly>
        {children}
      </span>
    </span>
  );
}

// --- hosting-only ------------------------------------------------------------------------------

function HostingOnlyForm({ agencyId }: { agencyId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async (input: { name: string; liveUrl: string | null }) => {
      const { data, error: insertError } = await supabase
        .from("sites")
        .insert({ agency_id: agencyId, name: input.name, live_url: input.liveUrl, status: "hosting_only" })
        .select("id")
        .single();
      if (insertError) throw new Error(insertError.message);
      return (data as { id: string }).id;
    },
    onSuccess: async (siteId) => {
      await queryClient.invalidateQueries({ queryKey: ["fleet"] });
      navigate(`/sites/${siteId}`);
    },
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanUrl = liveUrl.trim();
    if (!cleanName) {
      setError("Enter the client's site name.");
      return;
    }
    if (cleanName.length > 120) {
      setError("The name is too long (120 characters at most).");
      return;
    }
    if (cleanUrl && !/^https:\/\//.test(cleanUrl)) {
      setError("The live URL must start with https://");
      return;
    }
    setError(null);
    create.mutate({ name: cleanName, liveUrl: cleanUrl || null });
  }

  return (
    <Panel title="Add a hosting-only client">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 p-4 sm:p-5">
        <p className="text-[14px] leading-relaxed text-muted">
          For a client you host, register a domain for or run email for, but whose site is not edited here yet. You can record what you charge them straight away and connect the repository
          later.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Site name" htmlFor="hosting-only-name" hint="Shown to you and, later, to the client.">
            <Input id="hosting-only-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} disabled={create.isPending} />
          </Field>
          <Field label="Live URL" htmlFor="hosting-only-url" hint="Where the site can be seen. Must start with https://">
            <Input id="hosting-only-url" type="url" inputMode="url" placeholder="https://www.example.com" value={liveUrl} onChange={(event) => setLiveUrl(event.target.value)} disabled={create.isPending} />
          </Field>
        </div>
        {error && (
          <Notice kind="danger" title="Check the form">
            {error}
          </Notice>
        )}
        {create.isError && (
          <Notice kind="danger" title="The site could not be added">
            {create.error.message}
          </Notice>
        )}
        <div>
          <Button type="submit" loading={create.isPending}>
            <IconGlobe size={16} /> Add client
          </Button>
        </div>
      </form>
    </Panel>
  );
}

// --- connect a repository -----------------------------------------------------------------------

function ConnectRepository({ agencyId, agencies, upgrade, onAgencyChange }: { agencyId: string; agencies: { id: string; name: string }[]; upgrade: Site | null; onAgencyChange: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(() => (upgrade ? { ...EMPTY_FORM, name: upgrade.name, liveUrl: upgrade.live_url ?? "" } : EMPTY_FORM));
  const [errors, setErrors] = useState<FormErrors>({});

  const installations = useQuery({
    queryKey: ["github-installations", agencyId],
    enabled: agencyId.length > 0,
    retry: false,
    queryFn: async () => {
      const result = await callFunction<InstallationsResponse>("github-setup", { action: "list_installations", agency_id: agencyId });
      if (!result.ok) throw new Error(result.message);
      return result.installations;
    },
  });

  const install = useMutation({
    mutationFn: async () => {
      const result = await callFunction<InstallUrlResponse>("github-setup", { action: "install_url", agency_id: agencyId });
      if (!result.ok) throw new Error(result.message);
      window.location.assign(result.url);
    },
  });

  const connect = useMutation({
    mutationFn: async (request: SiteConnectRequest) => {
      const result = await callFunction<SiteConnectResponse>("site-connect", request);
      if (!result.ok) throw new Error(result.message);
      return result;
    },
    onSuccess: (result) => {
      if (result.site) {
        void queryClient.invalidateQueries({ queryKey: ["fleet"] });
        void queryClient.invalidateQueries({ queryKey: ["site", result.site.id] });
      }
    },
  });

  const parsed = parseRepo(form.repo);

  const update = (key: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setForm((previous) => ({ ...previous, [key]: value }));
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: FormErrors = {};
    const repo = parseRepo(form.repo);
    if (!repo) next.repo = form.repo.trim() ? 'Enter the repository as "owner/name", or paste its GitHub URL.' : "Enter the repository.";
    const branch = form.branch.trim();
    if (!branch) next.branch = "Enter the branch the site is built from.";
    const liveUrl = form.liveUrl.trim();
    if (liveUrl && !liveUrl.startsWith("https://")) next.liveUrl = "The live URL must start with https://";
    setErrors(next);
    if (!repo || Object.keys(next).length > 0) return;

    connect.mutate({
      agency_id: agencyId,
      repo_owner: repo.owner,
      repo_name: repo.name,
      branch,
      name: form.name.trim() || repo.name,
      ...(liveUrl ? { live_url: liveUrl } : {}),
      ...(upgrade ? { site_id: upgrade.id } : {}),
    });
  }

  function startAgain() {
    setForm(EMPTY_FORM);
    setErrors({});
    connect.reset();
  }

  let installationsBlock: ReactNode;
  if (installations.isPending) {
    installationsBlock = <Skeleton className="w-56" />;
  } else if (installations.isError) {
    installationsBlock = (
      <Notice kind="danger" title="Linked GitHub accounts could not be loaded">
        {installations.error.message}
      </Notice>
    );
  } else if (installations.data.length === 0) {
    installationsBlock = <p className="text-[14px] text-text">No GitHub account linked yet.</p>;
  } else {
    installationsBlock = (
      <div>
        <p className="text-[13px] font-semibold text-text">Linked GitHub accounts</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {installations.data.map((installation) => (
            <li key={installation.installation_id} className="inline-flex h-9 items-center gap-2 rounded-control border border-line bg-ground px-3 text-[13px]">
              <IconGithub size={16} />
              <span className="font-mono text-text">{installation.account_login}</span>
              <Pill tone="grey">{installation.account_type}</Pill>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  let resultBlock: ReactNode;
  if (connect.isPending) {
    resultBlock = (
      <div className="space-y-3" role="status" aria-label="Checking the repository">
        <Skeleton className="w-64" />
        <Skeleton lines={4} />
      </div>
    );
  } else if (connect.isError) {
    resultBlock = (
      <Notice kind="danger" title="The check could not run">
        {connect.error.message}
      </Notice>
    );
  } else if (connect.data) {
    const data = connect.data;
    resultBlock = (
      <div className="flex flex-col gap-4">
        {data.site ? (
          <Notice
            kind="success"
            title={upgrade ? `${data.site.name} now has its repository connected` : `${data.site.name} is connected`}
            action={
              <>
                <LinkButton to={`/sites/${data.site.id}`} size="sm">
                  Open the site
                </LinkButton>
                {!upgrade && (
                  <Button variant="secondary" size="sm" onClick={startAgain}>
                    Add another
                  </Button>
                )}
              </>
            }
          >
            {upgrade ? "Pages can be edited and published from here on." : "The site is ready to edit. Add the client from its Team tab."}
          </Notice>
        ) : data.allPassed ? (
          <Notice kind="warning" title="Every check passed, but the site was not saved">
            Press "Check and connect" again. If this keeps happening, the site-connect function is not returning the site.
          </Notice>
        ) : (
          <Notice kind="warning" title="Fix the red items, then check again">
            Your entries are kept above, so change only what the checklist points at and press "Check and connect" again.
          </Notice>
        )}
        <CheckList report={{ allPassed: data.allPassed, checks: data.checks }} title="Repository check" />
      </div>
    );
  } else {
    resultBlock = <p className="text-[13px] text-muted">Press "Check and connect" above and the checklist will appear here.</p>;
  }

  return (
    <>
      <Panel title={<StepTitle number={1}>Connect GitHub</StepTitle>}>
        <div className="flex flex-col gap-4 p-4 sm:p-5">
          <p className="text-[14px] leading-relaxed text-muted">
            Install the GitHub App on the account or organisation that owns the site's repository and choose that repository. GitHub brings you back here when it is done.
          </p>
          {installationsBlock}
          {install.isError && (
            <Notice kind="danger" title="The install link could not be created">
              {install.error.message}
            </Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => install.mutate()} loading={install.isPending}>
              <IconGithub size={16} /> Install the GitHub App
            </Button>
            <Button variant="secondary" onClick={() => void installations.refetch()} loading={installations.isFetching && !installations.isPending}>
              <IconRefresh size={16} /> Refresh list
            </Button>
          </div>
          <p className="text-[13px] text-muted">Already installed? Open the App on GitHub and press Configure. It brings you back here too.</p>
        </div>
      </Panel>

      <Panel title={<StepTitle number={2}>Which repository?</StepTitle>}>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 p-4 sm:p-5">
          {agencies.length > 1 && !upgrade && (
            <Field label="Agency" htmlFor="add-site-agency" hint="The agency this site belongs to.">
              <Select id="add-site-agency" value={agencyId} onChange={(event) => onAgencyChange(event.target.value)}>
                {agencies.map((agency) => (
                  <option key={agency.id} value={agency.id}>
                    {agency.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field
            label="Repository"
            htmlFor="add-site-repo"
            error={errors.repo ?? null}
            hint={
              parsed ? (
                <>
                  Owner <span className="font-mono text-text">{parsed.owner}</span>, repository <span className="font-mono text-text">{parsed.name}</span>
                </>
              ) : (
                'Either "owner/name" or the repository\'s GitHub URL.'
              )
            }
          >
            <Input id="add-site-repo" value={form.repo} onChange={update("repo")} placeholder="acme/acme-site or https://github.com/acme/acme-site" autoComplete="off" spellCheck={false} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Branch" htmlFor="add-site-branch" error={errors.branch ?? null} hint="The branch the live site is built from.">
              <Input id="add-site-branch" value={form.branch} onChange={update("branch")} autoComplete="off" spellCheck={false} required className="font-mono" />
            </Field>
            <Field label="Site name" htmlFor="add-site-name" hint={upgrade ? "Leave as it is to keep the current name." : `Shown to the client. Leave blank to use "${parsed?.name ?? "the repository name"}".`}>
              <Input id="add-site-name" value={form.name} onChange={update("name")} placeholder={parsed?.name ?? ""} />
            </Field>
          </div>
          <Field label="Live URL (optional)" htmlFor="add-site-live-url" error={errors.liveUrl ?? null} hint="Where the published site can be seen. Must start with https://">
            <Input id="add-site-live-url" type="url" inputMode="url" value={form.liveUrl} onChange={update("liveUrl")} placeholder="https://www.example.com" />
          </Field>
          <div>
            <Button type="submit" loading={connect.isPending}>
              Check and connect
            </Button>
          </div>
        </form>
      </Panel>

      <Panel title={<StepTitle number={3}>Result</StepTitle>}>
        <div className="p-4 sm:p-5">{resultBlock}</div>
      </Panel>
    </>
  );
}

// --- the page ---------------------------------------------------------------------------------------

export function AddSite() {
  const { agencies } = useAuth();
  const [params] = useSearchParams();
  const upgradeId = params.get("upgrade") ?? "";
  const [agencyId, setAgencyId] = useState(() => agencies[0]?.agency.id ?? "");
  const [mode, setMode] = useState<"repo" | "hosting">("repo");

  const upgrade = useQuery({
    queryKey: ["site", upgradeId],
    enabled: upgradeId.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("sites").select("*").eq("id", upgradeId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Site | null) ?? null;
    },
  });

  if (agencies.length === 0) {
    return (
      <Notice kind="warning" title="Your account is not staff of any agency">
        Only agency staff can add sites. Ask the agency owner to invite you.
      </Notice>
    );
  }

  const agencyOptions = agencies.map((membership) => ({ id: membership.agency.id, name: membership.agency.name }));

  if (upgradeId) {
    if (upgrade.isPending) {
      return (
        <div className="space-y-4" role="status" aria-label="Loading the site">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      );
    }
    const site = upgrade.data ?? null;
    if (upgrade.isError || !site) {
      return (
        <Notice kind="warning" title="That site could not be found" action={<LinkButton to="/fleet" variant="secondary" size="sm">Back to Fleet</LinkButton>}>
          {upgrade.isError ? upgrade.error.message : "It may have been removed, or it belongs to another agency."}
        </Notice>
      );
    }
    if (site.status !== "hosting_only") {
      return (
        <Notice kind="info" title={`${site.name} already has a repository connected`} action={<LinkButton to={`/sites/${site.id}`} size="sm">Open the site</LinkButton>} />
      );
    }
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={`Connect a repository to ${site.name}`} description="Same checks as for a new site. When every line passes, the site keeps its name, services and members and gains pages." />
        <ConnectRepository key={site.id} agencyId={site.agency_id} agencies={agencyOptions} upgrade={site} onAgencyChange={() => undefined} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Add a site"
        description="Connect a site's GitHub repository so its pages can be edited here, or add a client you only host."
        action={
          <Segmented
            label="How to add the site"
            value={mode}
            onChange={setMode}
            options={[
              { value: "repo", label: "Connect a repository" },
              { value: "hosting", label: "Add a hosting-only client" },
            ]}
          />
        }
      />
      {mode === "hosting" ? (
        <>
          {agencies.length > 1 && (
            <Field label="Agency" htmlFor="hosting-only-agency" className="max-w-sm">
              <Select id="hosting-only-agency" value={agencyId} onChange={(event) => setAgencyId(event.target.value)}>
                {agencyOptions.map((agency) => (
                  <option key={agency.id} value={agency.id}>
                    {agency.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <HostingOnlyForm agencyId={agencyId} />
        </>
      ) : (
        <ConnectRepository agencyId={agencyId} agencies={agencyOptions} upgrade={null} onAgencyChange={setAgencyId} />
      )}
    </div>
  );
}
