/**
 * The draft saved to the person's account (builder_drafts), so unpublished work follows
 * them to another browser or device. The browser copy stays as the fast, offline one;
 * on opening the editor the newer of the two is offered back. Row-level security lets
 * each person read and write only their own draft (agency staff may read to help).
 */
import { supabase } from "@/lib/supabase.ts";
import { parseEditorDraft, type StoredEditorDraft } from "./persistence.ts";

/** Keep well under the table's 5 MB check: a draft over this stays in the browser only. */
export const SERVER_DRAFT_MAX_BYTES = 4_500_000;
export const SERVER_AUTOSAVE_MS = 2000;

export type DraftSource = "browser" | "account";

export async function fetchServerDraft(siteId: string, userId: string): Promise<StoredEditorDraft | null> {
  const { data, error } = await supabase.from("builder_drafts").select("draft").eq("site_id", siteId).eq("user_id", userId).limit(1);
  if (error || !data?.[0]) return null;
  return parseEditorDraft(JSON.stringify((data[0] as { draft: unknown }).draft));
}

/** Saves the serialized draft; false when it is too large or the save failed (the browser copy remains). */
export async function saveServerDraft(input: { siteId: string; userId: string; serialized: string; baseCommit: string; changeCount: number }): Promise<boolean> {
  if (new Blob([input.serialized]).size > SERVER_DRAFT_MAX_BYTES) return false;
  const { error } = await supabase
    .from("builder_drafts")
    .upsert({ site_id: input.siteId, user_id: input.userId, draft: JSON.parse(input.serialized) as unknown, base_commit: /^[0-9a-f]{7,40}$/.test(input.baseCommit) ? input.baseCommit : null, change_count: input.changeCount }, { onConflict: "site_id,user_id" });
  return !error;
}

export async function deleteServerDraft(siteId: string, userId: string): Promise<void> {
  await supabase.from("builder_drafts").delete().eq("site_id", siteId).eq("user_id", userId);
}

/** The draft to offer back: the newer of the browser's and the account's. */
export function newerDraft(browser: StoredEditorDraft | null, account: StoredEditorDraft | null): { draft: StoredEditorDraft; source: DraftSource } | null {
  if (!browser && !account) return null;
  if (!account) return { draft: browser!, source: "browser" };
  if (!browser) return { draft: account, source: "account" };
  return Date.parse(account.savedAt) > Date.parse(browser.savedAt) ? { draft: account, source: "account" } : { draft: browser, source: "browser" };
}
