/**
 * Entries from a site's forms (the form_submissions table, under RLS): the Dashboard's
 * "New messages", the Contact inbox, and the changes anyone can make to an entry (mark
 * it read or unread; agency staff may delete).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui.tsx";
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

/** How many entries are unread, for the sidebar's badge. */
export function useUnreadCount(siteId: string | undefined): number {
  const query = useQuery({
    queryKey: [...messagesQueryKey(siteId ?? ""), "unread-count"],
    enabled: !!siteId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("form_submissions").select("id").eq("site_id", siteId ?? "").is("read_at", null).limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []).length;
    },
  });
  return query.data ?? 0;
}

/** Every entry, newest first (the newest 500). */
export function useMessages(siteId: string) {
  return useQuery({
    queryKey: [...messagesQueryKey(siteId), "all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("form_submissions").select("*").eq("site_id", siteId).order("created_at", { ascending: false }).limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as FormSubmission[];
    },
  });
}

export function useMessageActions(siteId: string) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const refresh = () => queryClient.invalidateQueries({ queryKey: messagesQueryKey(siteId) });
  const markRead = useMutation({
    mutationFn: async ({ ids, read }: { ids: string[]; read: boolean }) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("form_submissions")
        .update({ read_at: read ? new Date().toISOString() : null })
        .eq("site_id", siteId)
        .in("id", ids);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void refresh(),
    onError: (error) => toast.show(error.message, "danger"),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("form_submissions").delete().eq("site_id", siteId).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.show("Message deleted.");
      void refresh();
    },
    onError: (error) => toast.show(error.message, "danger"),
  });
  return { markRead, remove };
}
