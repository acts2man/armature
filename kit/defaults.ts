/**
 * The default site kit. A site without content/site-kit.json renders with this; the
 * dashboard's Site settings panel starts from it and the first publish that touches
 * the kit writes the file.
 */
import type { SiteKit, TypographyPreset } from "./types.ts";
import { px } from "./values.ts";

const type = (size: number, mobile: number, weight: TypographyPreset["fontWeight"], lineHeight: number, family = "kit:font.heading"): TypographyPreset => ({
  fontFamily: family,
  fontSize: mobile === size ? px(size) : { desktop: px(size), mobile: px(mobile) },
  fontWeight: weight,
  lineHeight: { value: lineHeight, unit: "" },
});

export function defaultSiteKit(): SiteKit {
  return {
    version: 1,
    colors: {
      primary: "#2b3fd6",
      secondary: "#16202b",
      text: "#1b2733",
      accent: "#e9c46a",
      custom: [],
    },
    fonts: { heading: "system-ui", body: "system-ui", custom: [] },
    typography: {
      h1: type(48, 34, 700, 1.1),
      h2: type(36, 28, 700, 1.15),
      h3: type(28, 24, 600, 1.2),
      h4: type(22, 20, 600, 1.25),
      h5: type(18, 17, 600, 1.3),
      h6: type(16, 15, 600, 1.35),
      body: type(17, 16, 400, 1.6, "kit:font.body"),
      small: type(14, 14, 400, 1.5, "kit:font.body"),
      button: type(15, 15, 600, 1, "kit:font.body"),
    },
    buttons: {
      primary: {
        background: "kit:color.primary",
        color: "#ffffff",
        radius: px(8),
        padding: { top: px(12), right: px(22), bottom: px(12), left: px(22) },
        hover: { background: "kit:color.secondary", color: "#ffffff" },
      },
      secondary: {
        background: "kit:color.secondary",
        color: "#ffffff",
        radius: px(8),
        padding: { top: px(12), right: px(22), bottom: px(12), left: px(22) },
        hover: { background: "kit:color.primary", color: "#ffffff" },
      },
      outline: {
        background: "transparent",
        color: "kit:color.primary",
        borderWidth: px(1),
        borderColor: "kit:color.primary",
        radius: px(8),
        padding: { top: px(11), right: px(22), bottom: px(11), left: px(22) },
        hover: { background: "kit:color.primary", color: "#ffffff" },
      },
    },
    links: { color: "kit:color.primary", hover: "kit:color.secondary" },
    forms: { fieldBackground: "#ffffff", fieldBorder: "#d7dde3", fieldRadius: px(6), fieldText: "kit:color.text" },
    container: { contentWidth: px(1140), padding: { top: px(40), right: px(20), bottom: px(40), left: px(20) }, gap: px(20) },
    breakpoints: { tablet: 1024, mobile: 767 },
    imageRadius: px(0),
    pageBackground: "#ffffff",
    menus: [],
  };
}
