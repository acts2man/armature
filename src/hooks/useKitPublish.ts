/**
 * Publishing the site kit (Globals, Menus) and removing a chrome part from the dashboard:
 * one builder-publish each, one commit, with the same checks as the editor's publish.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui.tsx";
import { contentQueryKey } from "@/hooks/useSiteContent.ts";
import { callFunction } from "@/lib/functions.ts";
import type { SiteKit } from "@kit/types.ts";
import type { BuilderPublishRequest, BuilderPublishResponse } from "@shared/publishTypes.ts";

export type KitPublishAction = { kind: "kit"; kit: SiteKit; done: string } | { kind: "remove-part"; slug: "_header" | "_footer"; done: string };

export function useKitPublish(siteId: string, baseCommitSha: string | undefined) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (action: KitPublishAction) => {
      if (!baseCommitSha) throw new Error("The site's content has not loaded yet. Try again in a moment.");
      const request: BuilderPublishRequest = { site_id: siteId, baseCommitSha, pages: [], layouts: {}, kit: null, media: null, resolutions: {} };
      if (action.kind === "kit") request.kit = action.kit;
      else request.layouts = { [action.slug]: null };
      const result = await callFunction<BuilderPublishResponse>("builder-publish", request);
      if (!result.ok) throw new Error(result.message);
      return { result, action };
    },
    onSuccess: ({ action }) => {
      toast.show(action.done);
      void queryClient.invalidateQueries({ queryKey: contentQueryKey(siteId) });
      void queryClient.invalidateQueries({ queryKey: ["site-publishes", siteId] });
      void queryClient.invalidateQueries({ queryKey: ["site", siteId] });
    },
  });
}
