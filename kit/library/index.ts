/**
 * The widget library: every widget beyond the core ones, its CSS and its glyphs.
 *
 * Importing this file registers nothing. `createArmatureKit` calls `registerLibrary()`,
 * which is what puts the widgets, their base CSS and their per-widget CSS hooks into the
 * kit's registries (the glyphs travel with the widgets that draw them). Registration used
 * to happen as a side effect of importing each module; a bundler that trusts a site's
 * `"sideEffects": false` (a common line in a Vite site's package.json) then dropped every
 * one of those imports from the production build, and every library widget rendered as
 * nothing on the live site while the dev server showed them all.
 */
import { registerWidgets, type WidgetRender } from "../widgets.tsx";
import { BASIC_WIDGETS } from "./basic.tsx";
import { CHROME_WIDGETS } from "./chrome.tsx";
import { CONTENT_WIDGETS } from "./content.tsx";
import { registerLibraryCss } from "./css.ts";
import { FORM_WIDGETS } from "./form.tsx";
import { INTERACTIVE_WIDGETS } from "./interactive.tsx";

/** Every library widget by type. */
export const LIBRARY_WIDGETS: Readonly<Record<string, WidgetRender>> = {
  ...BASIC_WIDGETS,
  ...CONTENT_WIDGETS,
  ...INTERACTIVE_WIDGETS,
  ...FORM_WIDGETS,
  ...CHROME_WIDGETS,
};

/**
 * Registers the library's widgets, base CSS and CSS hooks. Called by `createArmatureKit`;
 * calling it again does nothing, and a type the site registered itself is left alone.
 */
export function registerLibrary(): void {
  registerWidgets(LIBRARY_WIDGETS);
  registerLibraryCss();
}
