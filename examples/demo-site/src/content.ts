/**
 * The site's content helper (docs/SITE_CONTRACT.md, "How a site should read its
 * content") on top of the kit. Outside edit mode the kit is inert and these helpers
 * just read pages.json.
 */
import { useSyncExternalStore } from "react";
import { armature } from "./armature.ts";

export { registerNavigate } from "./armature.ts";

export function usePageCopy(slug: string) {
  useSyncExternalStore(armature.subscribe, armature.getSnapshot, armature.getSnapshot);
  return {
    text: (section: string, field: string) => armature.text(slug, section, field),
    plain: (section: string, field: string) => armature.plain(slug, section, field),
    link: (section: string, field: string) => armature.link(slug, section, field),
    image: (section: string, field: string) => armature.image(slug, section, field),
    list: (section: string, field: string) => armature.list(slug, section, field),
  };
}
