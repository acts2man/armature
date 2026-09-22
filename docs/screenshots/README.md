# Screenshots

Every screen of the dashboard, captured headlessly with mocked data at 1440×900
(`*-desktop.png`) and 375×812 (`*-mobile.png`, full page). The names and sites are
placeholder data for the capture only; nothing here is hard-coded in the app.

The two screens with an approved design file to compare against:

| Screen | Design file | Screenshot |
| --- | --- | --- |
| Agency fleet | `docs/4-agency-fleet.html` | `agency-fleet-desktop.png` |
| Client home | `docs/2-client-dashboard.html` | `client-home-desktop.png` |

Agency screens: `agency-fleet`, `agency-fleet-menu` (the phone drawer), `agency-add-site`,
`agency-requests`, `agency-team`, `agency-settings`, `agency-site-overview` (with a
connection check that found a problem), `agency-site-pages`, `agency-editor` (one field
edited), `agency-site-requests`, `agency-request-detail`, `agency-history`,
`agency-site-team`, `agency-site-team-login` (Create client login with a generated
password), `agency-github-setup`.

Client screens (the agency's portal name, never Armature): `client-home`,
`client-home-menu`, `client-pages`, `client-editor`, `client-requests`,
`client-request-detail`, `client-request-new`, `client-history`, `client-account`,
`client-choose-password` (the forced first sign-in).

Signed out: `signin`, `invite`.

To regenerate: run the dashboard with `VITE_SUPABASE_URL=https://mock.supabase.co` and
any publishable key, then drive it with a browser that fakes the session and answers
the Supabase requests; the harness used for these lives outside the repository.
