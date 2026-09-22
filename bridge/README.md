# The Armature bridge (site contract v1.1)

> **Newer sites use the kit.** The `kit/` folder (site contract v2) contains this bridge's
> successor plus the page builder's renderer, widgets and CSS generator. A site that wants
> drag-and-drop editing copies `kit/` instead of this file; see docs/SITE_CONTRACT.md,
> "Site contract v2". This file stays for sites that only need click-to-edit content.

`armature-bridge.ts` is the one file a site adds to support **visual editing** (site
contract v1.1, optional). It has no dependencies. Copy it into your site's source
folder, create the bridge once, and read every editable value through it.

## What it does

Nothing, on a normal visit. It only wakes up when all three hold:

1. the page is inside an iframe,
2. the URL has `?armature=edit`,
3. the window that embeds the page is one of the `allowedOrigins` you configure.

In that case the editor (the parent window) and the bridge shake hands: the editor
sends `armature:hello` with a one-off nonce, the bridge answers `armature:ready` only to
an allowed origin, and every later message carries that nonce. Both sides check
`event.origin` and `event.source` on every message. The bridge never evaluates code and
never injects HTML: everything it writes into the page is text.

In edit mode the bridge:

- appends an invisible marker (zero-width characters, the encoding used by
  `@vercel/stega`) to each text value your content hook renders, finds those markers
  in the DOM, records which element shows which field, and strips the markers again;
- matches `<img>` (src and srcset), `<iframe>`, `<video>` and plain `<a href>` elements to
  image, video and URL fields by value;
- reports hover and selection rectangles so the editor can draw the outlines above the
  iframe (they are never drawn inside your page);
- lets the person type straight into a text element (`contenteditable="plaintext-only"`;
  Enter commits a single-line field, Esc cancels, Ctrl/Cmd+Enter commits a paragraph);
- re-renders the site with the draft values the editor pushes, through a store you read
  with `useSyncExternalStore`;
- reports the current route so the editor's page switcher follows the site, and keeps a
  plain click from leaving the page (Ctrl/Cmd+click follows the link).

## Add it to a Vite + React site

```ts
// src/lib/content.ts
import { useSyncExternalStore } from "react";
import schema from "../../content/schema.json";
import content from "../../content/pages.json";
import { createArmatureBridge } from "./armature-bridge";

export const armature = createArmatureBridge({
  allowedOrigins: ["https://armature-sites.netlify.app"], // the dashboard's origin, exactly
  schema,
  content,
});

export function usePageCopy(slug: string) {
  // Re-renders this component when the editor pushes a draft. Outside edit mode it is a no-op.
  useSyncExternalStore(armature.subscribe, armature.getSnapshot, armature.getSnapshot);
  return {
    text: (section: string, field: string) => armature.text(slug, section, field),
    plain: (section: string, field: string) => armature.plain(slug, section, field),
    link: (section: string, field: string) => armature.link(slug, section, field),
    image: (section: string, field: string) => armature.image(slug, section, field),
    list: (section: string, field: string) => armature.list(slug, section, field),
  };
}
```

```tsx
function Hero() {
  const copy = usePageCopy("home");
  const cta = copy.link("hero", "cta");
  return (
    <section>
      <h1>{copy.text("hero", "title")}</h1>
      <p>{copy.text("hero", "body")}</p>
      <img src={copy.image("hero", "image")} alt={copy.plain("hero", "image_alt")} />
      <a href={cta.href}>{cta.label}</a>
    </section>
  );
}
```

Rules of thumb:

- `text()` and the strings from `list()` are for text rendered in the body. They carry the
  marker in edit mode.
- `plain()` is for anything that ends up in an attribute or in `<head>`: `alt`, `title`,
  `aria-label`, `<title>`, `<meta>`. Never put a `text()` value there.
- `image()` and link `href`s are never marked. The bridge finds images by their `src`.
- If the bridge cannot find an element (text built from several fields, text inside an
  SVG, a background image), put `data-armature-field="home.hero.title"` on the element
  you want selected. A list item field is `home.faq.items[2].question`.
- With a client-side router, pass `navigate` so the editor's page switcher does not reload
  the whole site: `createArmatureBridge({ ..., navigate: (path) => router.navigate(path) })`.

## Headers

The site must let the dashboard embed it. If you send `X-Frame-Options`, remove it for
the dashboard, and add a Content-Security-Policy that allows the dashboard as an
ancestor, for example on Netlify:

```
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "frame-ancestors 'self' https://armature-sites.netlify.app"
```

## Versions

`BRIDGE_VERSION` is the version of this file; `PROTOCOL_VERSION` is the message
protocol both sides must agree on. The editor refuses a bridge that speaks a different
protocol and says so. The full message list is in `docs/SITE_CONTRACT.md`.
