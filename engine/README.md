# The code engine (proof of concept)

Edits a React site's real source visually: no kit in the site, no conversion. Read
`docs/CODE_ENGINE.md` first: how it works, what worked on Tree Test Prep, where the runners
should live and the plan. Everything lives in this folder; the product is unchanged unless
the hidden flag is on.

## Try it

```sh
npm run engine                      # the engine server on http://localhost:4400 (GitHub mocked)
npm run dev                         # the dashboard
```

In the dashboard, open `/sites/<site id>/engine?page=/&engine=1` once (`engine=1` sets the
`armature:engine` flag in localStorage). The site row's repository and branch are cloned into
`.armature-engine-cache/`, installed and started; the first open of a site takes a few
minutes, later opens seconds. Set `ARMATURE_ENGINE_GITHUB=app` and
`ARMATURE_ENGINE_GITHUB_TOKEN=<installation token>` to publish to the real repository.

## Checks

```sh
npm run test:engine                 # unit tests: the AST engine, publish, the server
npm run typecheck:engine
ENGINE_SITE_DIR=<installed clone of acts2man/treetestprep main> npx playwright test -c engine/playwright.config.ts
node --import tsx engine/cli.ts open acts2man/treetestprep main   # open-time measurement
node --import tsx engine/cli.ts detect <dir>                       # what the engine sees in a site
```

## Folders

| Folder | What |
| --- | --- |
| `ast/` | Parsing and printing (recast), locating JSX, tracing words to their source, text, Tailwind and plain-CSS writes, pictures, structure, the session with undo. |
| `runner/` | Working copies, installs, the preview child process, the Vite plugins (source tags, bridge), site detection, env. |
| `bridge/` | The script injected into the preview. |
| `server/` | The JSON API the editor talks to. |
| `publish/` | Changed files, the three-way merge, one commit through the existing `ContentRepo`, the mock GitHub. |
| `editor/` | The browser side: workspace, overlays, inspector, publish dialog. |
| `tests/` | Unit tests (vitest) and the Playwright proof against the real site. |
| `fixtures/` | Two small sites for unit tests: a Lovable-style Vite + Tailwind + shadcn site and a trimmed copy of Tree Test Prep's pattern. |
