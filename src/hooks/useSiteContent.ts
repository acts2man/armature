/**
 * The site's committed content — its schema, pages.json and the head commit they
 * were read from — through the content-get edge function.
 *
 * The query resolves to the envelope, `{ ok: true, ... }` or a Failure, so a
 * logical failure never throws: a screen always has a `message` to render and
 * there is no silent state. `retry: false` because a failing GitHub read should be
 * reported at once rather than retried in the dark; `staleTime: 0` because the
 * commit sha must be fresh every time the editor opens.
 */
import { useQuery } from "@tanstack/react-query";
import { callFunction, type Failure } from "@/lib/functions.ts";
import type { ContentGetResponse } from "@shared/publishTypes.ts";

export const contentQueryKey = (siteId: string) => ["content", siteId] as const;

export type SiteContentResult = ContentGetResponse | Failure;

export function useSiteContent(siteId: string) {
  return useQuery<SiteContentResult>({
    queryKey: contentQueryKey(siteId),
    staleTime: 0,
    retry: false,
    queryFn: () => callFunction<ContentGetResponse>("content-get", { site_id: siteId }),
  });
}
