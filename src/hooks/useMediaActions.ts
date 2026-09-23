/**
 * The Media Library's changes: uploads, alt text and deletions, each one small
 * builder-publish (one commit, the same checks as the editor's publish), then the site's
 * content is re-read so the library shows what is really there.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui.tsx";
import { contentQueryKey } from "@/hooks/useSiteContent.ts";
import { callFunction } from "@/lib/functions.ts";
import { fileToBase64, prepareImage } from "@/lib/resizeImage.ts";
import type { BuilderPublishRequest, BuilderPublishResponse, MediaFile, MediaMeta } from "@shared/publishTypes.ts";

export type MediaAction = { kind: "upload"; files: File[] } | { kind: "alt"; path: string; alt: string } | { kind: "delete"; path: string };

/** content/media.json as the library knows it: every picture with alt text, from the content read. */
export const metaFromFiles = (files: MediaFile[]): MediaMeta => Object.fromEntries(files.filter((file) => file.alt).map((file) => [file.path, { alt: file.alt }]));

export function useMediaActions(siteId: string, baseCommitSha: string | undefined, files: MediaFile[]) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (action: MediaAction) => {
      if (!baseCommitSha) throw new Error("The site's content has not loaded yet. Try again in a moment.");
      const request: BuilderPublishRequest = { site_id: siteId, baseCommitSha, pages: [], layouts: {}, kit: null, media: null, resolutions: {} };
      if (action.kind === "upload") {
        // The same rules as a picture added in the editor: WebP, at most 2000px and 3 MB.
        request.uploads = [];
        for (const file of action.files) {
          const prepared = await prepareImage(file);
          URL.revokeObjectURL(prepared.previewUrl);
          request.uploads.push({ name: file.name, data: `data:${prepared.file.type};base64,${await fileToBase64(prepared.file)}` });
        }
      } else if (action.kind === "alt") {
        const meta = metaFromFiles(files);
        if (action.alt.trim()) meta[action.path] = { alt: action.alt.trim().slice(0, 500) };
        else delete meta[action.path];
        request.media = meta;
      } else {
        request.deleteAssets = [action.path];
      }
      const result = await callFunction<BuilderPublishResponse>("builder-publish", request);
      if (!result.ok) throw new Error(result.message);
      return { result, action };
    },
    onSuccess: ({ result, action }) => {
      if (action.kind === "upload") toast.show(result.images.length === 1 ? "Picture uploaded." : `${result.images.length} pictures uploaded.`);
      else if (action.kind === "alt") toast.show("Description saved.");
      else toast.show("Picture deleted.");
      void queryClient.invalidateQueries({ queryKey: contentQueryKey(siteId) });
      void queryClient.invalidateQueries({ queryKey: ["site-publishes", siteId] });
      void queryClient.invalidateQueries({ queryKey: ["site", siteId] });
    },
  });
}
