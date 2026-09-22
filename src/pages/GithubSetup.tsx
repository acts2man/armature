/**
 * /github/setup — where GitHub sends agency staff back after they install the
 * App. The query string carries installation_id, setup_action and state (the
 * agency id we sent along). The installation is recorded once, and the outcome
 * always points to the next step.
 */
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import type { GithubSetupResponse } from "@shared/publishTypes.ts";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { LinkButton, Notice, PageHeader, Skeleton } from "@/components/ui.tsx";
import { callFunction } from "@/lib/functions.ts";

const addSiteLink = (label: string) => <LinkButton to="/sites/new">{label}</LinkButton>;

function SetupOutcome({ agencyId, installationId }: { agencyId: string; installationId: string }) {
  const link = useQuery({
    queryKey: ["github-setup", "record_installation", agencyId, installationId],
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () =>
      callFunction<GithubSetupResponse>("github-setup", {
        action: "record_installation",
        agency_id: agencyId,
        installation_id: Number(installationId),
      }),
  });

  if (link.isPending) {
    return (
      <div className="space-y-3" role="status" aria-label="Linking your GitHub installation">
        <Skeleton className="w-64" />
        <Skeleton lines={2} />
      </div>
    );
  }
  if (link.isError) {
    return (
      <Notice kind="danger" title="The installation could not be linked" action={addSiteLink("Back to Add a site")}>
        {link.error.message}
      </Notice>
    );
  }
  const result = link.data;
  if (!result.ok) {
    return (
      <Notice kind="danger" title="The installation could not be linked" action={addSiteLink("Back to Add a site")}>
        {result.message}
      </Notice>
    );
  }
  if (result.action !== "record_installation") {
    return (
      <Notice kind="danger" title="The installation could not be linked" action={addSiteLink("Back to Add a site")}>
        {`The "github-setup" function answered with "${result.action}" instead of confirming the installation.`}
      </Notice>
    );
  }
  const { account_login, account_type } = result.installation;
  return (
    <Notice kind="success" title={`GitHub account ${account_login} is linked`} action={addSiteLink("Add a site")}>
      {`Repositories owned by ${account_login} (${account_type.toLowerCase()}) can now be connected as sites.`}
    </Notice>
  );
}

export function GithubSetup() {
  const [params] = useSearchParams();
  const { agencies } = useAuth();
  const installationId = params.get("installation_id")?.trim() ?? "";
  const setupAction = params.get("setup_action") ?? "";
  const state = params.get("state") ?? "";
  const agency = (agencies.find((membership) => membership.agency.id === state) ?? agencies[0])?.agency ?? null;

  let content;
  if (!agency) {
    content = (
      <Notice
        kind="warning"
        title="Only agency staff can link a GitHub installation"
        action={
          <LinkButton to="/" variant="secondary">
            Go home
          </LinkButton>
        }
      >
        Your account is not a member of any agency, so there is nothing to link this installation to. If you edit a site as a client, you do not need this step.
      </Notice>
    );
  } else if (!installationId) {
    content = (
      <Notice kind="warning" title="GitHub did not send back an installation id. Start again from Fleet → Add a site." action={addSiteLink("Add a site")}>
        {setupAction === "request"
          ? "GitHub reports that the installation was requested and is waiting for an owner of your GitHub organisation to approve it. Once they have, start again from Add a site."
          : "This can happen when the page is opened directly rather than from GitHub's redirect."}
      </Notice>
    );
  } else {
    content = <SetupOutcome agencyId={agency.id} installationId={installationId} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="GitHub setup"
        eyebrow={agency ? agency.name : undefined}
        description="Linking the GitHub App installation to your agency so its repositories can be connected as sites."
      />
      {content}
    </div>
  );
}
