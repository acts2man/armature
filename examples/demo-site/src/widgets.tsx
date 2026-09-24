/**
 * A test-only page: one element of every widget the kit ships, rendered through
 * <ArmaturePage> from src/every-widget.json.
 *
 * tests/e2e/production-build.spec.ts builds this site for production laid out exactly as
 * a real site is (the kit copied to src/lib/armature-kit/ under a package.json that says
 * "sideEffects": false), serves the built files and checks in a browser that every widget
 * on this page rendered. A dev server never tree-shakes, so only a production build can
 * show a widget the bundler dropped. tests/kit/widgets.test.ts keeps the layout in step
 * with the kit's widget list, so a new widget has to be added here too.
 *
 * Reachable at /every-widget only; not part of the real demo site.
 */
import { ArmaturePage, type LayoutDoc } from "../../../kit/index.ts";
import layout from "./every-widget.json";

export function EveryWidget() {
  return <ArmaturePage slug="every-widget" layout={layout as unknown as LayoutDoc} />;
}
