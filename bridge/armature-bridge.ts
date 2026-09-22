/**
 * Armature visual-editing bridge — site contract v1.1 (optional).
 *
 * Copy this ONE file into your site. It has no dependencies. It does nothing at all
 * unless three things are true at once: the page is inside an iframe, the URL has
 * `?armature=edit`, and the window that embeds it is one of `allowedOrigins`. On a
 * normal visit it adds nothing to the page: no listeners, no markers, no messages.
 *
 * In edit mode it:
 *   - appends an invisible marker (zero-width characters, the same encoding as
 *     @vercel/stega) to every text value your content hook renders, so the bridge
 *     can find which element shows which field;
 *   - strips those markers from the DOM again so nothing is ever visible or copied;
 *   - reports hover/selection rectangles to the editor, which draws the outlines;
 *   - lets the person type straight into a text element (contenteditable);
 *   - re-renders the site with draft values the editor pushes, through a store you
 *     read with useSyncExternalStore (or any subscribe/getSnapshot pattern).
 *
 * It never evaluates code and never injects HTML. Text only.
 *
 * Usage (React):
 *
 *   import schema from "../../content/schema.json";
 *   import content from "../../content/pages.json";
 *   import { createArmatureBridge } from "./armature-bridge";
 *
 *   export const armature = createArmatureBridge({
 *     allowedOrigins: ["https://armature-sites.netlify.app"],
 *     schema,
 *     content,
 *   });
 *
 *   export function usePageCopy(slug: string) {
 *     useSyncExternalStore(armature.subscribe, armature.getSnapshot, armature.getSnapshot);
 *     return {
 *       text: (section: string, field: string) => armature.text(slug, section, field),
 *       link: (section: string, field: string) => armature.link(slug, section, field),
 *       image: (section: string, field: string) => armature.image(slug, section, field),
 *       list: (section: string, field: string) => armature.list(slug, section, field),
 *       plain: (section: string, field: string) => armature.plain(slug, section, field),
 *     };
 *   }
 *
 * `text()` and the item strings from `list()` carry the marker in edit mode. Use them
 * for anything rendered as text in the body. Use `plain()` for anything that goes into
 * an attribute, <title>, <meta> or <head>: alt text, meta descriptions, aria labels.
 * `image()` and link `href`s are never marked (they are attributes); the bridge finds
 * images by their src and links by their marked label.
 */

export const BRIDGE_VERSION = "1.1.0";
export const PROTOCOL_VERSION = 1;

const EDIT_PARAM = "armature";
const EDIT_VALUE = "edit";
const FIELD_ATTRIBUTE = "data-armature-field";
const PREFIX = "armature:";

// --- content shapes (mirrors shared/contentFile.ts and shared/schema.ts) ------------

export type LinkValue = { label: string; href: string };
export type ListValue = Record<string, string>[];
export type ContentValue = string | LinkValue | ListValue;
export type ContentTree = Record<string, Record<string, Record<string, ContentValue>>>;

type FieldType = "text" | "textarea" | "image" | "video" | "url" | "link" | "list";
type ItemFieldType = "text" | "textarea" | "image" | "url";

export type SiteSchemaLike = {
  armatureContract: number;
  pages: {
    slug: string;
    path?: string;
    sections: {
      key: string;
      fields: { key: string; type: FieldType; itemFields?: { key: string; type: ItemFieldType }[] }[];
    }[];
  }[];
};

export type ArmatureBridgeConfig = {
  /** Exact origins of the editor that may embed this site, e.g. ["https://armature-sites.netlify.app"]. */
  allowedOrigins: string[];
  /** content/schema.json */
  schema: SiteSchemaLike;
  /** content/pages.json */
  content: ContentTree;
  /**
   * How to move to another page when the editor asks. Default: a full page load that
   * keeps the edit flag. Give a router function here for client-side navigation.
   */
  navigate?: (path: string) => void;
};

