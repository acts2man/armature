# The site contract (v1, with the optional v1.1 visual-editing addition and the v2 page builder)

This is what a website repository must contain before Armature can connect to it and let people edit it. It is short on purpose: two JSON files and one folder. Everything the dashboard does, from the "Add a site" checklist to the Publish button, is defined by the rules on this page, and the same rules are enforced in code by the `shared/` folder of this repository, which both the browser and the edge functions import.

If you are the developer of a site, you do this part once. The agency and its clients never touch these files by hand again: the dashboard reads and writes them.

## What a connectable repository contains

```
content/schema.json          which fields exist, on which pages, of which type
content/pages.json           what those fields currently say
public/assets/uploads/       where pictures uploaded through the dashboard are committed
```

The repository must be on GitHub, and the branch the dashboard is pointed at must contain both files. `public/assets/uploads/` can start empty (commit a `.gitkeep` file in it so the folder exists).

## content/schema.json — the editable-field map

The file is one JSON object:

```json
{ "armatureContract": 1, "pages": [ ... ] }
```

- `armatureContract` must be the **number** `1`. The dashboard refuses any other value, so a future, incompatible version of the contract can never be edited by an older dashboard.
- `pages` is a non-empty array of page definitions.

### Page

| Key | Required | Rules |
| --- | --- | --- |
| `slug` | yes | Lowercase letters, digits and hyphens, starting with a letter or digit (`home`, `about-us`). Unique across the file. It is the key used in `pages.json` and in the editor's URL. |
| `label` | yes | Human name shown in the dashboard ("Home", "Header & footer"). |
| `path` | yes | The page's live path, starting with `/` (`/`, `/contact/`). Used for the "View live page" link. |
| `description` | no | One sentence shown under the page name. |
| `sections` | yes | An array of sections. It may be empty, but then nothing on the page is editable (reported as a warning). |

### Section

| Key | Required | Rules |
| --- | --- | --- |
| `key` | yes | Lowercase letters, digits and underscores, starting with a letter or digit (`hero`, `faq`, `seo`). Unique within the page. |
| `label` | yes | Shown as the section tab in the editor. |
| `fields` | yes | An array of fields. It may be empty, but the dashboard reports an empty section as a warning. |

### Field

| Key | Required | Rules |
| --- | --- | --- |
| `key` | yes | Lowercase letters, digits and underscores, starting with a letter or digit (`title`, `body`, `image_alt`). Unique within the section. |
| `label` | yes | Shown above the control in the editor. Write it for the client, not the developer ("Headline", not "h1"). |
| `type` | yes | One of `text`, `textarea`, `image`, `video`, `url`, `link`, `list`. |
| `itemFields` | only for `list` | A non-empty array describing each repeatable item: `{ "key", "label", "type" }` where `type` is one of `text`, `textarea`, `image`, `url`. Keys are lowercase letters, digits and underscores, starting with a letter or digit, and unique within the list. A non-list field must not have `itemFields`. |
| `help` | no | A short hint shown under the control. |

### What each field type means

| Type | In the editor | The value in `pages.json` | Rules enforced on publish |
| --- | --- | --- | --- |
| `text` | A single-line input | a string | at most 300 characters |
| `textarea` | A multi-line input | a string | at most 5000 characters |
| `image` | A path input plus a file picker. A picked file is resized in the browser and committed under `public/assets/uploads/` | a string path such as `/assets/hero.webp` | must be empty or start with `/assets/`, must not contain `..`, at most 2000 characters |
| `video` | A URL input (for example a YouTube, Vimeo or Wistia embed URL) | a string | must be empty or start with `https://`, `http://`, `mailto:`, `tel:` or `/`; at most 2000 characters |
| `url` | A URL input | a string | same rules as `video` |
| `link` | Two inputs: the visible label and the destination | `{ "label": "...", "href": "..." }` | label at most 300 characters; `href` follows the `url` rules |
| `list` | Repeatable items with Add, Remove, Move up, Move down | an array of objects, each carrying every `itemFields` key as a string | at most 100 items; each item field follows its type's rules above; an item may not carry keys the schema does not declare |

`javascript:` and `data:` destinations, protocol-relative `//host` URLs, and remote image URLs are rejected. That is deliberate: an editor can never inject a script or point the site at someone else's server.

### The `shared` page

