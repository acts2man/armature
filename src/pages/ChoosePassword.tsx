/**
 * /choose-password — the one screen an agency-created login can see until the
 * person has replaced the temporary password with their own. Outside the AppShell
 * (no navigation to wander off to), branded with the agency's portal name only.
 */
import { useId, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { mustChangePassword } from "@/auth/passwordGate.ts";
import { AuthPageFrame } from "@/components/AuthForm.tsx";
import { Button, Field, Input, Notice } from "@/components/ui.tsx";
import { callFunction } from "@/lib/functions.ts";
import { supabase } from "@/lib/supabase.ts";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@shared/passwordRules.ts";
import type { PasswordSetResponse } from "@shared/publishTypes.ts";

export function ChoosePassword() {
  const { user, agency, signOut } = useAuth();
  const navigate = useNavigate();
  const id = useId();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!mustChangePassword(user)) return <Navigate to="/" replace />;

  const portalName = agency?.portal_name ?? "your editing dashboard";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = passwordProblem(password, user?.email ?? "");
    if (problem) {
      setError(problem);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match. Type the same password in both fields.");
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      const result = await callFunction<PasswordSetResponse>("password-set", { password });
      if (!result.ok) {
        setError(result.message);
        setBusy(false);
        return;
      }
      // The sign-in token still says the password must be changed; a refresh fetches
      // one that does not. If that fails, a fresh sign-in with the new password does.
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        await signOut();
        navigate("/signin", { replace: true });
        return;
      }
      navigate("/", { replace: true });
    })();
  }

  return (
    <AuthPageFrame title="Choose your password" subtitle={portalName}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-[15px] text-muted">
          You signed in with a temporary password. Choose your own to continue; you will use it from now on.
          {user?.email ? ` Your sign-in email stays ${user.email}.` : ""}
        </p>
        {error && (
          <Notice kind="danger" title="The password could not be saved">
            {error}
          </Notice>
        )}
        <Field
          label="New password"
          htmlFor={`${id}-password`}
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Not the word "password", not your email address, and not one character repeated.`}
        >
          <Input
            id={`${id}-password`}
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy}
          />
        </Field>
        <Field label="Repeat the new password" htmlFor={`${id}-confirm`}>
          <Input
            id={`${id}-confirm`}
            type={show ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={busy}
          />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm text-text">
          <input type="checkbox" checked={show} onChange={(event) => setShow(event.target.checked)} disabled={busy} />
          Show the passwords
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={busy}>
            Save password and continue
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              void signOut().then(() => navigate("/signin", { replace: true }));
            }}
          >
            Sign out
          </Button>
        </div>
      </form>
    </AuthPageFrame>
  );
}
