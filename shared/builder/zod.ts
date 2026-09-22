/**
 * The one place the builder schemas import zod.
 *
 * shared/ is compiled by three different toolchains, and a bare `import ... from
 * "zod"` does not resolve in all of them:
 *   - The dashboard (Vite / Vitest) resolves the npm package fine.
 *   - `deno check` inside supabase/functions/ resolves it through that folder's
 *     deno.json import map.
 *   - The Supabase edge-function bundler (`supabase functions deploy --use-api`)
 *     bundles these shared/ files from the repo root and does NOT apply the
 *     functions' import map to them, so it reads the bare specifier as a relative
 *     path and the deploy fails to bundle.
 *
 * An explicit `npm:` specifier resolves natively in Deno and in the Supabase
 * bundler wherever they run, with no import map. Vite maps `npm:zod` back to the
 * npm package (see resolve.alias in vite.config.ts). Keep the version in step
 * with package.json and supabase/functions/deno.json.
 */
export { z } from "npm:zod@^4.6.5";