By convention the page with slug `shared` holds content used on every page: the header (logo, navigation) and the footer. The dashboard treats it like any other page and lists it as "Header & footer" (or whatever `label` you give it). If there is no `shared` page the site still connects (every checklist item passes); the dashboard shows a note on the site's pages list and in the editor saying that header and footer content will not be editable.

## content/pages.json — the content

One JSON object keyed by page slug, then section key, then field key:

```json
{ "<slug>": { "<section>": { "<field>": <value> } } }
```

Rules:

- **Every field the schema declares must be present** with a value of the right shape (see the table above). A missing field or a wrong shape is an error: "Add a site" refuses to connect, and the editor refuses to publish until the repository is fixed.
- Content the schema does not declare is allowed and is left untouched, but the dashboard reports it as a warning, because the editor cannot reach it.
- **Canonical form.** Armature always writes the file with object keys sorted alphabetically at every depth, arrays in their existing order (lists are ordered content), two-space indentation, and a trailing newline. It is exactly `JSON.stringify(sorted, null, 2) + "\n"`. Keep the file in this form when you edit it by hand; otherwise the next publish rewrites the whole file and the diff is noise.
- Encode the file as UTF-8. Any Unicode text is fine ("©", curly quotes, emoji).

## public/assets/uploads/ — pictures

When someone picks a picture for an `image` field, the browser resizes it first (WebP, or JPEG if the browser cannot encode WebP; longest edge at most 2000 pixels; at most 3 MB; PNG, JPEG and WebP originals are accepted) and the publish commits it as

```
public/assets/uploads/<page-slug>-<timestamp>-<safe-file-name>.<webp|png|jpg>
```

and sets the field to `/assets/uploads/<that file>`. Your site must serve the `public/` folder at the web root so that `/assets/uploads/...` resolves. That is the default for Vite, Next.js, Astro and most React setups. Do not rename or delete files in this folder by hand: the content file points at them.

Pictures uploaded from the dashboard's Media Library land here too, under their own (made-safe,
made-unique) file names; a deletion from the library removes the file and its alt text from
`content/media.json` in the same commit.

## How a site should read its content

Import the JSON at build time, so the text is baked into the built HTML and the site renders correctly with no network request:

```ts
// src/lib/content.ts
import content from "../../content/pages.json";

type LinkValue = { label: string; href: string };
type ListValue = Record<string, string>[];
type ContentValue = string | LinkValue | ListValue;
const tree = content as Record<string, Record<string, Record<string, ContentValue>>>;

export const text = (slug: string, section: string, field: string): string => {
  const value = tree[slug]?.[section]?.[field];
  return typeof value === "string" ? value : "";
};

export const link = (slug: string, section: string, field: string): LinkValue => {
  const value = tree[slug]?.[section]?.[field];
  return value && typeof value === "object" && !Array.isArray(value) ? value : { label: "", href: "/" };
};

export const list = (slug: string, section: string, field: string): ListValue => {
  const value = tree[slug]?.[section]?.[field];
  return Array.isArray(value) ? value : [];
};
```

Keep one helper like this and read everything through it. Do not fetch `pages.json` at runtime: a published change would then flash in after the page is on screen and would be invisible to search engines, which is exactly the problem the git-first model removes.

## What a publish does

1. The editor sends only the fields that changed on one page, plus any new pictures, plus the commit it loaded the content from.
2. The edge function checks the signed-in person may edit the site, validates every field against `content/schema.json` at the branch head, and refuses anything that breaks the rules above. Nothing is written yet.
3. It has already read the current `content/pages.json` alongside the schema. If the branch has moved since the editor loaded, it reads the file at the editor's commit (if that commit can no longer be read, the publish is refused and the editor is told to reload) and works out which fields the other commit changed. Different fields: the changes merge. The same field: the publish is refused, the editor is told which fields, and nothing is written.
4. It merges the changes, runs the whole-file check on the result, and refuses to commit if the file would be invalid. It also refuses, writing nothing, if the merged file would be identical to the committed one and no new pictures were added.
5. It makes **one commit** on the configured branch containing `content/pages.json` and any new files under `public/assets/uploads/`, with the message `Content: <page label> updated by <email>`. The branch is updated without force, so GitHub itself refuses anything that is not a fast-forward.
6. Your host rebuilds the site on the push. With Netlify that is automatic and usually takes one to three minutes.

## What "Add a site" checks

In order, stopping at the first failure and explaining the fix:

