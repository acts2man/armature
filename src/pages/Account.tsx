/**
 * /account — "Settings" in the client sidebar: who you are signed in as, which
 * sites you can edit, and how to change your password. Reads only what the
 * dashboard already knows; nothing new is stored.
 */
import { useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconLogout } from "@/components/icons.tsx";
import { Button, LinkButton, Monogram, PageHeader, Panel, PanelRow, Pill } from "@/components/ui.tsx";
import { SITE_ROLE_LABELS } from "@/lib/types.ts";

export function Account() {
  const { user, sites, agency, isStaff, signOut } = useAuth();
  const navigate = useNavigate();
  const email = user?.email ?? "";
  const fullName = typeof user?.user_metadata?.["full_name"] === "string" ? (user.user_metadata["full_name"] as string) : "";
  const portal = agency?.portal_name?.trim() || "your editing dashboard";

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Settings" description={`Your account on ${portal}.`} />

      <Panel title="Your account">
        <PanelRow
          icon={<Monogram name={fullName || email} size="md" />}
          title={fullName || email}
          detail={fullName ? email : undefined}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void signOut().then(() => navigate("/signin", { replace: true }));
              }}
            >
              <IconLogout size={16} /> Sign out
            </Button>
          }
        />
        <PanelRow
          title="Password"
          detail='To change it, sign out and use "Forgot your password?" on the sign-in page. A reset link is emailed to you.'
        />
      </Panel>

      {!isStaff && (
        <Panel title="Sites you can edit">
          {sites.length === 0 ? (
            <div className="px-5 py-4 text-[13px] text-muted">No sites yet. {portal} adds you to a site when it is ready.</div>
          ) : (
            sites.map(({ site, role }) => (
              <PanelRow
                key={site.id}
                icon={<Monogram name={site.name} size="md" />}
                title={site.name}
                detail={site.live_url ? site.live_url.replace(/^https?:\/\//, "") : undefined}
                action={
                  <>
                    <Pill tone="grey">{SITE_ROLE_LABELS[role]}</Pill>
                    <LinkButton to={`/sites/${site.id}`} variant="secondary" size="sm">
                      Open
                    </LinkButton>
                  </>
                }
              />
            ))
          )}
        </Panel>
      )}
    </div>
  );
}
