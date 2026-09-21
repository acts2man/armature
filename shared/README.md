# shared/

The site contract, as code. Everything in this folder is imported by **both** the
browser app (`src/`, through Vite) and the Supabase edge functions (`supabase/functions/`,
through Deno), so the two can never disagree about what a valid `content/schema.json`
or `content/pages.json` looks like, how the content file is serialised, or which
values a field may hold.

Rules for files in here:

- No package: plain TypeScript modules, relative imports **with** the `.ts` extension
  (Deno requires it; Vite and `tsc` are configured to allow it).
- No Node, Deno or browser-only APIs. Only what both runtimes share: `JSON`,
  `TextEncoder`/`TextDecoder`, `atob`/`btoa`, `crypto.subtle`.
- No secrets, no network, no filesystem. Pure functions and types only.

Tests for this folder run under vitest (`npm test`). The example site in `example/`
is the one printed in `docs/SITE_CONTRACT.md`, and the tests assert it is valid.
