/**
 * The Pages screen's actions that change the site (duplicate, move to the bin, restore,
 * delete from the bin): each is one small builder-publish, so it is one commit with the
 * same checks as the editor's publish, and the content query is refreshed afterwards.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui.tsx";
import { contentQueryKey } from "@/hooks/useSiteContent.ts";
import { callFunction } from "@/lib/functions.ts";
import type { BuilderPublishRequest, BuilderPublishResponse } from "@shared/publishTypes.ts";

export type PageAction = { kind: "trash" | "restore" | "delete"; slug: string; label: string } | { kind: "duplicate"; slug: string; label: string; copySlug: string; copyLabel: string; copyPath: string };

const done = (action: PageAction): string => {
  switch (action.kind) {
    case "trash":
      return `"${action.label}" moved to the bin.`;
    case "restore":
      return `"${action.label}" is back.`;
    case "delete":
      return `"${action.label}" deleted for good.`;
    case "duplicate":
      return `"${action.copyLabel}" created.`;
  }
};

export function usePageActions(siteId: string, baseCommitSha: string | undefined) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (action: PageAction) => {
      if (!baseCommitSha) throw new Error("The site's content has not loaded yet. Try again in a moment.");
      const request: BuilderPublishRequest = { site_id: siteId, baseCommitSha, pages: [], layouts: {}, kit: null, media: null, resolutions: {} };
      if (action.kind === "duplicate") request.copies = { [action.copySlug]: { from: action.slug, label: action.copyLabel, path: action.copyPath } };
      else request.trash = { [action.slug]: action.kind };
      const result = await callFunction<BuilderPublishResponse>("builder-publish", request);
      if (!result.ok) throw new Error(result.message);
      return { result, action };
    },
    onSuccess: ({ action }) => {
      toast.show(done(action));
      void queryClient.invalidateQueries({ queryKey: contentQueryKey(siteId) });
      void queryClient.invalidateQueries({ queryKey: ["site-publishes", siteId] });
      void queryClient.invalidateQueries({ queryKey: ["site", siteId] });
    },
  });
}
