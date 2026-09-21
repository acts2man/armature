/**
 * Add a site — three numbered steps on one page: link the GitHub App, name the
 * repository, and read the checklist. When every check passes the site exists.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { CheckList } from "@/components/CheckList.tsx";
import { Button, Card, Field, Input, LinkButton, Notice, PageHeader, Pill, Select, Spinner, SrOnly } from "@/components/ui.tsx";
import { callFunction } from "@/lib/functions.ts";
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

function SectionHeading({ number, id, children }: { number: number; id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="flex items-center gap-3 text-lg font-semibold text-ink">
      <span
        aria-hidden="true"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
      >
        {number}
      </span>
      <span>
        <SrOnly>Step {number}: </SrOnly>
        {children}
      </span>
    </h2>
  );
}

export function AddSite() {
  const { agencies } = useAuth();
  const queryClient = useQueryClient();
  const [agencyId, setAgencyId] = useState(() => agencies[0]?.agency.id ?? "");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});

  const installations = useQuery({
    queryKey: ["github-installations", agencyId],
    enabled: agencyId.length > 0,
    retry: false,
    queryFn: async () => {
      const result = await callFunction<InstallationsResponse>("github-setup", {
        action: "list_installations",
        agency_id: agencyId,
      });
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
      if (result.site) void queryClient.invalidateQueries({ queryKey: ["fleet"] });
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
    if (!repo) {
      next.repo = form.repo.trim()
        ? 'Enter the repository as "owner/name", or paste its GitHub URL.'
        : "Enter the repository.";
    }
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
    });
  }

  function startAgain() {
    setForm(EMPTY_FORM);
    setErrors({});
    connect.reset();
  }

  if (agencies.length === 0) {
    return (
      <Notice kind="warning" title="Your account is not staff of any agency">
        Only agency staff can add sites. Ask the agency owner to invite you.
      </Notice>
    );
  }

  let installationsBlock: ReactNode;
  if (installations.isPending) {
    installationsBlock = <Spinner label="Checking linked GitHub accounts" />;
  } else if (installations.isError) {
    installationsBlock = (
      <Notice kind="danger" title="Linked GitHub accounts could not be loaded">
        {installations.error.message}
      </Notice>
    );
  } else if (installations.data.length === 0) {
    installationsBlock = <p className="text-[15px] text-text">No GitHub account linked yet.</p>;
  } else {
    installationsBlock = (
      <div>
        <p className="text-sm font-medium text-text">Linked GitHub accounts</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {installations.data.map((installation) => (
            <li
              key={installation.installation_id}
              className="inline-flex items-center gap-2 rounded-lg border border-line bg-ground px-3 py-2 text-sm"
            >
              <span className="font-mono text-text">{installation.account_login}</span>
              <Pill>{installation.account_type}</Pill>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  let resultBlock: ReactNode;
  if (connect.isPending) {
    resultBlock = <Spinner label="Checking the repository" />;
  } else if (connect.isError) {
    resultBlock = (
      <Notice kind="danger" title="The check could not run">
        {connect.error.message}
      </Notice>
    );
  } else if (connect.data) {
    const data = connect.data;
    resultBlock = (
      <>
        {data.site ? (
          <Notice
            kind="success"
            title={`${data.site.name} is connected`}
            action={
              <>
                <LinkButton to={`/sites/${data.site.id}`}>Open the site</LinkButton>
                <Button variant="secondary" onClick={startAgain}>
                  Add another
                </Button>
              </>
            }
          >
            The site is ready to edit. Invite the client from its Team tab.
          </Notice>
        ) : data.allPassed ? (
          <Notice kind="warning" title="Every check passed, but the site was not saved">
            Press "Check and connect" again. If this keeps happening, the site-connect function is not returning the new site.
          </Notice>
        ) : (
          <Notice kind="warning" title="Fix the red items, then check again">
            Your entries are kept above, so change only what the checklist points at and press "Check and connect" again.
          </Notice>
        )}
        <CheckList
          report={{ allPassed: data.allPassed, checks: data.checks }}
          title={data.allPassed ? "Repository check: everything passed" : "Repository check: something needs fixing"}
        />
      </>
    );
  } else {
    resultBlock = <p className="text-sm text-muted">Press "Check and connect" above and the checklist will appear here.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Add a site" description="Connect a site's GitHub repository so its pages can be edited here." />

      <section aria-labelledby="add-site-step-1">
        <Card>
          <SectionHeading number={1} id="add-site-step-1">
            Connect GitHub
          </SectionHeading>
          <p className="mt-2 text-[15px] text-muted">
            Install the GitHub App on the account or organisation that owns the site's repository and choose that
            repository. GitHub will bring you back here when it is done.
          </p>
          <div className="mt-4">{installationsBlock}</div>
          {install.isError && (
            <Notice kind="danger" title="The install link could not be created" className="mt-4">
              {install.error.message}
            </Notice>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => install.mutate()} loading={install.isPending}>
              Install the GitHub App
            </Button>
            <Button
              variant="secondary"
              onClick={() => void installations.refetch()}
              loading={installations.isFetching && !installations.isPending}
            >
              Refresh list
            </Button>
          </div>
          <p className="mt-3 text-sm text-muted">
            Already installed? Open the App on GitHub and press Configure — it brings you back here too.
          </p>
        </Card>
      </section>

      <section aria-labelledby="add-site-step-2">
        <Card>
          <SectionHeading number={2} id="add-site-step-2">
            Which repository?
          </SectionHeading>
          <form onSubmit={onSubmit} noValidate className="mt-4 space-y-4">
            {agencies.length > 1 && (
              <Field label="Agency" htmlFor="add-site-agency" hint="The agency this site belongs to.">
                <Select id="add-site-agency" value={agencyId} onChange={(event) => setAgencyId(event.target.value)}>
                  {agencies.map((membership) => (
                    <option key={membership.agency.id} value={membership.agency.id}>
                      {membership.agency.name}
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
                    Owner <span className="font-mono text-text">{parsed.owner}</span>, repository{" "}
                    <span className="font-mono text-text">{parsed.name}</span>
                  </>
                ) : (
                  'Either "owner/name" or the repository\'s GitHub URL.'
                )
              }
            >
              <Input
                id="add-site-repo"
                value={form.repo}
                onChange={update("repo")}
                placeholder="acme/acme-site or https://github.com/acme/acme-site"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Branch" htmlFor="add-site-branch" error={errors.branch ?? null} hint="The branch the live site is built from.">
                <Input id="add-site-branch" value={form.branch} onChange={update("branch")} autoComplete="off" spellCheck={false} required />
              </Field>
              <Field
                label="Site name"
                htmlFor="add-site-name"
                hint={`Shown to the client. Leave blank to use "${parsed?.name ?? "the repository name"}".`}
              >
                <Input id="add-site-name" value={form.name} onChange={update("name")} placeholder={parsed?.name ?? ""} />
              </Field>
            </div>
            <Field
              label="Live URL (optional)"
              htmlFor="add-site-live-url"
              error={errors.liveUrl ?? null}
              hint="Where the published site can be seen. Must start with https://"
            >
              <Input
                id="add-site-live-url"
                type="url"
                inputMode="url"
                value={form.liveUrl}
                onChange={update("liveUrl")}
                placeholder="https://www.example.com"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={connect.isPending}>
                Check and connect
              </Button>
            </div>
          </form>
        </Card>
      </section>

      <section aria-labelledby="add-site-step-3">
        <Card>
          <SectionHeading number={3} id="add-site-step-3">
            Result
          </SectionHeading>
          <div className="mt-4 space-y-4">{resultBlock}</div>
        </Card>
      </section>
    </div>
  );
}
