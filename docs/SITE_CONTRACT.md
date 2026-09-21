# The site contract (v1)

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

## Versioning

This is contract version 1, declared by `"armatureContract": 1`. Future versions will be additive where possible; a breaking change will get a new number, and a dashboard will refuse a version it does not understand rather than guess.