1. The GitHub App secrets reached the function.
2. The App's private key can be read.
3. The App is installed on the repository.
4. That installation is linked to the agency.
5. GitHub issued an access token for the repository (scoped to that one repository).
6. The App can write to the repository.
7. The branch exists.
8. `content/schema.json` is present, valid JSON, and follows this contract.
9. `content/pages.json` is present, valid JSON, and has a well-shaped value for every field.

The same list runs behind the **Check connection** button on every site, prefixed by "you are signed in" and "your account can edit this site".

## Minimal example

These two files, plus an empty `public/assets/uploads/` folder (with a `.gitkeep`), are enough to connect a site. They are copied verbatim from `shared/example/` in this repository, and the test suite asserts that they are valid.

### `content/schema.json`

```json
{
  "armatureContract": 1,
  "pages": [
    {
      "slug": "shared",
      "label": "Header & footer",
      "path": "/",
      "description": "Logo, navigation and footer text used on every page.",
      "sections": [
        {
          "key": "header",
          "label": "Header",
          "fields": [
            { "key": "logo", "label": "Logo", "type": "image" },
            { "key": "logo_alt", "label": "Logo alt text", "type": "text" },
            {
              "key": "nav",
              "label": "Navigation links",
              "type": "list",
              "itemFields": [
                { "key": "label", "label": "Label", "type": "text" },
                { "key": "href", "label": "Destination", "type": "url" }
              ]
            }
          ]
        },
        {
          "key": "footer",
          "label": "Footer",
          "fields": [
            { "key": "blurb", "label": "Footer paragraph", "type": "textarea" },
            { "key": "copyright", "label": "Copyright line", "type": "text" },
            { "key": "privacy", "label": "Privacy policy link", "type": "link" }
          ]
        }
      ]
    },
    {
      "slug": "home",
      "label": "Home",
      "path": "/",
      "description": "The front page.",
      "sections": [
        {
          "key": "hero",
          "label": "Hero",
          "fields": [
            { "key": "title", "label": "Headline", "type": "text" },
            { "key": "body", "label": "Intro paragraph", "type": "textarea" },
            { "key": "image", "label": "Hero photo", "type": "image" },
            { "key": "image_alt", "label": "Hero photo alt text", "type": "text" },
            {
              "key": "video",
              "label": "Video embed URL",
              "type": "video",
              "help": "Paste the embed URL from YouTube, Vimeo or Wistia. Leave empty for no video."
            },
            { "key": "cta", "label": "Button", "type": "link" }
          ]
        },
        {
          "key": "faq",
          "label": "FAQ",
          "fields": [
            { "key": "heading", "label": "Heading", "type": "text" },
            {
              "key": "items",
              "label": "Questions",
              "type": "list",
              "itemFields": [
                { "key": "question", "label": "Question", "type": "text" },
                { "key": "answer", "label": "Answer", "type": "textarea" }
              ]
            }
          ]
        },
        {
          "key": "seo",
          "label": "SEO & sharing",
          "fields": [
            { "key": "title", "label": "Browser / search title", "type": "text" },
            { "key": "description", "label": "Meta description", "type": "textarea" },
            { "key": "image", "label": "Social share image URL (https)", "type": "url" }
          ]
        }
      ]
    }
  ]
}
```

### `content/pages.json`

```json
{
  "home": {
    "faq": {
      "heading": "Questions people ask",
      "items": [
        {
          "answer": "Yes. Every plan includes a two-week trial with no card required.",
          "question": "Can I try it first?"
        },
        {
          "answer": "Email us and a real person replies within one business day.",
          "question": "How do I get help?"
        }
      ]
    },
    "hero": {
      "body": "Acme helps small teams keep their website current without waiting on a developer.",
      "cta": {
        "href": "/contact/",
        "label": "Talk to us"
      },
      "image": "/assets/hero.webp",
      "image_alt": "Two people reviewing a website on a laptop",
      "title": "Keep your site current",
      "video": ""
    },
    "seo": {
      "description": "Acme keeps small-business websites current, without a developer on call.",
      "image": "",
      "title": "Acme | Keep your site current"
    }
  },
  "shared": {
    "footer": {
      "blurb": "Acme is a small studio in Sacramento, California.",
      "copyright": "© 2026 Acme. All rights reserved.",
      "privacy": {
        "href": "/privacy/",
        "label": "Privacy policy"
      }
    },
    "header": {
      "logo": "/assets/logo.svg",
      "logo_alt": "Acme",
      "nav": [
        {
          "href": "/",
          "label": "Home"
        },
        {
          "href": "/contact/",
          "label": "Contact"
        }
      ]
    }
  }
}
```

