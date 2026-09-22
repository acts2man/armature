/**
 * The forced first-sign-in password change. An account the agency created carries
 * `must_change_password: true` in app_metadata (which only the server can set), and
 * until the person has chosen their own password every signed-in screen sends them
 * to /choose-password. Pure decisions live here so they can be tested without a DOM.
 */
import type { User } from "@supabase/supabase-js";

export const CHOOSE_PASSWORD_PATH = "/choose-password";

export function mustChangePassword(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return user?.app_metadata?.["must_change_password"] === true;
}

/**
 * Where a signed-in person must be sent instead of `pathname`, or null when they
 * may stay. Everyone who still has to choose a password goes to the password
 * screen; everyone else is kept away from it.
 */
export function passwordGateRedirect(user: Pick<User, "app_metadata"> | null | undefined, pathname: string): string | null {
  const onPasswordScreen = pathname === CHOOSE_PASSWORD_PATH;
  if (mustChangePassword(user)) return onPasswordScreen ? null : CHOOSE_PASSWORD_PATH;
  return onPasswordScreen ? "/" : null;
}
