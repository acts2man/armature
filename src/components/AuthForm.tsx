/**
 * The sign-in form shared by /signin and /invite/:token: email + password (with a
 * create-account switch and "forgot password"), or an emailed sign-in link. Every
 * Supabase error is shown verbatim in a Notice; nothing is swallowed.
 *
 * Also exports the full-page frame both of those pages sit in, since neither is
 * inside the AppShell and no agency branding is known before sign-in.
 */
import { clsx } from "clsx";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { supabase } from "@/lib/supabase.ts";
import { Button, Field, Input, Notice } from "./ui.tsx";

export type AuthFormProps = {
  /** "signin" for the sign-in page; "invite" for the invite page, where new accounts are expected. */
  mode: "signin" | "invite";
  defaultEmail?: string;
  lockEmail?: boolean;
  /** Path (starting with "/") that emailed links bring the person back to. */
  redirectPath: string;
  onSignedIn?: () => void;
};

type Method = "password" | "magic";
type Busy = "submit" | "reset" | null;
type Message = { kind: "success" | "warning" | "danger"; title: string; body: string };

const textButtonClass =
  "inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50";

const problem = (body: string): Message => ({ kind: "danger", title: "That did not work", body });

function MethodTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        "min-h-11 rounded-md px-3 text-sm font-medium transition-colors",
        active ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-text",
      )}
    >
      {children}
    </button>
  );
}

export function AuthForm({ mode, defaultEmail = "", lockEmail = false, redirectPath, onSignedIn }: AuthFormProps) {
  const id = useId();
  const [method, setMethod] = useState<Method>("password");
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const cleanEmail = email.trim();
  const returnTo = window.location.origin + redirectPath;

  /** Runs one auth call, shows whatever it reports, and never leaves a button stuck in "loading". */
  async function run(kind: Exclude<Busy, null>, action: () => Promise<Message | null>) {
    setBusy(kind);
    setMessage(null);
    try {
      const outcome = await action();
      if (outcome) setMessage(outcome);
    } catch (error) {
      setMessage(problem(error instanceof Error ? error.message : String(error)));
    } finally {
      setBusy(null);
    }
  }

  function switchMethod(next: Method) {
    setMethod(next);
    setMessage(null);
  }

  function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run("submit", async () => {
      if (creating) {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: returnTo },
        });
        if (error) return problem(error.message);
        if (data.session) {
          onSignedIn?.();
          return null;
        }
        // Supabase answers an already-registered email with a user that has no identities, on purpose.
        if (data.user && data.user.identities?.length === 0) {
          return {
            kind: "warning",
            title: "This email address may already have an account",
            body: `No confirmation email was sent for ${cleanEmail}. Try signing in with your password, or use "Forgot your password?".`,
          };
        }
        // Supabase's default: the account exists but is unconfirmed until the emailed link is opened.
        return {
          kind: "success",
          title: "Check your inbox to confirm your email address",
          body: `We sent a confirmation email to ${cleanEmail}. Open the link in it to finish creating your account; it brings you back here, signed in.`,
        };
      }
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) return problem(error.message);
      onSignedIn?.();
      return null;
    });
  }

  function submitMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run("submit", async () => {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        // On the invite page the person may have no account yet, so the link may create one.
        options: { emailRedirectTo: returnTo, shouldCreateUser: mode === "invite" },
      });
      if (error) return problem(error.message);
      return {
        kind: "success",
        title: "Check your email for a sign-in link",
        body: `We sent a link to ${cleanEmail}. Opening it signs you in and takes you straight to the dashboard, so you can close this tab.`,
      };
    });
  }

  function forgotPassword() {
    if (!cleanEmail) {
      setMessage({
        kind: "danger",
        title: "Enter your email address first",
        body: 'Type the email address for your account in the field above, then choose "Forgot your password?" again.',
      });
      return;
    }
    void run("reset", async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: window.location.origin + "/signin",
      });
      if (error) return problem(error.message);
      return {
        kind: "success",
        title: "Check your email",
        body: `If an account exists for ${cleanEmail}, we sent it a link to reset the password. The link opens the sign-in page, where you can choose a new one.`,
      };
    });
  }

  const emailField = (fieldId: string, hint?: ReactNode) => (
    <Field label="Email address" htmlFor={fieldId} hint={hint}>
      <Input
        id={fieldId}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        required
        readOnly={lockEmail}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
    </Field>
  );

  return (
    <div className="space-y-5">
      <div role="group" aria-label="How to sign in" className="grid grid-cols-2 gap-1 rounded-lg bg-ground p-1">
        <MethodTab active={method === "password"} onClick={() => switchMethod("password")}>
          Email and password
        </MethodTab>
        <MethodTab active={method === "magic"} onClick={() => switchMethod("magic")}>
          Email me a sign-in link
        </MethodTab>
      </div>

      {message && (
        <Notice kind={message.kind} title={message.title}>
          {message.body}
        </Notice>
      )}

      {method === "password" ? (
        <form onSubmit={submitPassword} className="space-y-4">
          {emailField(`${id}-email`)}
          <Field
            label={creating ? "Choose a password" : "Password"}
            htmlFor={`${id}-password`}
            hint={creating ? "At least 6 characters." : undefined}
          >
            <Input
              id={`${id}-password`}
              type="password"
              name="password"
              autoComplete={creating ? "new-password" : "current-password"}
              required
              minLength={creating ? 6 : undefined}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </Field>
          <Button type="submit" className="w-full" loading={busy === "submit"} disabled={busy !== null}>
            {creating ? "Create account" : "Sign in"}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <button
              type="button"
              className={textButtonClass}
              disabled={busy !== null}
              onClick={() => {
                setCreating((value) => !value);
                setMessage(null);
              }}
            >
              {creating ? "I already have an account" : "Create an account instead"}
            </button>
            {!creating && (
              <button type="button" className={textButtonClass} disabled={busy !== null} onClick={forgotPassword}>
                {busy === "reset" ? "Sending the reset link…" : "Forgot your password?"}
              </button>
            )}
          </div>
        </form>
      ) : (
        <form onSubmit={submitMagicLink} className="space-y-4">
          {emailField(`${id}-magic-email`, "We will email you a link that signs you in. No password needed.")}
          <Button type="submit" className="w-full" loading={busy === "submit"} disabled={busy !== null}>
            Email me a sign-in link
          </Button>
        </form>
      )}
    </div>
  );
}

/** Full-page centred card for the screens outside the AppShell (sign-in, invite). */
export function AuthPageFrame({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ground px-4 py-8">
      <main className="w-full max-w-md rounded-card border border-line bg-panel p-6 sm:p-8">
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}
