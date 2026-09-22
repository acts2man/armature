/**
 * The site's one content helper (docs/SITE_CONTRACT.md, "How a site should read its
 * content") wired to the visual-editing bridge (contract v1.1). Outside edit mode the
 * bridge is inert and these helpers just read pages.json.
 */
import { useSyncExternalStore } from "react";
import { createArmatureBridge, type SiteSchemaLike, type ContentTree } from "../../../bridge/armature-bridge.ts";
import schema from "../content/schema.json";
import content from "../content/pages.json";

const origins = (import.meta.env.VITE_ARMATURE_EDITOR_ORIGINS as string | undefined)?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [
  "http://localhost:5173",
  "https://armature-sites.netlify.app",
];

let navigate: ((path: string) => void) | null = null;
/** The router registers itself so the editor's page switcher can move without a reload. */
export const registerNavigate = (fn: (path: string) => void) => {
  navigate = fn;
};

export const armature = createArmatureBridge({
  allowedOrigins: origins,
  schema: schema as SiteSchemaLike,
  content: content as ContentTree,
  navigate: (path) => (navigate ? navigate(path) : window.location.assign(path)),
});

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