## Site contract v1.1: visual editing (optional)

Version 1.1 adds one optional capability on top of everything above: the dashboard can
open the live site in a frame and let people edit it in place (click a headline and type,
click a picture to replace it, drag FAQ items into a new order). A site that does not add
it still connects and still has the form editor; the visual editor simply says "This site
isn't set up for visual editing yet" and points to the form editor.

`armatureContract` stays `1`. Nothing in `schema.json` or `pages.json` changes. The
addition is one file and one header.

### What the site adds

1. **The bridge.** Copy `bridge/armature-bridge.ts` from this repository into the site's
   source (it has no dependencies; `bridge/README.md` explains it) and read every editable
   value through it:

   ```ts
   import schema from "../../content/schema.json";
   import content from "../../content/pages.json";
   import { createArmatureBridge } from "./armature-bridge";

   export const armature = createArmatureBridge({
     allowedOrigins: ["https://armature-sites.netlify.app"], // the dashboard's exact origin
     schema,
     content,
   });
   ```

   Then, in a component, subscribe with `useSyncExternalStore(armature.subscribe,
   armature.getSnapshot, armature.getSnapshot)` and render `armature.text(slug, section,
   field)`, `armature.link(...)`, `armature.image(...)`, `armature.list(...)`. Use
   `armature.plain(...)` for anything that goes into an attribute or `<head>` (alt text,
   `<title>`, `<meta>`). The demo in `examples/demo-site/src/content.ts` is a complete,
   tested `usePageCopy` hook.

2. **The frame header.** The site must let the dashboard embed it. Do not send
   `X-Frame-Options`; send a Content-Security-Policy that names the dashboard:

   ```
   Content-Security-Policy: frame-ancestors 'self' https://armature-sites.netlify.app
   ```

3. **A route per page.** The `path` of each page in `schema.json` (already required) is
   what the editor loads and what it matches against the route the bridge reports, so the
   page switcher and the site stay in step. Paths are compared with trailing slashes
   ignored (`/about` and `/about/` are the same page). When two pages share a path (the
   `shared` page conventionally uses `/`), the editor keeps the non-shared page selected.

That is all. The bridge, not the site, does the rest.

### How the bridge finds fields

- Every text value rendered through `armature.text()` (and the text-type item fields from
  `armature.list()`) carries an invisible marker in edit mode: zero-width characters in the
  same encoding as the MIT `@vercel/stega` package, holding `{ "armature": "<field path>" }`.
  A field path is `slug.section.field`, or `slug.section.field[index].itemKey` for a list
  item. The bridge finds the markers, records which element shows which field, and removes
  them from the DOM. Outside edit mode no marker is ever added.
- Images are matched by value: an `<img>` whose `src` (or a `srcset` candidate) equals an
  image field's value belongs to that field. `<iframe>`, `<video>` and `<source>` match
  video/url fields the same way; an `<a href>` matches a url field only when the value is
  an absolute `http(s)` address.
- A link field's label is marked; the bridge takes the destination from the enclosing
  `<a>`.
- Anything the marker cannot reach (text assembled from several fields, a background
  image, an SVG) can be mapped by hand with `data-armature-field="home.hero.title"` on the
  element to select.
- Markers are never written into attribute values, `<title>`, `<meta>` or `<head>`; the
  bridge also strips any marker it finds in `document.title` as a safety net.

### When the bridge is active

Only when all three hold: the page is in an iframe, the URL has `?armature=edit`, and the
embedding window's origin is in `allowedOrigins`. Otherwise the bridge is inert: no
listeners, no markers, no messages. The dashboard's origin is the only thing in the
allowlist; never put `*` there.

### The handshake and the messages

Every message is `{ type: "armature:<name>", nonce, ...payload }` sent with
`postMessage` to an exact origin, never `*`. The editor mints a random nonce for each
iframe load and sends `armature:hello`; the bridge answers only if `event.origin` is in
its allowlist and `event.source` is its parent window, and it echoes the nonce. From then
on both sides drop any message whose origin, source window or nonce is wrong. The editor
waits 10 seconds for `armature:ready` and then explains what went wrong. Protocol version
1 (`VISUAL_PROTOCOL_VERSION` in `shared/visualProtocol.ts`, `PROTOCOL_VERSION` in the
bridge; a mismatch is reported to the person rather than guessed around).

