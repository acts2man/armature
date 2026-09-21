/**
 * The one Supabase client the browser uses. It only ever sees the project URL and
 * the publishable key — both safe to ship. Everything privileged happens in the
 * edge functions.
 */
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? "";
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";

/** False when the two VITE_ variables are missing; the sign-in screen says so. */
export const supabaseConfigured = url.length > 0 && key.length > 0;

/** Which variables are missing, for the message on the sign-in screen. */
export const missingSupabaseConfig: string[] = [
  ...(url ? [] : ["VITE_SUPABASE_URL"]),
  ...(key ? [] : ["VITE_SUPABASE_PUBLISHABLE_KEY"]),
];

export const supabase = createClient(url || "https://not-configured.invalid", key || "not-configured", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
});