export type ArmatureBridge = {
  /** True only in edit mode. Safe to read at any time. */
  readonly active: boolean;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ContentTree;
  /** A text/textarea value, marked in edit mode. */
  text(slug: string, section: string, field: string): string;
  /** The same value with no marker, for attributes and <head>. */
  plain(slug: string, section: string, field: string): string;
  /** A link field. The label is marked in edit mode; the href never is. */
  link(slug: string, section: string, field: string): LinkValue;
  /** An image or url/video field. Never marked. */
  image(slug: string, section: string, field: string): string;
  /** A list. Text-type item fields are marked with their item path in edit mode. */
  list(slug: string, section: string, field: string): ListValue;
  /** Low-level: mark any string with any field path. */
  encode(value: string, path: string): string;
};

// --- stega codec, compatible with @vercel/stega ----------------------------------------
// Four zero-width code points carry two bits each; a run of four U+200B marks the start.

const ZW = [0x200b, 0x200c, 0x200d, 0xfeff] as const;
const ALPHABET = ZW.map((point) => String.fromCodePoint(point)) as [string, string, string, string];
const START = ALPHABET[0].repeat(4);
const STEGA_RUN = new RegExp(`[${ZW.map((point) => `\\u{${point.toString(16)}}`).join("")}]{4,}`, "gu");
const CHAR_TO_BITS: Record<string, number> = Object.fromEntries(ALPHABET.map((char, index) => [char, index]));

export function stegaEncode(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let out = START;
  for (const byte of bytes) {
    out += (ALPHABET[(byte >> 6) & 3] ?? "") + (ALPHABET[(byte >> 4) & 3] ?? "") + (ALPHABET[(byte >> 2) & 3] ?? "") + (ALPHABET[byte & 3] ?? "");
  }
  return out;
}

/** The first payload hidden in `text`, or undefined. */
export function stegaDecode(text: string): unknown {
  const matches = text.match(STEGA_RUN);
  if (!matches) return undefined;
  for (const run of matches) {
    const start = run.indexOf(START);
    if (start < 0) continue;
    const body = Array.from(run.slice(start + START.length));
    const usable = body.length - (body.length % 4);
    const bytes = new Uint8Array(usable / 4);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = ((CHAR_TO_BITS[body[i * 4] ?? ""] ?? 0) << 6) | ((CHAR_TO_BITS[body[i * 4 + 1] ?? ""] ?? 0) << 4) | ((CHAR_TO_BITS[body[i * 4 + 2] ?? ""] ?? 0) << 2) | (CHAR_TO_BITS[body[i * 4 + 3] ?? ""] ?? 0);
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      // not ours; try the next run
    }
  }
  return undefined;
}

/** `text` with every marker removed. */
export function stegaClean(text: string): string {
  return text.replace(STEGA_RUN, "");
}

export const hasStega = (text: string): boolean => {
  STEGA_RUN.lastIndex = 0;
  return STEGA_RUN.test(text);
};

/** The field path hidden in `text`, or null. */
export function decodeFieldPath(text: string): string | null {
  const payload = stegaDecode(text);
  if (payload && typeof payload === "object" && typeof (payload as { armature?: unknown }).armature === "string") {
    return (payload as { armature: string }).armature;
  }
  return null;
}

// --- helpers ------------------------------------------------------------------------------

type Rect = { x: number; y: number; width: number; height: number };
type MappedKind = "text" | "image" | "link";
type MappedField = { path: string; kind: MappedKind; rect: Rect; tag: string; inline: boolean; href?: string };
type Viewport = { width: number; height: number; scrollX: number; scrollY: number };

type ElementInfo = { path: string; kind: MappedKind; inline: boolean; textNode?: Text };

type ParsedPath = { slug: string; section: string; field: string; index?: number; itemKey?: string };
const PATH_PATTERN = /^([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9_]*)\.([a-z0-9][a-z0-9_]*)(?:\[(\d+)\]\.([a-z0-9][a-z0-9_]*))?$/;

function parsePath(path: string): ParsedPath | null {
  const match = PATH_PATTERN.exec(path);
  if (!match) return null;
  const [, slug = "", section = "", field = "", index, itemKey] = match;
  if (index !== undefined && itemKey !== undefined) return { slug, section, field, index: Number(index), itemKey };
  return { slug, section, field };
}

