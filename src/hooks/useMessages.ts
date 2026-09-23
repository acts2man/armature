/**
 * Entries from a site's forms (the form_submissions table, under RLS), for the
 * Dashboard's "New messages" and the Contact inbox.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase.ts";
import type { FormSubmission } from "@/lib/types.ts";

export const messagesQueryKey = (siteId: string) => ["form-submissions", siteId] as const;

/** The latest three entries from the site's forms, and how many are unread. */
export function useRecentMessages(siteId: string) {
  return useQuery({
    queryKey: [...messagesQueryKey(siteId), "recent"],
    queryFn: async () => {
      const [latest, unread] = await Promise.all([
        supabase.from("form_submissions").select("*").eq("site_id", siteId).order("created_at", { ascending: false }).limit(3),
        // Unread ids rather than a HEAD count: small, exact, and the same code path everywhere.
        supabase.from("form_submissions").select("id").eq("site_id", siteId).is("read_at", null).limit(1000),
      ]);
      if (latest.error) throw new Error(latest.error.message);
      if (unread.error) throw new Error(unread.error.message);
      return { latest: (latest.data ?? []) as FormSubmission[], unread: (unread.data ?? []).length };
    },
  });
}

