/**
 * Revisions: every publish is a commit, so the History panel lists recent publishes and
 * can preview the site as it was at one (content-get with `ref`) or restore it as a new
 * draft. Restoring never rewrites history: it is an ordinary draft that goes out with the
 * next publish, as one more commit.
 */
import { useQuery } from "@tanstack/react-query";
import { fieldPath } from "@shared/visualProtocol.ts";
import type { ContentTree } from "@shared/contentFile.ts";
import { defaultSiteKit, type LayoutDoc, type SiteKit } from "@shared/builder/index.ts";
import { supabase } from "@/lib/supabase.ts";
import type { Publish } from "@/lib/types.ts";
import { emptyDraft, emptyHistory, setFieldValue } from "@/visual/draftStore.ts";
import type { BuilderBaseline } from "./store.ts";
import type { EditorState } from "./history.ts";

export type Revision = { sha: string; at: string; userId: string | null; pages: string[]; commitUrl: string | null };
export type RevisionSnapshot = { sha: string; content: ContentTree; layouts: Record<string, LayoutDoc>; kit: SiteKit | null };

/** One entry per commit (a batch publish writes a row per page), newest first. */
export function groupRevisions(rows: Publish[]): Revision[] {
  const bySha = new Map<string, Revision>();
  for (const row of rows) {
    if (row.status !== "committed" || !row.commit_sha) continue;
    const existing = bySha.get(row.commit_sha);
    if (existing) {
      if (!existing.pages.includes(row.page_slug)) existing.pages.push(row.page_slug);
      continue;
    }
    bySha.set(row.commit_sha, { sha: row.commit_sha, at: row.created_at, userId: row.user_id, pages: [row.page_slug], commitUrl: row.commit_url });
  }
  return [...bySha.values()].sort((a, b) => b.at.localeCompare(a.at));
}

export function useRevisions(siteId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["revisions", siteId],
    enabled,
    queryFn: async (): Promise<Revision[]> => {
      const { data, error } = await supabase.from("publishes").select("*").eq("site_id", siteId).eq("status", "committed").order("created_at", { ascending: false }).limit(60);
      if (error) throw new Error(error.message);
      return groupRevisions((data ?? []) as Publish[]).slice(0, 20);
    },
    staleTime: 30_000,
  });
}

/**
 * The editor state that makes the site look as it did at a revision, relative to what is
 * published now: content fields that differ become draft values, layouts and the kit
 * are taken whole, and pages added since are deleted. Pictures keep their alt text.
 */
export function restoreRevision(snapshot: RevisionSnapshot, current: EditorState, published: ContentTree, baseline: BuilderBaseline): EditorState {
  let history = emptyHistory(emptyDraft());
  for (const [slug, sections] of Object.entries(snapshot.content)) {
    for (const [section, fields] of Object.entries(sections)) {
      for (const [field, value] of Object.entries(fields)) history = setFieldValue(history, published, fieldPath(slug, section, field), value);
    }
  }
  const deletedPages = Object.keys(baseline.layouts).filter((slug) => !snapshot.layouts[slug]);
  return { content: history.present, builder: { layouts: { ...snapshot.layouts }, deletedPages, kit: snapshot.kit ?? defaultSiteKit(), media: current.builder.media } };
}