| Message | Direction | Payload | Meaning |
| --- | --- | --- | --- |
| `armature:hello` | editor → bridge | `protocolVersion` | Start of a session; carries the nonce every later message must echo. |
| `armature:ready` | bridge → editor | `protocolVersion`, `bridgeVersion`, `route`, `title` | The bridge is active and accepts the nonce. |
| `armature:fields:map` | bridge → editor | `fields: MappedField[]`, `viewport` | Every mapped element with its path, kind (`text`, `image`, `link`), tag, rectangle in the frame's viewport, and whether it can be typed into in place. Sent after `ready`, after every DOM change and after every draft. |
| `armature:hover` | bridge → editor | `field \| null` | The pointer is over a mapped element (or none). Re-sent with fresh rectangles on scroll and resize, once per animation frame. |
| `armature:select` | bridge → editor | `field \| null`, `source` | The person clicked a mapped element (or empty space). `source` is `canvas` for a click, `editor` when answering a select request, `refresh` for a fresh rectangle of the same selection after scrolling or a DOM change. |
| `armature:select` | editor → bridge | `path \| null`, `scroll?` | Select (and scroll to) the first element for that path, for example from the Layers panel. |
| `armature:edit:start` | editor → bridge | `path` | Begin typing in place on that element. |
| `armature:edit:start` | bridge → editor | `path`, `value` | In-place editing began (from a second click, a double-click, Enter, or the editor's request). |
| `armature:edit:input` | bridge → editor | `path`, `value` | The text changed while typing. |
| `armature:edit:commit` | bridge → editor | `path`, `value` | Enter (single-line), Ctrl/Cmd+Enter (paragraph) or blur: the value is final. |
| `armature:edit:cancel` | bridge → editor | `path` | Esc: the original text is restored. |
| `armature:draft:apply` | editor → bridge | `fields: { "<slug.section.field>": value }` | Whole field values (lists included) the bridge merges over the built-in content and re-renders through the store. The editor sends every field of the site, published values and draft alike, so the frame matches the repository even before the host has rebuilt. A field being typed into is held back until the typing ends. |
| `armature:route:changed` | bridge → editor | `route`, `title` | The site moved to another page (client-side router or a reload). |
| `armature:navigate` | editor → bridge | `path` | Go to that page, keeping the edit flag. |
| `armature:navigate` | bridge → editor | `href`, `external`, `followed` | A link was clicked. `followed` is true for Ctrl/Cmd+click (and any click in preview); false for a plain click in edit mode, which the editor answers with a hint. External links are never followed inside the editor. |
| `armature:viewport` | bridge → editor | `viewport` | Size and scroll position of the frame, once per animation frame while scrolling. |
| `armature:mode` | editor → bridge | `mode: "edit" \| "preview"` | Preview turns off hover, selection and click interception so the site behaves normally. |
| `armature:error` | bridge → editor | `code`, `message` | `protocol_mismatch`, `edit_failed` or `navigate_failed`, with a sentence for the person. |
| `armature:key` | bridge → editor | `key` | A shortcut pressed while the frame had focus (`undo`, `redo`, `publish`, `next`, `help`), so Ctrl/Cmd+Z, Ctrl/Cmd+S, Tab and ? work wherever the person clicked last. |

Reserved, not sent by anything yet: `armature:tokens:*` (Stage 2, colours and fonts from
design tokens) and `armature:sections:*` (Stage 3, adding, moving and hiding sections).

The bridge never evaluates code, never sets `innerHTML`, and never follows a link to
another origin inside the editor. Everything it writes into the page is text.

### Publishing from the visual editor

The visual editor keeps one draft per site across all of its pages and publishes it with
`content-publish-batch`: one request carrying every changed field and every new picture
for every page, and **one commit** for all of it. The request is validated exactly as a
form-editor publish is (each field against the schema, the whole merged file before the
commit), conflicts are detected per field across all the pages in the batch, nothing is
force-pushed, and one `publishes` row records every field that changed
(`slug.section.field`) with the page slugs joined by commas. A list item picture is sent
with its `index` and `itemKey`; the function writes the committed path into that item.

## Site contract v2: page builder (optional)

Version 2 turns the visual editor into a page builder: people drag widgets onto the real
site, nest them in containers, type rich text in place, style elements per device, and
publish layouts, global colours and fonts, new pages, content and pictures in one commit.
It is additive: `armatureContract` stays `1`, `schema.json` and `pages.json` do not
change, a v1.1 site keeps working (the editor tells agency staff "This site uses an older
kit version, update it to use the page builder"), and a page without a layout file behaves
exactly as before.

### What the site adds

1. **The kit.** Copy the `kit/` folder of this repository into the site as
   `src/lib/armature-kit/` (React is its only dependency; `kit/README.md` explains it and
   it replaces `armature-bridge.ts`) and create it once:

   ```ts
   // src/lib/armature.ts
   import { createArmatureKit } from "./armature-kit";
   import schema from "../../content/schema.json";
   import content from "../../content/pages.json";
   import siteKit from "../../content/site-kit.json"; // optional; the default kit applies without it

   export const armature = createArmatureKit({
     allowedOrigins: ["https://armature-sites.netlify.app"], // the dashboard's exact origin
     schema,
     content,
     siteKit,
     layouts: import.meta.glob("../../content/layouts/*.json", { eager: true }),
     navigate: (path) => router.navigate(path), // optional, for client-side routers
   });
   ```

   The kit keeps the whole v1.1 content API (`text`, `plain`, `link`, `image`, `list`,
   `subscribe`, `getSnapshot`), so a v1.1 site upgrades by changing one import.

2. **Site sections.** Register each hand-coded section the editor may place, move, hide or
   wrap, and render coded pages through a slot:

   ```tsx
   armature.registerSiteSection("hero", { label: "Hero", component: Hero });
   armature.registerSiteSection("faq", { label: "FAQ", component: Faq, repeatable: true });

   function Home() {
     return <ArmatureSlot slug="home" defaults={["hero", "faq"]} />;
   }
   ```

   Without a layout file the slot renders `defaults` in order, exactly as the page rendered
   before. With one, the layout decides the order and what sits between the sections. Text
   and pictures inside a section keep editing through the v1.1 field system.

3. **Builder-only pages.** Place `<ArmatureRoute fallback={<NotFound />} />` before the
   site's catch-all route. Pages created in the editor are served at their `path` from
   `content/layouts/<slug>.json`; anything else renders the fallback. `useBuilderPages()`
   lists them for the site's own navigation.

4. **The frame header**, as in v1.1 (`Content-Security-Policy: frame-ancestors 'self' <dashboard origin>`).

5. **Forms (only if the site uses the Form widget).** Pass the dashboard's form function
   and the site's id (the id in the site's dashboard address) to the kit:

   ```ts
   createArmatureKit({ ...,
     forms: { endpoint: "https://<project>.supabase.co/functions/v1/form-submit", siteId: "<site id>" },
   });
   ```

   Without it a form shows "This form is not connected yet" and never sends. The function
   trusts nothing from the page: it reads the form's fields from the published layout,
   drops unknown fields, rate limits each visitor and each site, and ignores entries whose
   hidden honeypot field is filled or that arrive faster than a person types.

6. **Content-Security-Policy, if the site sends one.** The widget library reaches outside
   the site only when asked: `connect-src` the form endpoint above; `frame-src`
   `https://www.youtube-nocookie.com https://player.vimeo.com https://maps.google.com
   https://www.google.com` for videos (after a visitor presses play) and maps; `style-src`
   `https://fonts.googleapis.com` and `font-src https://fonts.gstatic.com` for Google fonts.
   The HTML widget (agency only) runs in a sandboxed `srcdoc` frame with its own origin.

7. **Page settings hooks.** Mark the site's header and footer with `data-armature-chrome`
   and a coded page's visible title with `data-armature-page-title`. A page set to "Full
   canvas" puts `data-armature-canvas="full"` on `<html>` and one set to "Hide the page
   title" puts `data-armature-hide-title` there; the kit's base CSS then hides the marked
   elements. Unmarked sites simply keep their header, footer and title.

### Upgrading a v1.1 site to the kit

1. Copy `kit/` from this repository into `src/lib/armature-kit/` and delete
   `armature-bridge.ts`.
2. Replace the bridge setup with `createArmatureKit({...})` as in step 1 above, keeping
   the same `allowedOrigins`; every `text`/`plain`/`link`/`image`/`list` call keeps working.
3. Register the coded sections and render each coded page through `<ArmatureSlot>` with
   its sections as `defaults` (step 2), so the page looks exactly as before.
4. Add `<ArmatureRoute fallback={...} />` before the catch-all route (step 3).
5. Add `data-armature-chrome` to the header and footer, and `data-armature-page-title` to
   page titles (step 7).
6. If the site uses forms or sends a Content-Security-Policy, do steps 5 and 6.
7. Commit an empty `content/layouts/` (a `.gitkeep`) if the site's bundler needs the folder
   to exist. `content/site-kit.json` is optional; the first save from Site settings writes it.
8. Deploy, open the site in the visual editor as agency staff and check that the builder
   switches on (protocol 2). Then choose the clients' editing level on the site overview.

### The widget library

Beyond the core widgets (Container, Grid, Heading, Text Editor, Image, Button, Spacer,
Divider), the kit renders Icon, Video (YouTube, Vimeo or a file; a click-to-load facade
that contacts the host only when a visitor presses play), Icon Box, Image Box, Icon List,
Accordion, Toggle, Tabs, Testimonial, Star Rating, Counter, Progress Bar, Alert, Social
Icons, Image Gallery (with a lightbox), Image Carousel, Google Map, Call to Action, Price
Table, Countdown (to a date, or per visitor), Flip Box, Blockquote, Table of Contents,
Form, and the agency-only HTML embed. Interactive widgets follow the WAI-ARIA patterns
(buttons with `aria-expanded`, tablists with arrow keys, a native `<dialog>` lightbox) and
stop moving for visitors who ask for reduced motion. Their props are in `kit/types.ts` and
their rules in `shared/builder/widgetSchemas.ts`. A newer widget an older kit does not know
is skipped on the site (the editor shows "Unsupported element").

### Files the editor writes

```
content/layouts/<pageSlug>.json    one layout per page (coded pages: optional; builder pages: always)
content/trash/<pageSlug>.json      builder pages in the bin: moved here as they are by "Trash" on the Pages screen, moved back by "Restore"; the site never renders them
content/site-kit.json              global colours, fonts, typography and button presets, container defaults, breakpoints
content/media.json                 default alt text per picture, from the media library
public/assets/uploads/             pictures, as in v1
```

A layout is `{ version: 1, pageSlug, path, label?, seo?, pageSettings?, root: Element[] }`.
An element is `{ id, type, label?, props, style, advanced, children?, locked?, meta }`; ids
are eight characters of `[a-z0-9]` and become the CSS class `.ae-<id>`. Any style or
advanced value may be `{ desktop, tablet?, mobile? }` (tablet inherits desktop, mobile
inherits tablet); sizes are `{ value, unit }`; colours, fonts, typography and button values
may be literals or kit references such as `kit:color.primary`, `kit:font.heading`,
`kit:type.h2`, `kit:button.primary`. The full model is in `kit/types.ts`, the validation
rules in `kit/validate.ts` (the same code runs in the site, the dashboard and the publish
function), and the design notes in [BUILDER_SPEC.md](BUILDER_SPEC.md). Limits: a layout
file under 2 MB, nesting at most 20 deep, at most 5000 elements per page. One bad value
never takes a page down: a setting the validator cannot read is ignored and reported
(page, element, setting, value found, what is allowed); an element it cannot read is
shown as "Unsupported element" in the editor and skipped on the site; the page and the
site kit always load. Unread values stay in the file exactly as they were until someone
changes that setting.

### How the kit renders

- `<ArmaturePage>` generates one stylesheet per page from the tree and the kit and mounts
  it as a `<style>` text node: `.ae-root .ae-<id>.ae-<id> { ... }` (the element class is
  doubled so an element's own settings outrank any legacy class attached through Advanced >
  CSS classes, whatever order the site's stylesheet loads in), media queries at the kit
  breakpoints carrying only each device's own values, `:hover` rules, and the kit as
  custom properties on `.ae-root` (`--ae-color-primary`, `--ae-font-heading`,
  `--ae-content-width`, ...). Nothing leaks outside `.ae-root`, so the site's own CSS is
  never touched.
- Semantic HTML only, no `innerHTML`. Links may only use https, http, mailto, tel, a
  site path or a fragment; pictures a site path or https. Custom CSS is scoped to the
  element and stripped of `@import`, `javascript:`, `expression(` and off-site `url()`.
- Rich text is stored as TipTap-compatible JSON and rendered by the kit's own small
  whitelist renderer. Icons are saved as SVG nodes, so the site needs no icon library.
- Fonts: the kit loads the fonts listed in `site-kit.json` under `fonts.custom` with
  `"source": "google"` as one `<link rel="stylesheet">` to `fonts.googleapis.com` in the
  document head (family names of letters, digits and spaces only). A site with a
  Content-Security-Policy must allow `https://fonts.googleapis.com` in `style-src` and
  `https://fonts.gstatic.com` in `font-src`, or list no Google fonts and load its own.
- A widget's Style values land on what the visitor sees: a button's on its link
  (`.ae-<id>.ae-<id> .ae-btn`), an image's on the picture (`.ae-<id>.ae-<id> img`),
  everything else on the element's own box. Advanced spacing and size always apply to the
  element's box, and the doubled element class means these win over a legacy CSS class.
- Images carry `width` and `height`; the first picture on a page is eager with a high
  fetch priority, the rest lazy. Entrance animations use an IntersectionObserver and are
  skipped under `prefers-reduced-motion`.
- Public visitors never run the bridge: it activates only inside the editor's iframe,
  with `?armature=edit`, from an allowlisted origin, after a nonce handshake.

### Protocol 2

The editor says hello with `protocolVersion: 1` and `wants: 2`. A v1.1 bridge answers
`ready` with protocol 1 (content editing only); a v2 kit answers with protocol 2 and,
besides every v1 message, exchanges these (all with the nonce, origin and source checks
of v1):

| Message | Direction | Meaning |
| --- | --- | --- |
| `armature:ready` | kit → editor | Adds `kitVersion`, `sections` (registered site sections), `slots` (mounted slots with their defaults) and `layouts` (slugs the site was built with). |
| `armature:layout:apply` | editor → kit | The draft: every layout (null = deleted) and the kit. The kit re-renders through its store. |
| `armature:elements:map` | kit → editor | Every builder element with its id, type, parent, page, border box, computed padding and margin, and for images/containers the inner box. Sent with `fields:map` and once per animation frame while scrolling. |
| `armature:element:hover`, `armature:element:select` | both ways | Hover and selection by element id (`source` as in v1). Alt-click selects the parent. |
| `armature:element:contextmenu` | kit → editor | A right-click on an element, with its position. |
| `armature:slot` | kit → editor | The mounted slots and their defaults changed (a route change). |
| `armature:element:edit:start` / `input` / `commit` / `cancel` | kit → editor | In-place editing of a heading or button (a string) or the Text Editor (a rich-text document). |
| `armature:element:edit:start` / `armature:element:edit:stop` | editor → kit | Begin or end in-place editing. |
| `armature:richtext:command` / `armature:richtext:state` | both ways | Formatting commands from the floating toolbar and the marks in force at the caret. |
| `armature:scroll` | editor → kit | Scroll the frame (auto-scroll while dragging). |
| `armature:key` | kit → editor | Adds copy, paste, paste style, duplicate, delete, preview and arrow keys. |

While an element is typed into, the kit's renderer leaves that element's DOM alone (layout
updates keep arriving and render everywhere else), and a rich-text edit stays open while
focus is in the editor's toolbar; the kit restores the last selection before each command.
When the edit ends the kit writes the value into its draft and remounts the element from
it, so the browser's editing markup never survives: what the page shows is always the
stored document rendered by the kit.

### Publishing from the page builder

When a draft touches a layout, the kit, default alt text or a picture added in the
editor, the dashboard publishes through `builder-publish` instead of
`content-publish-batch`. It is one commit on the site's branch holding everything in the
draft: `content/pages.json` for fields, `content/layouts/<slug>.json` for each changed or
new page (a deleted builder page's file is removed), `content/site-kit.json`,
`content/media.json`, and each new picture under `public/assets/uploads/<page>-<hash>.<ext>`
with its data URL in the layout replaced by that path. Before writing it validates every
file with the same validator the kit uses (unread values already in the file are kept
verbatim; new ones are refused), refuses a page address that another page
already uses, and enforces the person's editing level, locked elements and agency-only
widgets against the committed files. If the branch moved since the editor loaded, layouts
merge element by element: separate edits are both kept, the same value changed on both
sides comes back as a named conflict for the person to decide. Nothing is ever
force-pushed. The site then rebuilds as it does for any commit.

## Versioning

This is contract version 1, declared by `"armatureContract": 1`. Version 1.1 (visual editing) and version 2 (the page builder) are purely additive and keep the same number: a site that adds the bridge or the kit still declares `1`, and a site without either still connects. A breaking change will get a new number, and a dashboard will refuse a version it does not understand rather than guess. The bridge file carries `BRIDGE_VERSION` and `PROTOCOL_VERSION` (1); the kit carries `KIT_VERSION` (currently `2.2.0`) and `PROTOCOL_VERSION` (2), negotiated so either side can be older.