const rootOf = (path: string): string => {
  const parsed = parsePath(path);
  return parsed ? `${parsed.slug}.${parsed.section}.${parsed.field}` : path;
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function isInIframe(): boolean {
  try {
    return typeof window !== "undefined" && window.self !== window.top;
  } catch {
    return true;
  }
}

function hasEditFlag(): boolean {
  try {
    return new URL(window.location.href).searchParams.get(EDIT_PARAM) === EDIT_VALUE;
  } catch {
    return false;
  }
}

function withEditFlag(href: string): string {
  const url = new URL(href, window.location.href);
  url.searchParams.set(EDIT_PARAM, EDIT_VALUE);
  return url.toString();
}

function toRect(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

function rangeRect(node: Text): Rect {
  const range = document.createRange();
  range.selectNodeContents(node);
  const box = range.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

function viewport(): Viewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

const currentRoute = (): string => window.location.pathname;

// --- the bridge ----------------------------------------------------------------------------

export function createArmatureBridge(config: ArmatureBridgeConfig): ArmatureBridge {
  const allowedOrigins = (config.allowedOrigins ?? []).map((origin) => origin.replace(/\/+$/, ""));
  const active = typeof document !== "undefined" && allowedOrigins.length > 0 && isInIframe() && hasEditFlag();

  // Field types by root path, from the schema, so the bridge knows what to mark.
  const fieldTypes = new Map<string, FieldType>();
  const itemTypes = new Map<string, Record<string, ItemFieldType>>();
  for (const page of config.schema?.pages ?? []) {
    for (const section of page.sections ?? []) {
      for (const field of section.fields ?? []) {
        const root = `${page.slug}.${section.key}.${field.key}`;
        fieldTypes.set(root, field.type);
        if (field.type === "list") {
          itemTypes.set(root, Object.fromEntries((field.itemFields ?? []).map((item) => [item.key, item.type])));
        }
      }
    }
  }

  // --- the store ---------------------------------------------------------------------------
  const base: ContentTree = clone(config.content ?? {});
  const draft = new Map<string, unknown>();
  let snapshot: ContentTree = base;
  const listeners = new Set<() => void>();

  const rebuildSnapshot = () => {
    if (draft.size === 0) {
      snapshot = base;
    } else {
      const next = clone(base);
      for (const [root, value] of draft) {
        const parsed = parsePath(root);
        if (!parsed) continue;
        const page = (next[parsed.slug] ??= {});
        const section = (page[parsed.section] ??= {});
        section[parsed.field] = value as ContentValue;
      }
      snapshot = next;
    }
    for (const listener of listeners) listener();
  };

  const rawValue = (slug: string, section: string, field: string): ContentValue | undefined => snapshot[slug]?.[section]?.[field];

  const encode = (value: string, path: string): string => (active ? `${value}${stegaEncode({ armature: path })}` : value);

  const bridge: ArmatureBridge = {
    active,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    text(slug, section, field) {
      const value = rawValue(slug, section, field);
      return typeof value === "string" ? encode(value, `${slug}.${section}.${field}`) : "";
    },
    plain(slug, section, field) {
      const value = rawValue(slug, section, field);
      return typeof value === "string" ? value : "";
    },
    link(slug, section, field) {
      const value = rawValue(slug, section, field);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return { label: encode(value.label ?? "", `${slug}.${section}.${field}`), href: value.href ?? "" };
      }
      return { label: "", href: "" };
    },
    image(slug, section, field) {
      const value = rawValue(slug, section, field);
      return typeof value === "string" ? value : "";
    },
    list(slug, section, field) {
      const value = rawValue(slug, section, field);
      if (!Array.isArray(value)) return [];
      if (!active) return value;
      const root = `${slug}.${section}.${field}`;
      const types = itemTypes.get(root) ?? {};
      return value.map((item, index) => {
        const out: Record<string, string> = {};
        for (const [key, text] of Object.entries(item)) {
          const type = types[key];
          out[key] = type === "text" || type === "textarea" || type === undefined ? encode(text, `${root}[${index}].${key}`) : text;
        }
        return out;
      });
    },
    encode,
  };

  if (!active) return bridge;

  // --- edit mode from here on ------------------------------------------------------------
  let parentOrigin: string | null = null;
  let nonce: string | null = null;
  let mode: "edit" | "preview" = "edit";
  let suppressMutations = 0;

  const send = (message: Record<string, unknown>) => {
    if (!parentOrigin || !nonce) return;
    window.parent.postMessage({ ...message, nonce }, parentOrigin);
  };

  // Mapping state. Text nodes keep their path after the marker is stripped.
  const textPaths = new Map<Text, string>();
  const elementInfo = new Map<Element, ElementInfo>();
  let selected: Element | null = null;
  let hovered: Element | null = null;

  type Editing = { element: Element; path: string; original: string; multiline: boolean; cancelled: boolean; cleanup: () => void };
  let editing: Editing | null = null;
  const heldBack = new Map<string, unknown>();

  const fieldTypeOfPath = (path: string): FieldType | ItemFieldType | undefined => {
    const parsed = parsePath(path);
    if (!parsed) return undefined;
    const root = `${parsed.slug}.${parsed.section}.${parsed.field}`;
    if (parsed.itemKey !== undefined) return itemTypes.get(root)?.[parsed.itemKey];
    return fieldTypes.get(root);
  };

  const kindFor = (element: Element, path: string): MappedKind => {
    if (element instanceof HTMLImageElement || element instanceof HTMLPictureElement || element instanceof HTMLVideoElement || element instanceof HTMLIFrameElement) return "image";
    const type = fieldTypeOfPath(path);
    if (type === "link" || (type === "url" && element instanceof HTMLAnchorElement)) return "link";
    return "text";
  };

  const anchorOf = (element: Element): HTMLAnchorElement | null => element.closest("a");

  const describe = (element: Element, info: ElementInfo): MappedField => {
    const rect = info.textNode && element.childNodes.length > 1 ? rangeRect(info.textNode) : toRect(element);
    const anchor = info.kind === "link" ? anchorOf(element) : null;
    const field: MappedField = { path: info.path, kind: info.kind, rect, tag: element.tagName.toLowerCase(), inline: info.inline };
    if (anchor) field.href = anchor.getAttribute("href") ?? "";
    return field;
  };

  /** Does the element show nothing but this one field's text? Then it can be typed into in place. */
  const isInline = (element: Element, path: string): boolean => {
    const type = fieldTypeOfPath(path);
    if (type !== "text" && type !== "textarea" && type !== "link" && type !== undefined) return false;
    if (element instanceof HTMLImageElement || element instanceof HTMLInputElement) return false;
    let textNodes = 0;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if ((child.textContent ?? "").trim() !== "") textNodes += 1;
      } else if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName !== "BR") {
        return false;
      }
    }
    return textNodes === 1;
  };

  const register = (element: Element, path: string, textNode?: Text) => {
    const info: ElementInfo = { path, kind: kindFor(element, path), inline: false, textNode };
    info.inline = info.kind !== "image" && isInline(element, path);
    elementInfo.set(element, info);
  };

  const imageValues = (): Map<string, string> => {
    const values = new Map<string, string>();
    for (const [root, type] of fieldTypes) {
      const parsed = parsePath(root);
      if (!parsed) continue;
      const value = snapshot[parsed.slug]?.[parsed.section]?.[parsed.field];
      if ((type === "image" || type === "video" || type === "url") && typeof value === "string" && value) {
        values.set(value, root);
      }
      if (type === "list" && Array.isArray(value)) {
        const types = itemTypes.get(root) ?? {};
        value.forEach((item, index) => {
          for (const [key, itemType] of Object.entries(types)) {
            const text = item[key];
            if ((itemType === "image" || itemType === "url") && typeof text === "string" && text) {
              values.set(text, `${root}[${index}].${key}`);
            }
          }
        });
      }
    }
    return values;
  };

  const resolves = (candidate: string | null, value: string): boolean => {
    if (!candidate) return false;
    if (candidate === value) return true;
    try {
      return new URL(candidate, window.location.href).href === new URL(value, window.location.href).href;
    } catch {
      return false;
    }
  };

  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "SVG", "HEAD", "TITLE"]);

  /** Find newly marked text nodes, strip their markers, and map every element. */
  const scan = () => {
    if (!document.body) return;
    suppressMutations += 1;
    try {
      // 1. New text nodes carrying a marker.
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const marked: Text[] = [];
      let current = walker.nextNode();
      while (current) {
        const text = current as Text;
        if (hasStega(text.data)) marked.push(text);
        current = walker.nextNode();
      }
      for (const node of marked) {
        const path = decodeFieldPath(node.data);
        node.data = stegaClean(node.data);
        if (path && parsePath(path)) textPaths.set(node, path);
      }
      if (hasStega(document.title)) document.title = stegaClean(document.title);

      // 2. Rebuild the element map from every mapped text node still on the page.
      for (const [element, info] of elementInfo) {
        if (!element.isConnected || (info.textNode && !info.textNode.isConnected)) elementInfo.delete(element);
      }
      for (const [node, path] of textPaths) {
        if (!node.isConnected) {
          textPaths.delete(node);
          continue;
        }
        const element = node.parentElement;
        if (element && !elementInfo.has(element)) register(element, path, node);
      }

      // 3. Explicit overrides.
      for (const element of Array.from(document.body.querySelectorAll(`[${FIELD_ATTRIBUTE}]`))) {
        const path = element.getAttribute(FIELD_ATTRIBUTE) ?? "";
        if (parsePath(path) && !elementInfo.has(element)) register(element, path);
      }

      // 4. Images, embeds and plain URL links, matched by value.
      const values = imageValues();
      if (values.size > 0) {
        for (const element of Array.from(document.body.querySelectorAll("img, iframe, video, source, a[href]"))) {
          if (elementInfo.has(element)) continue;
          const attr = element instanceof HTMLAnchorElement ? "href" : "src";
          const candidates = [element.getAttribute(attr)];
          const srcset = element.getAttribute("srcset");
          if (srcset) for (const part of srcset.split(",")) candidates.push(part.trim().split(/\s+/)[0] ?? null);
          for (const [value, path] of values) {
            const type = fieldTypeOfPath(path);
            // Links found by href are only url fields with an absolute address: a site-relative
            // path such as "/about/" is shared by too many links to be a safe match. Link
            // fields are found by their marked label instead.
            if (element instanceof HTMLAnchorElement && (type !== "url" || !/^https?:\/\//i.test(value))) continue;
            if (candidates.some((candidate) => resolves(candidate, value))) {
              const target = element instanceof HTMLSourceElement ? (element.closest("picture, video") ?? element) : element;
              if (!elementInfo.has(target)) register(target, path);
              break;
            }
          }
        }
      }
    } finally {
      suppressMutations -= 1;
    }
  };

  const allFields = (): MappedField[] => {
    const out: MappedField[] = [];
    for (const [element, info] of elementInfo) {
      if (!element.isConnected) continue;
      const rect = toRect(element);
      if (rect.width === 0 && rect.height === 0) continue;
      out.push(describe(element, info));
    }
    return out;
  };

  const sendMap = () => send({ type: `${PREFIX}fields:map`, fields: allFields(), viewport: viewport() });
  const sendSelect = (source: "canvas" | "editor") => {
    const info = selected ? elementInfo.get(selected) : undefined;
    send({ type: `${PREFIX}select`, field: selected && info ? describe(selected, info) : null, source });
  };
  const sendHover = () => {
    const info = hovered ? elementInfo.get(hovered) : undefined;
    send({ type: `${PREFIX}hover`, field: hovered && info && mode === "edit" ? describe(hovered, info) : null });
  };

  // --- rAF-throttled geometry reporting ------------------------------------------------------
  let frame = 0;
  let mapDirty = false;
  const scheduleFrame = (withMap: boolean) => {
    if (withMap) mapDirty = true;
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (mapDirty) {
        mapDirty = false;
        scan();
        if (selected && !selected.isConnected) selected = null;
        if (hovered && !hovered.isConnected) hovered = null;
        sendMap();
      } else {
        send({ type: `${PREFIX}viewport`, viewport: viewport() });
      }
      sendSelect("canvas");
      sendHover();
    });
  };

  let mutationTimer = 0;
  const observer = new MutationObserver(() => {
    if (suppressMutations > 0) return;
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => scheduleFrame(true), 60);
  });

  // --- inline editing ----------------------------------------------------------------------
  const readText = (element: Element): string => {
    const raw = (element as HTMLElement).innerText ?? element.textContent ?? "";
    return stegaClean(raw.replace(/\u00a0/g, " "));
  };

  const finishEdit = (commit: boolean) => {
    if (!editing) return;
    const session = editing;
    editing = null;
    session.cleanup();
    const element = session.element as HTMLElement;
    suppressMutations += 1;
    try {
      element.removeAttribute("contenteditable");
      element.removeAttribute("spellcheck");
      if (!commit) element.textContent = session.original;
    } finally {
      suppressMutations -= 1;
    }
    if (commit) {
      send({ type: `${PREFIX}edit:commit`, path: session.path, value: readText(element) });
    } else {
      send({ type: `${PREFIX}edit:cancel`, path: session.path });
    }
    element.blur();
    // Apply anything the editor pushed for this field while it was being typed into.
    if (heldBack.size > 0) {
      for (const [root, value] of heldBack) draft.set(root, value);
      heldBack.clear();
      rebuildSnapshot();
    }
    scheduleFrame(true);
  };

  const startEdit = (element: Element) => {
    const info = elementInfo.get(element);
    if (!info || !info.inline || mode !== "edit") return;
    if (editing?.element === element) return;
    finishEdit(true);
    const type = fieldTypeOfPath(info.path);
    const multiline = type === "textarea";
    const host = element as HTMLElement;
    const original = readText(element);

    suppressMutations += 1;
    try {
      host.setAttribute("contenteditable", "plaintext-only");
      if (!host.isContentEditable) host.setAttribute("contenteditable", "true");
      host.setAttribute("spellcheck", "true");
    } finally {
      suppressMutations -= 1;
    }

    const onInput = () => {
      if (!editing) return;
      send({ type: `${PREFIX}edit:input`, path: editing.path, value: readText(host) });
      scheduleFrame(false);
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishEdit(false);
        return;
      }
      if (event.key === "Enter" && (!multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        finishEdit(true);
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      // Belt and braces for browsers without plaintext-only: paste as text only.
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(multiline ? text : text.replace(/\s*\n\s*/g, " ")));
      range.collapse(false);
      onInput();
    };
    const onBlur = () => finishEdit(true);
    host.addEventListener("input", onInput);
    host.addEventListener("keydown", onKeydown);
    host.addEventListener("paste", onPaste);
    host.addEventListener("blur", onBlur);

    editing = {
      element,
      path: info.path,
      original,
      multiline,
      cancelled: false,
      cleanup: () => {
        host.removeEventListener("input", onInput);
        host.removeEventListener("keydown", onKeydown);
        host.removeEventListener("paste", onPaste);
        host.removeEventListener("blur", onBlur);
      },
    };

    host.focus({ preventScroll: true });
    // Caret at the end, like clicking into a filled input.
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(host);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    send({ type: `${PREFIX}edit:start`, path: info.path, value: original });
  };

  // --- pointer handling --------------------------------------------------------------------
  const mappedAncestor = (target: EventTarget | null): Element | null => {
    let node = target instanceof Node ? (target.nodeType === Node.ELEMENT_NODE ? (target as Element) : target.parentElement) : null;
    while (node) {
      if (elementInfo.has(node)) return node;
      node = node.parentElement;
    }
    return null;
  };

  const select = (element: Element | null, source: "canvas" | "editor") => {
    if (editing && editing.element !== element) finishEdit(true);
    selected = element;
    sendSelect(source);
  };

  const go = (href: string) => {
    let url: URL;
    try {
      url = new URL(href, window.location.href);
    } catch {
      send({ type: `${PREFIX}error`, code: "navigate_failed", message: `Cannot open "${href}".` });
      return;
    }
    const external = url.origin !== window.location.origin;
    send({ type: `${PREFIX}navigate`, href: url.toString(), external, followed: !external });
    if (external) return; // never leave the site inside the editor
    if (config.navigate) {
      config.navigate(url.pathname + url.search.replace(/[?&]armature=edit/, "").replace(/^&/, "?") + url.hash);
      return;
    }
    window.location.assign(withEditFlag(url.toString()));
  };

  const onClick = (event: MouseEvent) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (mode === "preview") {
      // Links work normally, but the edit flag must survive so the bridge comes back.
      if (anchor && !event.defaultPrevented && !anchor.getAttribute("target")) {
        const href = anchor.getAttribute("href") ?? "";
        if (href.startsWith("#") || /^(mailto|tel):/i.test(href)) return;
        event.preventDefault();
        go(href);
      }
      return;
    }
    const element = mappedAncestor(event.target);
    if (anchor && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      go(anchor.getAttribute("href") ?? "");
      return;
    }
    if (element) {
      event.preventDefault();
      event.stopPropagation();
      if (editing?.element === element) return;
      if (selected === element && elementInfo.get(element)?.inline) {
        startEdit(element);
        return;
      }
      select(element, "canvas");
      return;
    }
    if (anchor) {
      // A plain click on an unmapped link: do not leave the page, tell the editor to show the hint.
      event.preventDefault();
      let external: boolean;
      try {
        external = new URL(anchor.getAttribute("href") ?? "", window.location.href).origin !== window.location.origin;
      } catch {
        external = true;
      }
      send({ type: `${PREFIX}navigate`, href: anchor.getAttribute("href") ?? "", external, followed: false });
    }
    if (editing) finishEdit(true);
    else if (selected) select(null, "canvas");
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (mode !== "edit") return;
    const element = mappedAncestor(event.target);
    if (element && elementInfo.get(element)?.inline) {
      event.preventDefault();
      if (selected !== element) select(element, "canvas");
      startEdit(element);
    }
  };

  let lastHoverTarget: EventTarget | null = null;
  const onMouseMove = (event: MouseEvent) => {
    if (mode !== "edit" || event.target === lastHoverTarget) return;
    lastHoverTarget = event.target;
    const element = mappedAncestor(event.target);
    if (element !== hovered) {
      hovered = element;
      scheduleFrame(false);
    }
  };
  const onMouseLeave = () => {
    lastHoverTarget = null;
    if (hovered) {
      hovered = null;
      scheduleFrame(false);
    }
  };

  const onKeydownDocument = (event: KeyboardEvent) => {
    if (mode !== "edit" || editing) return;
    if (event.key === "Enter" && selected && elementInfo.get(selected)?.inline) {
      event.preventDefault();
      startEdit(selected);
    } else if (event.key === "Escape" && selected) {
      select(null, "canvas");
    }
  };

  // --- messages from the editor ---------------------------------------------------------------
  const applyDraft = (fields: Record<string, unknown>) => {
    const editingRoot = editing ? rootOf(editing.path) : null;
    const incoming = new Set(Object.keys(fields));
    for (const root of Array.from(draft.keys())) if (!incoming.has(root)) draft.delete(root);
    for (const [root, value] of Object.entries(fields)) {
      if (!parsePath(root)) continue;
      if (editingRoot === root) heldBack.set(root, value);
      else draft.set(root, value);
    }
    rebuildSnapshot();
    scheduleFrame(true);
  };

  const onMessage = (event: MessageEvent) => {
    if (!allowedOrigins.includes(event.origin)) return;
    if (event.source !== window.parent) return;
    const data = event.data as { type?: unknown; nonce?: unknown; [key: string]: unknown };
    if (!data || typeof data !== "object" || typeof data.type !== "string" || typeof data.nonce !== "string") return;

    if (data.type === `${PREFIX}hello`) {
      parentOrigin = event.origin;
      nonce = data.nonce;
      if (data.protocolVersion !== PROTOCOL_VERSION) {
        send({
          type: `${PREFIX}error`,
          code: "protocol_mismatch",
          message: `This site's bridge speaks protocol ${PROTOCOL_VERSION} (bridge ${BRIDGE_VERSION}); the editor asked for ${String(data.protocolVersion)}.`,
        });
        return;
      }
      send({ type: `${PREFIX}ready`, protocolVersion: PROTOCOL_VERSION, bridgeVersion: BRIDGE_VERSION, route: currentRoute(), title: stegaClean(document.title) });
      scheduleFrame(true);
      return;
    }

    if (!nonce || data.nonce !== nonce || event.origin !== parentOrigin) return;

    switch (data.type) {
      case `${PREFIX}draft:apply`: {
        const fields = data.fields;
        if (fields && typeof fields === "object") applyDraft(fields as Record<string, unknown>);
        return;
      }
      case `${PREFIX}select`: {
        const path = typeof data.path === "string" ? data.path : null;
        let target: Element | null = null;
        if (path) {
          for (const [element, info] of elementInfo) {
            if (info.path === path && element.isConnected) {
              target = element;
              break;
            }
          }
        }
        select(target, "editor");
        if (target && data.scroll !== false) {
          target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        }
        return;
      }
      case `${PREFIX}edit:start`: {
        const path = typeof data.path === "string" ? data.path : "";
        const target = selected && elementInfo.get(selected)?.path === path ? selected : Array.from(elementInfo.entries()).find(([element, info]) => info.path === path && info.inline && element.isConnected)?.[0];
        if (!target) {
          send({ type: `${PREFIX}error`, code: "edit_failed", message: `"${path}" is not on this page as editable text.` });
          return;
        }
        if (selected !== target) select(target, "editor");
        startEdit(target);
        return;
      }
      case `${PREFIX}navigate`: {
        if (typeof data.path === "string") go(data.path);
        return;
      }
      case `${PREFIX}mode`: {
        const next = data.mode === "preview" ? "preview" : "edit";
        if (next === mode) return;
        mode = next;
        document.documentElement.setAttribute("data-armature-mode", mode);
        if (mode === "preview") {
          if (editing) finishEdit(true);
          hovered = null;
          select(null, "canvas");
        }
        scheduleFrame(false);
        return;
      }
      default:
        return;
    }
  };

  // --- route changes (client-side routers) ----------------------------------------------------
  const reportRoute = () => {
    send({ type: `${PREFIX}route:changed`, route: currentRoute(), title: stegaClean(document.title) });
    scheduleFrame(true);
  };
  const patchHistory = (method: "pushState" | "replaceState") => {
    const original = history[method];
    history[method] = function patched(this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      window.setTimeout(reportRoute, 0);
      return result;
    } as History["pushState"];
  };

  const install = () => {
    document.documentElement.setAttribute("data-armature-mode", mode);
    window.addEventListener("message", onMessage);
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onDoubleClick, true);
    document.addEventListener("mousemove", onMouseMove, { passive: true });
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("keydown", onKeydownDocument);
    window.addEventListener("scroll", () => scheduleFrame(false), { passive: true, capture: true });
    window.addEventListener("resize", () => scheduleFrame(true));
    window.addEventListener("popstate", reportRoute);
    window.addEventListener("hashchange", reportRoute);
    document.addEventListener("load", () => scheduleFrame(true), true);
    patchHistory("pushState");
    patchHistory("replaceState");
    if (document.fonts?.ready) void document.fonts.ready.then(() => scheduleFrame(true));
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["src", "srcset", "href", FIELD_ATTRIBUTE] });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => scheduleFrame(true)).observe(document.body);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }

  return bridge;
}
