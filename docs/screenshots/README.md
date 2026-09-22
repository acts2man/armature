# Screenshots

Every screen of the dashboard, captured headlessly with mocked data at 1440×900
(`*-desktop.png`) and 375×812 (`*-mobile.png`, full page). The names and sites are
placeholder data for the capture only; nothing here is hard-coded in the app.

The two screens with an approved design file to compare against:

| Screen | Design file | Screenshot |
| --- | --- | --- |
| Agency fleet | `docs/4-agency-fleet.html` | `agency-fleet-desktop.png` |
| Client home | `docs/2-client-dashboard.html` | `client-home-desktop.png` |
| Visual editor | `docs/1-visual-editor.html` | `visual-editor-text-selected.png` |

Agency screens: `agency-fleet`, `agency-fleet-menu` (the phone drawer), `agency-add-site`,
`agency-requests`, `agency-team`, `agency-settings`, `agency-site-overview` (with a
connection check that found a problem), `agency-site-pages`, `agency-editor` (one field
edited), `agency-site-requests`, `agency-request-detail`, `agency-history`,
`agency-site-team`, `agency-site-team-login` (Create client login with a generated
password), `agency-github-setup`.

Hosting and services (agency only): `agency-site-services` (the Hosting & services panel on a
site overview), `agency-site-services-edit` (its edit drawer with the live yearly total),
`agency-site-hosting-only` (a hosting-only site with Connect repository),
`agency-add-site-hosting-only` (the Add a hosting-only client path). Fleet shows the yearly
totals and renewals.

Client screens (the agency's portal name, never Armature): `client-home`,
`client-home-menu`, `client-pages`, `client-editor`, `client-requests`,
`client-request-detail`, `client-request-new`, `client-history`, `client-account`,
`client-choose-password` (the forced first sign-in).

Signed out: `signin`, `invite`.

To regenerate: run the dashboard with `VITE_SUPABASE_URL=https://mock.supabase.co` and
any publishable key, then drive it with a browser that fakes the session and answers
the Supabase requests; the harness used for these lives outside the repository.

The visual editor (against `examples/demo-site`, mocked Supabase, 1440×900; captured by
`npx tsx tests/e2e/screenshots.ts` with both dev servers running): `visual-editor-text-selected`
(a headline typed on the page, the wire selection and its toolbar), `visual-editor-image-selected`
(a picture selected, Replace in the inspector), `visual-editor-list-selected` (the FAQ list
with a new item, the page following), `visual-editor-publish` (the publish summary grouped
by page), `visual-editor-phone` (the 390px view), `visual-editor-connection-error` (a site
that sends `X-Frame-Options: DENY`, with the header to add).

The page builder (same setup, captured by `npx tsx tests/e2e/builder-screenshots.ts` with
both dev servers running), compared against `docs/BUILDER_SPEC.md` and the visual editor
design: `builder-drag-in-progress` (a Heading dragged from the Elements panel, the drop
line inside a column), `builder-rich-text-toolbar` (a text element edited in place with
the floating toolbar), `builder-image-resize` (an image's width handle mid-drag with its
live value), `builder-spacing-handles` (a section's top padding handle mid-drag),
`builder-style-tab` (the Style tab for a heading), `builder-navigator` (the element tree
with a button selected), `builder-site-settings` (global colours and fonts),
`builder-pages` (the Pages tab and the New page dialog), `builder-media` (the media
library with usage and alt text), `builder-history-versions` (an older publish previewed
on the canvas), `builder-publish-dialog` (a layout and the site settings in one publish).
