/**
 * /invite/:token — outside the AppShell and outside RequireAuth, because the
 * person may not have an account yet. Once they are signed in the invite is
 * redeemed exactly once per account, and every outcome — including a wrong-email
 * refusal — is spelled out with a way forward.
 */
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import type { InviteAcceptResponse } from "@shared/publishTypes.ts";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { AuthForm, AuthPageFrame, UnusableLinkNotice } from "@/components/AuthForm.tsx";
import { Button, LinkButton, Notice, Spinner } from "@/components/ui.tsx";
import { callFunction, type Failure } from "@/lib/functions.ts";

export function InviteAccept() {
  const { token = "" } = useParams();
  const { loading, session, user, refresh, signOut } = useAuth();
  const userId = user?.id ?? null;
  const startedFor = useRef<string | null>(null);
  // An emailed sign-in link lands here as /invite/:token?code=... . Supabase strips the code
  // only when the exchange succeeds and reports nothing when it fails, so a code that is
  // still there once loading has finished, with no session, means the link did not work.
  const [openedFromLink, setOpenedFromLink] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("code"),
  );

  const accept = useMutation<InviteAcceptResponse | Failure, Error, string>({
    mutationFn: async (inviteToken) => {
      const result = await callFunction<InviteAcceptResponse>("invite-accept", { token: inviteToken });
      // Reload memberships so the site (or Projects) is visible as soon as the person continues.
      if (result.ok) await refresh();
      return result;
    },
  });
  const { mutate, reset } = accept;

  useEffect(() => {
    if (loading || !userId || !token) return;
    if (startedFor.current === userId) return;
    startedFor.current = userId;
    mutate(token);
  }, [loading, userId, token, mutate]);

  function switchAccount() {
    startedFor.current = null;
    setOpenedFromLink(false);
    reset();
    void signOut();
  }

  let body: ReactNode;
  if (!token) {
    body = (
      <Notice kind="danger" title="This invite link is incomplete">
        The link is missing its token. Open the full link from your invite, or ask the agency to send a new one.
      </Notice>
    );
  } else if (loading) {
    body = <Spinner label="Checking your account" />;
  } else if (!session) {
    body = (
      <>
        {openedFromLink && <UnusableLinkNotice />}
        <AuthForm mode="invite" redirectPath={`/invite/${token}`} />
      </>
    );
  } else if (accept.status === "idle" || accept.status === "pending") {
    body = <Spinner label="Accepting your invite" />;
  } else if (accept.status === "error") {
    body = (
      <Notice kind="danger" title="Your invite could not be accepted">
        {accept.error.message}
      </Notice>
    );
  } else if (accept.data.ok) {
    const { site_id } = accept.data;
    body = (
      <Notice
        kind="success"
        title="You now have access"
        action={site_id ? <LinkButton to={`/sites/${site_id}`}>Open your site</LinkButton> : <LinkButton to="/projects">Go to Projects</LinkButton>}
      >
        {site_id
          ? "You can now edit this site's pages and send change requests from your dashboard."
          : "You are now part of the agency team and can see every site under Projects."}
      </Notice>
    );
  } else {
    const failure = accept.data;
    body = (
      <Notice
        kind="danger"
        title="Your invite could not be accepted"
        action={
          failure.code === "forbidden" ? (
            <Button variant="secondary" onClick={switchAccount}>
              Sign out and use a different email
            </Button>
          ) : undefined
        }
      >
        {failure.message}
      </Notice>
    );
  }

  return (
    <AuthPageFrame
      title="You've been invited"
      subtitle="Sign in or create an account with the email address this invite was sent to, and you'll be added automatically."
    >
      <div className="space-y-5">
        {session?.user.email && (
          <p className="text-sm text-muted">
            Signed in as <span className="font-medium text-text">{session.user.email}</span>
          </p>
        )}
        {body}
        <div className="border-t border-line pt-4">
          <LinkButton to="/" variant="secondary">
            Go to the dashboard
          </LinkButton>
        </div>
      </div>
    </AuthPageFrame>
  );
}
