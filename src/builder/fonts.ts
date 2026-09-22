/**
 * The fonts the editor offers: a curated slice of Google Fonts (all under the Open Font
 * License) and the system stacks. A Google font chosen anywhere is recorded in the kit's
 * font list, which is the only list the site loads fonts from.
 */
import type { SiteKit } from "@shared/builder/index.ts";

export const GOOGLE_FONTS = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Nunito", "Raleway", "Work Sans", "Source Sans 3", "DM Sans", "Manrope", "Hanken Grotesk", "Plus Jakarta Sans", "Outfit", "Figtree", "Rubik", "Karla", "Mulish", "Josefin Sans",
  "Playfair Display", "Merriweather", "Lora", "PT Serif", "Libre Baskerville", "Cormorant Garamond", "DM Serif Display", "Fraunces", "Crimson Pro", "EB Garamond", "Source Serif 4", "Bricolage Grotesque", "Space Grotesk", "Sora", "Urbanist", "Oswald", "Bebas Neue", "Anton", "Archivo", "Barlow",
  "Roboto Slab", "Zilla Slab", "Bitter", "Arvo", "JetBrains Mono", "Fira Code", "IBM Plex Mono", "IBM Plex Sans", "Noto Sans", "Noto Serif", "Caveat", "Pacifico", "Dancing Script", "Lobster", "Abril Fatface",
];

export const SYSTEM_FONTS = ["system-ui", "Georgia", "Times New Roman", "Arial", "Helvetica", "Verdana", "Courier New", "monospace", "serif", "sans-serif"];

export const isGoogleFont = (family: string | undefined): family is string => !!family && GOOGLE_FONTS.includes(family);

const fontId = (family: string) => family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "font";

/** The kit with `family` in its font list when it is a Google font (unchanged otherwise). */
export function withKitFont(kit: SiteKit, family: unknown): SiteKit {
  if (typeof family !== "string" || !isGoogleFont(family)) return kit;
  if (kit.fonts.custom.some((font) => font.family === family)) return kit;
  if (kit.fonts.custom.length >= 20) return kit;
  let id = fontId(family);
  while (kit.fonts.custom.some((font) => font.id === id)) id = `${id}-2`.slice(0, 40);
  return { ...kit, fonts: { ...kit.fonts, custom: [...kit.fonts.custom, { id, family, source: "google" }] } };
}
