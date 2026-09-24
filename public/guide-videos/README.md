# Guide walkthroughs

This folder holds the recorded walkthroughs the /getting-started page plays inline. Each
section of the guide has its own `.webm` file, named after the section key:

- `agency-setup.webm`
- `add-site.webm`
- `set-up-site.webm`
- `give-access.webm`
- `editing-publishing.webm`
- `keep-updated.webm`
- `troubleshoot.webm`

## How to (re)record them

Run the recorder from the repository root:

```bash
npm run record:guide-videos
```

The script (`scripts/record-guide-videos.mjs`) boots the dashboard on port 5173 and the demo site
on port 5174 with Playwright, walks through each section's scripted click sequence, overlays plain-
English captions in a bottom bar, and writes the `.webm` files into this folder. Each recording is
capped at about 90 seconds and 5 MB.

If a section's `.webm` is missing, the /getting-started page falls back to the placeholder text
plus the captions description — nothing on the page breaks.

Videos are **static assets shipped with the app**. They are not stored in Supabase and do not
belong in the repository's git history unless you are ready to commit binary blobs; they can
also be generated freshly whenever the recorder runs.

## Adding a custom video per section

Agency owners can also paste their own YouTube / Vimeo / Loom / Wistia link on any section
under /getting-started. That override is saved server-side in
`public.agency_getting_started.video_overrides` (see the `agency-getting-started` edge
function) and takes precedence over the local `.webm`.
