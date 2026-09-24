/**
 * The one Supabase client the browser uses. It only ever sees the project URL and
 * the publishable key — both safe to ship. Everything privileged happens in the
 * edge functions.
 *
 * While agency staff "view as" a client (src/auth/viewAs.ts) every request goes through
 * `guardedFetch`: reads pass, writes are refused here in the browser with a readable
 * message, and the person's own session is never touched.
 */
import { createClient } from "@supabase/supabase-js";
import { blocksWrite, readOnlyResponse } from "./readOnly.ts";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

/** False when the two VITE_ variables are missing; the sign-in screen says so. */
export const supabaseConfigured = url.length > 0 && key.length > 0;

/** Which variables are missing, for the message on the sign-in screen. */
export const missingSupabaseConfig: string[] = [
  ...(url ? [] : ["VITE_SUPABASE_URL"]),
  ...(key ? [] : ["VITE_SUPABASE_PUBLISHABLE_KEY"]),
];

/** The refusal every write gets while a read-only view is on; null otherwise. */
let readOnlyReason: string | null = null;

/** Turn the read-only guard on (with the message writes are refused with) or off (null). */
export function setReadOnly(reason: string | null): void {
  readOnlyReason = reason;
}

const guardedFetch: typeof fetch = (input, init) => {
  if (readOnlyReason) {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (blocksWrite(target, method)) return Promise.resolve(readOnlyResponse(readOnlyReason));
  }
  return fetch(input, init);
};

export const supabase = createClient(url || "https://not-configured.invalid", key || "not-configured", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
  global: { fetch: guardedFetch },
});
