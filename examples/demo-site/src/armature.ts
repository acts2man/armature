/**
 * The site's one Armature setup (site contract v2). The kit is imported straight from
 * ../../kit so this repository has one copy; a real site copies that folder to
 * src/lib/armature-kit/ and imports from there.
 */
import { createArmatureKit, type ContentTree, type SiteKit } from "../../../kit/index.ts";
import type { SiteSchemaLike } from "../../../kit/bridge.ts";
import schema from "../content/schema.json";
import content from "../content/pages.json";
import siteKit from "../content/site-kit.json";

const origins = (import.meta.env.VITE_ARMATURE_EDITOR_ORIGINS as string | undefined)?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [
  "http://localhost:5173",
  "https://armature-sites.netlify.app",
];

let navigate: ((path: string) => void) | null = null;
/** The router registers itself so the editor's page switcher can move without a reload. */
export const registerNavigate = (fn: (path: string) => void) => {
  navigate = fn;
};

export const armature = createArmatureKit({
  allowedOrigins: origins,
  schema: schema as SiteSchemaLike,
  content: content as ContentTree,
  siteKit: siteKit as SiteKit,
  layouts: import.meta.glob("../content/layouts/*.json", { eager: true }),
  navigate: (path) => (navigate ? navigate(path) : window.location.assign(path)),
  // Where the Form widget sends entries: the dashboard's form-submit function and this site's id.
  forms: {
    endpoint: (import.meta.env.VITE_ARMATURE_FORMS_ENDPOINT as string | undefined) ?? "https://demo.supabase.co/functions/v1/form-submit",
    siteId: (import.meta.env.VITE_ARMATURE_SITE_ID as string | undefined) ?? "11111111-1111-4111-8111-111111111111",
  },
});
