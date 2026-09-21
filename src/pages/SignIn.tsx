/**
 * /signin — outside the AppShell. No agency is known before sign-in, so the page
 * is deliberately generic. It also hosts the "choose a new password" step that
 * password-reset emails land on.
 */
import { useEffect, useId, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { AuthForm, AuthPageFrame, UnusableLinkNotice } from "@/components/AuthForm.tsx";
import { Button, Field, Input, Notice, Spinner } from "@/components/ui.tsx";
import { missingSupabaseConfig, supabase, supabaseConfigured } from "@/lib/supabase.ts";

const SUBTITLE = "Editing dashboard";

/** Auth hints Supabase puts in the URL: the hash for implicit links, the query for PKCE ones. */
function readUrlHints(): { recovery: boolean; error: string | null; code: string | null } {
  if (typeof window === "undefined") return { recovery: false, error: null, code: null };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  return {
    recovery: hash.get("type") === "recovery" || query.get("type") === "recovery",
    error: hash.get("error_description") ?? query.get("error_description"),
    // The PKCE code from an emailed link. Supabase strips it only when the exchange
    // succeeds, and says nothing when it fails, so "code present but no session" is
    // the one signal that the link did not work.
    code: query.get("code"),
  };
}

// Read once at load, before the Supabase client strips the tokens from the URL. The
// first mount of the page consumes the hints so a later visit to /signin starts clean.
const urlHints = readUrlHints();

/** Only same-origin paths may be used as a return target. */
function safePath(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function NewPasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match. Type the same password in both fields.");
      return;
    }
    setBusy(true);
    setError(null);
    void supabase.auth
      .updateUser({ password })
      .then(({ error: updateError }) => {
        if (updateError) {
          setError(updateError.message);
          return;
        }
        onDone();
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <p className="text-[15px] text-muted">
        You opened a password-reset link. Choose a new password for your account and you will be signed in straight away.
      </p>
      {error && (
        <Notice kind="danger" title="The password could not be changed">
          {error}
        </Notice>
      )}
      <Field label="New password" htmlFor={`${id}-password`} hint="At least 6 characters.">
        <Input
          id={`${id}-password`}
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>
      <Field label="Repeat the new password" htmlFor={`${id}-confirm`}>
        <Input
          id={`${id}-confirm`}
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>
          Save new password
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Back to sign in
        </Button>
      </div>
    </form>
  );
}

export function SignIn() {
  const { loading, session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [recovery, setRecovery] = useState(urlHints.recovery);
  const [urlError] = useState(urlHints.error);
  const [urlCode] = useState(urlHints.code);
  const redirectPath = safePath((location.state as { from?: unknown } | null)?.from);

  useEffect(() => {
    // Consume the one-time hints so the next visit to /signin is a plain sign-in.
    urlHints.recovery = false;
    urlHints.error = null;
    urlHints.code = null;
    if (!supabaseConfigured) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) {
    const many = missingSupabaseConfig.length !== 1;
    return (
      <AuthPageFrame title="Sign in" subtitle={SUBTITLE}>
        <Notice kind="danger" title="This dashboard is not connected to a Supabase project yet">
          {`Missing environment variable${many ? "s" : ""}: ${missingSupabaseConfig.join(", ")}. Set ${many ? "them" : "it"} as described in docs/SETUP.md, part D, then rebuild and redeploy.`}
        </Notice>
      </AuthPageFrame>
    );
  }

  // While the stored session (or the code exchange for an emailed link) is still resolving,
  // show nothing that could flash: neither the form for someone already signed in, nor a
  // verdict on a link that has not been tried yet.
  if (loading) {
    return (
      <AuthPageFrame title="Sign in" subtitle={SUBTITLE}>
        <Spinner label="Checking your account" />
      </AuthPageFrame>
    );
  }

  const linkProblem = urlError ? (
    <Notice kind="danger" title="That link did not work" className="mb-5">
      {urlError}
    </Notice>
  ) : null;
  // The page was opened from an emailed link and it produced no session.
  const linkUnusable = Boolean(urlCode) && !session;

  // A recovery link that failed to exchange cannot set a password (there is no session), so
  // it falls through to the sign-in form, where "Forgot your password?" requests a new one.
  if (recovery && !linkUnusable) {
    return (
      <AuthPageFrame title="Choose a new password" subtitle={SUBTITLE}>
        {linkProblem}
        <NewPasswordForm onDone={() => navigate("/", { replace: true })} onCancel={() => setRecovery(false)} />
      </AuthPageFrame>
    );
  }

  if (session) return <Navigate to={redirectPath} replace />;

  return (
    <AuthPageFrame title="Sign in" subtitle={SUBTITLE}>
      {linkProblem}
      {linkUnusable && <UnusableLinkNotice className="mb-5" />}
      <AuthForm mode="signin" redirectPath={redirectPath} onSignedIn={() => navigate(redirectPath, { replace: true })} />
    </AuthPageFrame>
  );
}
