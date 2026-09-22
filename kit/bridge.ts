/**
 * The visual-editing bridge, protocol v2 (site contract v2). Speaks v1 to an older
 * editor. It does nothing at all unless three things are true at once: the page is
 * inside an iframe, the URL has `?armature=edit`, and the window that embeds it is one
 * of `allowedOrigins`. Even then nothing touches the page until an allowed origin has
 * said hello with a nonce that every later message must echo.
 *
 * In edit mode it:
 *   - marks every Stage 1 text value with an invisible stega marker, finds it in the
 *     DOM, records the element and strips the marker again (contract v1.1, unchanged);
 *   - reports a rect map for every builder element (`[data-ae-id]`): border box plus
 *     computed padding and margin, once per animation frame on scroll, resize and DOM
 *     changes, so the editor draws every overlay above the frame;
 *   - renders the DRAFT layouts and kit the editor pushes, through the kit store;
 *   - hosts in-place editing: plain text for headings and buttons, rich text for the
 *     Text Editor widget (the browser's own editing commands; the DOM is serialised
 *     back to the whitelisted JSON after every input);
 *   - reports hover, selection, route changes and the sections a coded page would show.
 *
 * It never evaluates code and never sets innerHTML. Everything it writes is text.
 */
import { serializeRichText } from "./richTextDom.ts";
import type { KitStore } from "./store.ts";
import { parseFieldPath } from "./store.ts";
import type { LayoutDoc, SiteKit, SiteSectionInfo } from "./types.ts";

export const PROTOCOL_VERSION = 2;

const EDIT_PARAM = "armature";
const EDIT_VALUE = "edit";
const FIELD_ATTRIBUTE = "data-armature-field";
const ELEMENT_ATTRIBUTE = "data-ae-id";
const PREFIX = "armature:";

type FieldType = "text" | "textarea" | "image" | "video" | "url" | "link" | "list";
type ItemFieldType = "text" | "textarea" | "image" | "url";

export type SiteSchemaLike = {
  armatureContract: number;
  pages: { slug: string; path?: string; sections: { key: string; fields: { key: string; type: FieldType; itemFields?: { key: string; type: ItemFieldType }[] }[] }[] }[];
};

// --- stega codec, compatible with @vercel/stega ---------------------------------------------

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

export function stegaClean(text: string): string {
  return text.replace(STEGA_RUN, "");
}

export const hasStega = (text: string): boolean => {
  STEGA_RUN.lastIndex = 0;
  return STEGA_RUN.test(text);
};

export function decodeFieldPath(text: string): string | null {
  const payload = stegaDecode(text);
  if (payload && typeof payload === "object" && typeof (payload as { armature?: unknown }).armature === "string") return (payload as { armature: string }).armature;
  return null;
}

// --- shapes ------------------------------------------------------------------------------

type Rect = { x: number; y: number; width: number; height: number };
type Box = { top: number; right: number; bottom: number; left: number };
type MappedKind = "text" | "image" | "link";
type MappedField = { path: string; kind: MappedKind; rect: Rect; tag: string; inline: boolean; href?: string };
type ElementRect = { id: string; type: string; tag: string; rect: Rect; padding: Box; margin: Box; parentId: string | null; page: string | null; empty: boolean; inner?: Rect; section?: string };
type Viewport = { width: number; height: number; scrollX: number; scrollY: number };
type ElementInfo = { path: string; kind: MappedKind; inline: boolean; textNode?: Text };

export type BridgeConfig = {
  allowedOrigins: string[];
  schema: SiteSchemaLike;
  store: KitStore;
  kitVersion: string;
  navigate?: (path: string) => void;
  /** Slots mounted on the page: slug → default section keys. */
  slots: Map<string, string[]>;
  onSlotsChange: Set<() => void>;
};

export type Bridge = {
  readonly active: boolean;
  encode(value: string, path: string): string;
};

// --- helpers ------------------------------------------------------------------------------

const rootOf = (path: string): string => {
  const parsed = parseFieldPath(path);
  return parsed ? `${parsed.slug}.${parsed.section}.${parsed.field}` : path;
};

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

const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY });
const currentRoute = (): string => window.location.pathname;

function parentOriginHint(): string | null {
  try {
    const ancestors = window.location.ancestorOrigins;
    if (ancestors && ancestors.length > 0) return ancestors[0] ?? null;
  } catch {
    // not supported
  }
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
}

const num = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// --- the bridge ------------------------------------------------------------------------------------

export function createBridge(config: BridgeConfig): Bridge {
  const allowedOrigins = (config.allowedOrigins ?? []).map((origin) => origin.replace(/\/+$/, ""));
  const hint = typeof document !== "undefined" && isInIframe() ? parentOriginHint() : null;
  const active = typeof document !== "undefined" && allowedOrigins.length > 0 && isInIframe() && hasEditFlag() && (hint === null || allowedOrigins.includes(hint));
  const { store } = config;

  const fieldTypes = new Map<string, FieldType>();
  const itemTypes = new Map<string, Record<string, ItemFieldType>>();
  for (const page of config.schema?.pages ?? []) {
    for (const section of page.sections ?? []) {
      for (const field of section.fields ?? []) {
        const root = `${page.slug}.${section.key}.${field.key}`;
        fieldTypes.set(root, field.type);
        if (field.type === "list") itemTypes.set(root, Object.fromEntries((field.itemFields ?? []).map((item) => [item.key, item.type])));
      }
    }
  }

  const encode = (value: string, path: string): string => (active ? `${value}${stegaEncode({ armature: path })}` : value);
  const bridge: Bridge = { active, encode };
  if (!active) return bridge;

  // --- edit mode from here on ---------------------------------------------------------------------
  let parentOrigin: string | null = null;
  let nonce: string | null = null;
  let protocol: 1 | 2 = 1;
  let mode: "edit" | "preview" = "edit";
  let suppressMutations = 0;

  const send = (message: Record<string, unknown>) => {
    if (!parentOrigin || !nonce) return;
    window.parent.postMessage({ ...message, nonce }, parentOrigin);
  };

  const textPaths = new Map<Text, string>();
  const elementInfo = new Map<Element, ElementInfo>();
  let selected: Element | null = null;
  let hovered: Element | null = null;
  let selectedElement: Element | null = null;
  let hoveredElement: Element | null = null;

  type Editing = { host: HTMLElement; path?: string; elementId?: string; kind: "field" | "plain" | "rich"; original: string; multiline: boolean; cleanup: () => void };
  let editing: Editing | null = null;
  let heldBack = new Map<string, unknown>();

  const fieldTypeOfPath = (path: string): FieldType | ItemFieldType | undefined => {
    const parsed = parseFieldPath(path);
    if (!parsed) return undefined;
    const root = `${parsed.slug}.${parsed.section}.${parsed.field}`;
    if (parsed.itemKey !== undefined) return itemTypes.get(root)?.[parsed.itemKey];
    return fieldTypes.get(root);
  };

  const kindFor = (element: Element, path: string): MappedKind => {
    if (element instanceof HTMLImageElement || element instanceof HTMLPictureElement || element instanceof HTMLVideoElement || element instanceof HTMLIFrameElement) return "image";
    const type = fieldTypeOfPath(path);
    if (type === "link" || (type === "url" && element instanceof HTMLAnchorElement)) return "link";
    if (element.closest("a[href]")) return "link";
    return "text";
  };

  const describe = (element: Element, info: ElementInfo): MappedField => {
    const rect = info.textNode && element.childNodes.length > 1 ? rangeRect(info.textNode) : toRect(element);
    const anchor = info.kind === "link" ? element.closest("a") : null;
    const field: MappedField = { path: info.path, kind: info.kind, rect, tag: element.tagName.toLowerCase(), inline: info.inline };
    if (anchor) field.href = anchor.getAttribute("href") ?? "";
    return field;
  };

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
    const snapshot = store.getSnapshot().content;
    for (const [root, type] of fieldTypes) {
      const parsed = parseFieldPath(root);
      if (!parsed) continue;
      const value = snapshot[parsed.slug]?.[parsed.section]?.[parsed.field];
      if ((type === "image" || type === "video" || type === "url") && typeof value === "string" && value) values.set(value, root);
      if (type === "list" && Array.isArray(value)) {
        const types = itemTypes.get(root) ?? {};
        value.forEach((item, index) => {
          for (const [key, itemType] of Object.entries(types)) {
            const text = item[key];
            if ((itemType === "image" || itemType === "url") && typeof text === "string" && text) values.set(text, `${root}[${index}].${key}`);
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

  /** Find newly marked text nodes, strip their markers, and map every field element. */
  const scan = () => {
    if (!document.body) return;
    suppressMutations += 1;
    try {
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
        if (path && parseFieldPath(path)) textPaths.set(node, path);
      }
      if (hasStega(document.title)) document.title = stegaClean(document.title);

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
      for (const element of Array.from(document.body.querySelectorAll(`[${FIELD_ATTRIBUTE}]`))) {
        const path = element.getAttribute(FIELD_ATTRIBUTE) ?? "";
        if (parseFieldPath(path) && !elementInfo.has(element)) register(element, path);
      }
      const values = imageValues();
      if (values.size > 0) {
        for (const element of Array.from(document.body.querySelectorAll("img, iframe, video, source, a[href]"))) {
          if (elementInfo.has(element)) continue;
          // Pictures inside builder elements belong to the element, not to a content field.
          const owner = element.closest(`[${ELEMENT_ATTRIBUTE}]`);
          if (owner && owner.getAttribute("data-ae-type") !== "site-section") continue;
          const attr = element instanceof HTMLAnchorElement ? "href" : "src";
          const candidates = [element.getAttribute(attr)];
          const srcset = element.getAttribute("srcset");
          if (srcset) for (const part of srcset.split(",")) candidates.push(part.trim().split(/\s+/)[0] ?? null);
          for (const [value, path] of values) {
            const type = fieldTypeOfPath(path);
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

  // --- builder elements ----------------------------------------------------------------------------
  const elementId = (element: Element | null): string | null => element?.getAttribute(ELEMENT_ATTRIBUTE) ?? null;

  const describeElement = (element: Element): ElementRect => {
    const style = getComputedStyle(element);
    const parent = element.parentElement?.closest(`[${ELEMENT_ATTRIBUTE}]`) ?? null;
    const page = element.closest("[data-ae-page]");
    const type = element.getAttribute("data-ae-type") ?? "";
    const out: ElementRect = {
      id: elementId(element) ?? "",
      type,
      tag: element.tagName.toLowerCase(),
      rect: toRect(element),
      padding: { top: num(style.paddingTop), right: num(style.paddingRight), bottom: num(style.paddingBottom), left: num(style.paddingLeft) },
      margin: { top: num(style.marginTop), right: num(style.marginRight), bottom: num(style.marginBottom), left: num(style.marginLeft) },
      parentId: elementId(parent),
      page: page?.getAttribute("data-ae-page") ?? null,
      empty: element.classList.contains("ae-empty"),
    };
    if (type === "image") {
      const img = element.querySelector("img");
      if (img) out.inner = toRect(img);
    } else if (type === "container" || type === "grid") {
      const inner = element.querySelector(":scope > .ae-con-inner, :scope > .ae-con-link > .ae-con-inner");
      if (inner) out.inner = toRect(inner);
    }
    const section = element.getAttribute("data-ae-section");
    if (section) out.section = section;
    return out;
  };

  const allElements = (): ElementRect[] => Array.from(document.querySelectorAll(`[${ELEMENT_ATTRIBUTE}]`)).map(describeElement);

  const slotsPayload = () => Array.from(config.slots.entries()).map(([slug, defaults]) => ({ slug, defaults }));
  const sectionsPayload = (): SiteSectionInfo[] => store.listSections();

  const sendMap = () => {
    const payload: Record<string, unknown> = { type: `${PREFIX}fields:map`, fields: allFields(), viewport: viewport() };
    send(payload);
    if (protocol >= 2) send({ type: `${PREFIX}elements:map`, elements: allElements(), viewport: viewport() });
  };
  const sendSelect = (source: "canvas" | "editor" | "refresh") => {
    const info = selected ? elementInfo.get(selected) : undefined;
    send({ type: `${PREFIX}select`, field: selected && info ? describe(selected, info) : null, source });
    if (protocol >= 2) send({ type: `${PREFIX}element:select`, id: selectedElement && selectedElement.isConnected ? elementId(selectedElement) : null, source });
  };
  const sendHover = () => {
    const info = hovered ? elementInfo.get(hovered) : undefined;
    send({ type: `${PREFIX}hover`, field: hovered && info && mode === "edit" ? describe(hovered, info) : null });
    if (protocol >= 2) send({ type: `${PREFIX}element:hover`, id: hoveredElement && mode === "edit" ? elementId(hoveredElement) : null });
  };
  const sendSlots = () => {
    if (protocol >= 2) send({ type: `${PREFIX}slot`, slots: slotsPayload(), sections: sectionsPayload(), layouts: Object.keys(store.baseLayouts) });
  };

  // --- rAF-throttled geometry ---------------------------------------------------------------------------
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
        if (selectedElement && !selectedElement.isConnected) selectedElement = document.querySelector(`[${ELEMENT_ATTRIBUTE}="${selectedElement.getAttribute(ELEMENT_ATTRIBUTE)}"]`);
        if (hoveredElement && !hoveredElement.isConnected) hoveredElement = null;
        sendMap();
      } else {
        send({ type: `${PREFIX}viewport`, viewport: viewport() });
        if (protocol >= 2) send({ type: `${PREFIX}elements:map`, elements: allElements(), viewport: viewport() });
      }
      sendSelect("refresh");
      sendHover();
    });
  };

  let mutationTimer = 0;
  const observer = new MutationObserver(() => {
    if (suppressMutations > 0) return;
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => scheduleFrame(true), 60);
  });

  // --- inline editing ------------------------------------------------------------------------------------
  const readText = (element: Element): string => stegaClean(((element as HTMLElement).innerText ?? element.textContent ?? "").replace(/\u00a0/g, " "));

  const finishEdit = (commit: boolean) => {
    if (!editing) return;
    const session = editing;
    editing = null;
    session.cleanup();
    const host = session.host;
    suppressMutations += 1;
    try {
      host.removeAttribute("contenteditable");
      host.removeAttribute("spellcheck");
      if (!commit && session.kind !== "rich") host.textContent = session.original;
    } finally {
      suppressMutations -= 1;
    }
    if (session.kind === "field" && session.path) {
      send(commit ? { type: `${PREFIX}edit:commit`, path: session.path, value: readText(host) } : { type: `${PREFIX}edit:cancel`, path: session.path });
    } else if (session.elementId) {
      const value = session.kind === "rich" ? serializeRichText(host) : readText(host);
      send(commit ? { type: `${PREFIX}element:edit:commit`, id: session.elementId, value } : { type: `${PREFIX}element:edit:cancel`, id: session.elementId });
    }
    host.blur();
    if (heldBack.size > 0) {
      const held = heldBack;
      heldBack = new Map();
      for (const [root, value] of held) store.setField(root, value);
    }
    scheduleFrame(true);
  };

  const attachEditing = (host: HTMLElement, session: Omit<Editing, "cleanup" | "host">, plain: boolean) => {
    finishEdit(true);
    suppressMutations += 1;
    try {
      host.setAttribute("contenteditable", plain ? "plaintext-only" : "true");
      if (plain && !host.isContentEditable) host.setAttribute("contenteditable", "true");
      host.setAttribute("spellcheck", "true");
    } finally {
      suppressMutations -= 1;
    }
    const onInput = () => {
      if (!editing) return;
      if (editing.kind === "field" && editing.path) send({ type: `${PREFIX}edit:input`, path: editing.path, value: readText(host) });
      else if (editing.elementId) send({ type: `${PREFIX}element:edit:input`, id: editing.elementId, value: editing.kind === "rich" ? serializeRichText(host) : readText(host) });
      if (editing.kind === "rich") sendRichState();
      scheduleFrame(false);
    };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        finishEdit(false);
        return;
      }
      if (event.key === "Enter" && editing?.kind !== "rich" && (!session.multiline || event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        event.stopPropagation();
        finishEdit(true);
        return;
      }
      if (editing?.kind === "rich" && (event.metaKey || event.ctrlKey)) {
        const key = event.key.toLowerCase();
        if (key === "b" || key === "i" || key === "u") {
          event.preventDefault();
          richCommand(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
        }
      }
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      if (editing?.kind === "rich") {
        // Paragraph breaks survive as new paragraphs; everything else is plain text.
        const parts = text.split(/\n{2,}/);
        parts.forEach((part, index) => {
          if (index > 0) document.execCommand("insertParagraph");
          const lines = part.split("\n");
          lines.forEach((line, lineIndex) => {
            if (lineIndex > 0) document.execCommand("insertLineBreak");
            if (line) document.execCommand("insertText", false, line);
          });
        });
        onInput();
        return;
      }
      range.insertNode(document.createTextNode(session.multiline ? text : text.replace(/\s*\n\s*/g, " ")));
      range.collapse(false);
      onInput();
    };
    const onBlur = () => finishEdit(true);
    const onSelectionChange = () => {
      if (editing?.kind === "rich") sendRichState();
    };
    host.addEventListener("input", onInput);
    host.addEventListener("keydown", onKeydown);
    host.addEventListener("paste", onPaste);
    host.addEventListener("blur", onBlur);
    document.addEventListener("selectionchange", onSelectionChange);
    editing = {
      ...session,
      host,
      cleanup: () => {
        host.removeEventListener("input", onInput);
        host.removeEventListener("keydown", onKeydown);
        host.removeEventListener("paste", onPaste);
        host.removeEventListener("blur", onBlur);
        document.removeEventListener("selectionchange", onSelectionChange);
      },
    };
    host.focus({ preventScroll: true });
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(host);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  const startFieldEdit = (element: Element) => {
    const info = elementInfo.get(element);
    if (!info || !info.inline || mode !== "edit") return;
    if (editing?.host === element) return;
    const type = fieldTypeOfPath(info.path);
    const original = readText(element);
    attachEditing(element as HTMLElement, { path: info.path, kind: "field", original, multiline: type === "textarea" }, true);
    send({ type: `${PREFIX}edit:start`, path: info.path, value: original });
  };

  /** The element that holds an element's editable text: the heading itself, the button label, or the rich text root. */
  const editHostFor = (element: Element): { host: HTMLElement; kind: "plain" | "rich" } | null => {
    const type = element.getAttribute("data-ae-type");
    if (type === "heading") {
      const anchor = element.querySelector(":scope > a");
      return { host: (anchor ?? element) as HTMLElement, kind: "plain" };
    }
    if (type === "button") {
      const label = element.querySelector(".ae-btn-text");
      return label ? { host: label as HTMLElement, kind: "plain" } : null;
    }
    if (type === "text") return { host: element as HTMLElement, kind: "rich" };
    return null;
  };

  const startElementEdit = (element: Element) => {
    if (mode !== "edit") return;
    const target = editHostFor(element);
    if (!target) return;
    if (editing?.host === target.host) return;
    const id = elementId(element) ?? "";
    const original = readText(target.host);
    attachEditing(target.host, { elementId: id, kind: target.kind, original, multiline: target.kind === "rich" }, target.kind === "plain");
    send({ type: `${PREFIX}element:edit:start`, id, value: target.kind === "rich" ? serializeRichText(target.host) : original });
    if (target.kind === "rich") sendRichState();
  };

  // --- rich text commands (the floating toolbar in the editor sends these) -------------------------------
  const blockTagOf = (): string => {
    const selection = window.getSelection();
    let node: Node | null = selection?.anchorNode ?? null;
    while (node && node !== editing?.host) {
      if (node.nodeType === Node.ELEMENT_NODE && /^(P|H[1-6]|LI|BLOCKQUOTE)$/.test((node as Element).tagName)) return (node as Element).tagName.toLowerCase();
      node = node.parentNode;
    }
    return "p";
  };

  const sendRichState = () => {
    if (!editing || editing.kind !== "rich") return;
    const selection = window.getSelection();
    let link: string | null = null;
    let node: Node | null = selection?.anchorNode ?? null;
    while (node && node !== editing.host) {
      if (node instanceof HTMLAnchorElement) {
        link = node.getAttribute("href");
        break;
      }
      node = node.parentNode;
    }
    const state = {
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strike: document.queryCommandState("strikeThrough"),
      bulletList: document.queryCommandState("insertUnorderedList"),
      orderedList: document.queryCommandState("insertOrderedList"),
      block: blockTagOf(),
      link,
      align: (document.queryCommandState("justifyCenter") ? "center" : document.queryCommandState("justifyRight") ? "right" : document.queryCommandState("justifyFull") ? "justify" : "left") as string,
    };
    send({ type: `${PREFIX}richtext:state`, id: editing.elementId, state });
  };

  const richCommand = (command: string, value?: string) => {
    if (!editing || editing.kind !== "rich") return;
    editing.host.focus({ preventScroll: true });
    switch (command) {
      case "bold":
      case "italic":
      case "underline":
        document.execCommand(command);
        break;
      case "strike":
        document.execCommand("strikeThrough");
        break;
      case "bulletList":
        document.execCommand("insertUnorderedList");
        break;
      case "orderedList":
        document.execCommand("insertOrderedList");
        break;
      case "block":
        document.execCommand("formatBlock", false, `<${(value ?? "p").replace(/[^a-z0-9]/gi, "")}>`);
        break;
      case "align":
        document.execCommand(value === "center" ? "justifyCenter" : value === "right" ? "justifyRight" : value === "justify" ? "justifyFull" : "justifyLeft");
        break;
      case "link": {
        if (!value) {
          document.execCommand("unlink");
          break;
        }
        document.execCommand("createLink", false, value);
        break;
      }
      case "color":
        if (value) document.execCommand("foreColor", false, value);
        else document.execCommand("removeFormat");
        break;
      case "clear":
        document.execCommand("removeFormat");
        document.execCommand("unlink");
        break;
      default:
        return;
    }
    send({ type: `${PREFIX}element:edit:input`, id: editing.elementId, value: serializeRichText(editing.host) });
    sendRichState();
    scheduleFrame(false);
  };

  // --- pointer handling ----------------------------------------------------------------------------------
  const mappedAncestor = (target: EventTarget | null): Element | null => {
    let node = target instanceof Node ? (target.nodeType === Node.ELEMENT_NODE ? (target as Element) : target.parentElement) : null;
    while (node) {
      if (elementInfo.has(node)) return node;
      node = node.parentElement;
    }
    return null;
  };

  const builderAncestor = (target: EventTarget | null): Element | null => {
    const node = target instanceof Node ? (target.nodeType === Node.ELEMENT_NODE ? (target as Element) : target.parentElement) : null;
    return node?.closest(`[${ELEMENT_ATTRIBUTE}]`) ?? null;
  };

  const select = (element: Element | null, source: "canvas" | "editor" | "refresh") => {
    if (editing && editing.host !== element && !(element && editing.host.contains(element))) finishEdit(true);
    selected = element;
    if (element) selectedElement = null;
    sendSelect(source);
  };

  const selectElement = (element: Element | null, source: "canvas" | "editor" | "refresh") => {
    if (editing && !(element && (editing.host === element || element.contains(editing.host)))) finishEdit(true);
    selectedElement = element;
    if (element) selected = null;
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
    if (external) return;
    if (config.navigate) {
      config.navigate(url.pathname + url.search.replace(/[?&]armature=edit/, "").replace(/^&/, "?") + url.hash);
      return;
    }
    window.location.assign(withEditFlag(url.toString()));
  };

  const onClick = (event: MouseEvent) => {
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (mode === "preview") {
      if (anchor && !event.defaultPrevented && !anchor.getAttribute("target")) {
        const href = anchor.getAttribute("href") ?? "";
        if (href.startsWith("#") || /^(mailto|tel):/i.test(href)) return;
        event.preventDefault();
        go(href);
      }
      return;
    }
    if (editing && editing.host.contains(event.target as Node)) return;
    const fieldElement = mappedAncestor(event.target);
    const builderElement = protocol >= 2 ? builderAncestor(event.target) : null;
    if (anchor && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.stopPropagation();
      go(anchor.getAttribute("href") ?? "");
      return;
    }
    // A Stage 1 field inside a site section wins over the section wrapper around it.
    if (fieldElement && (!builderElement || builderElement.contains(fieldElement))) {
      event.preventDefault();
      event.stopPropagation();
      if (selected === fieldElement && elementInfo.get(fieldElement)?.inline) {
        startFieldEdit(fieldElement);
        return;
      }
      select(fieldElement, "canvas");
      return;
    }
    if (builderElement) {
      event.preventDefault();
      event.stopPropagation();
      if (event.altKey) {
        const parent = builderElement.parentElement?.closest(`[${ELEMENT_ATTRIBUTE}]`) ?? null;
        selectElement(parent ?? builderElement, "canvas");
        return;
      }
      if (selectedElement === builderElement && editHostFor(builderElement)) {
        startElementEdit(builderElement);
        return;
      }
      selectElement(builderElement, "canvas");
      return;
    }
    if (anchor) {
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
    else if (selected || selectedElement) {
      selected = null;
      selectedElement = null;
      sendSelect("canvas");
    }
  };

  const onDoubleClick = (event: MouseEvent) => {
    if (mode !== "edit") return;
    if (editing && editing.host.contains(event.target as Node)) return;
    const fieldElement = mappedAncestor(event.target);
    const builderElement = protocol >= 2 ? builderAncestor(event.target) : null;
    if (fieldElement && (!builderElement || builderElement.contains(fieldElement)) && elementInfo.get(fieldElement)?.inline) {
      event.preventDefault();
      if (selected !== fieldElement) select(fieldElement, "canvas");
      startFieldEdit(fieldElement);
      return;
    }
    if (builderElement && editHostFor(builderElement)) {
      event.preventDefault();
      if (selectedElement !== builderElement) selectElement(builderElement, "canvas");
      startElementEdit(builderElement);
    }
  };

  const onContextMenu = (event: MouseEvent) => {
    if (mode !== "edit" || protocol < 2) return;
    if (editing && editing.host.contains(event.target as Node)) return;
    const builderElement = builderAncestor(event.target);
    if (!builderElement) return;
    event.preventDefault();
    if (selectedElement !== builderElement) selectElement(builderElement, "canvas");
    send({ type: `${PREFIX}element:contextmenu`, id: elementId(builderElement), x: event.clientX, y: event.clientY });
  };

  let lastHoverTarget: EventTarget | null = null;
  const onMouseMove = (event: MouseEvent) => {
    if (mode !== "edit" || event.target === lastHoverTarget) return;
    lastHoverTarget = event.target;
    const fieldElement = mappedAncestor(event.target);
    const builderElement = protocol >= 2 ? builderAncestor(event.target) : null;
    const nextField = fieldElement && (!builderElement || builderElement.contains(fieldElement)) ? fieldElement : null;
    const nextElement = nextField ? null : builderElement;
    if (nextField !== hovered || nextElement !== hoveredElement) {
      hovered = nextField;
      hoveredElement = nextElement;
      scheduleFrame(false);
    }
  };
  const onMouseLeave = () => {
    lastHoverTarget = null;
    if (hovered || hoveredElement) {
      hovered = null;
      hoveredElement = null;
      scheduleFrame(false);
    }
  };

  const onKeydownDocument = (event: KeyboardEvent) => {
    if (mode !== "edit" || editing) return;
    const target = event.target as Element | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    const meta = event.metaKey || event.ctrlKey;
    let key: string | null = null;
    const lower = event.key.toLowerCase();
    if (meta && lower === "z") key = event.shiftKey ? "redo" : "undo";
    else if (meta && lower === "y") key = "redo";
    else if (meta && lower === "s") key = "publish";
    else if (meta && lower === "p") key = "preview";
    else if (meta && lower === "c") key = "copy";
    else if (meta && lower === "v") key = event.shiftKey ? "pasteStyle" : "paste";
    else if (meta && lower === "d") key = "duplicate";
    else if (event.key === "Tab" && !meta && !event.altKey) key = "next";
    else if (event.key === "?" && !meta) key = "help";
    else if ((event.key === "Delete" || event.key === "Backspace") && !meta) key = "delete";
    else if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowRight") key = event.key.replace("Arrow", "").toLowerCase();
    if (key) {
      if (key === "delete" && !selectedElement) return;
      event.preventDefault();
      send({ type: `${PREFIX}key`, key });
      return;
    }
    if (event.key === "Enter" && selected && elementInfo.get(selected)?.inline) {
      event.preventDefault();
      startFieldEdit(selected);
    } else if (event.key === "Enter" && selectedElement && editHostFor(selectedElement)) {
      event.preventDefault();
      startElementEdit(selectedElement);
    } else if (event.key === "Escape" && (selected || selectedElement)) {
      selected = null;
      selectedElement = null;
      sendSelect("canvas");
    }
  };

  // --- messages from the editor ---------------------------------------------------------------------------
  const applyDraft = (fields: Record<string, unknown>) => {
    const editingRoot = editing?.path ? rootOf(editing.path) : null;
    const held = store.applyFields(fields, (root) => root === editingRoot);
    for (const [root, value] of held) heldBack.set(root, value);
    scheduleFrame(true);
  };

  const findElement = (id: unknown): Element | null => (typeof id === "string" && /^[a-z0-9]{8}$/.test(id) ? document.querySelector(`[${ELEMENT_ATTRIBUTE}="${id}"]`) : null);

  const onMessage = (event: MessageEvent) => {
    if (!allowedOrigins.includes(event.origin)) return;
    if (event.source !== window.parent) return;
    const data = event.data as { type?: unknown; nonce?: unknown; [key: string]: unknown };
    if (!data || typeof data !== "object" || typeof data.type !== "string" || typeof data.nonce !== "string") return;

    if (data.type === `${PREFIX}hello`) {
      parentOrigin = event.origin;
      nonce = data.nonce;
      installOnce();
      const wants = typeof data.wants === "number" ? data.wants : typeof data.protocolVersion === "number" ? data.protocolVersion : 1;
      if (wants >= 2) protocol = 2;
      else if (data.protocolVersion === 1) protocol = 1;
      else {
        send({ type: `${PREFIX}error`, code: "protocol_mismatch", message: `This site's kit speaks protocol ${PROTOCOL_VERSION} (kit ${config.kitVersion}); the editor asked for ${String(data.protocolVersion)}.` });
        return;
      }
      store.setEditMode(true);
      send({
        type: `${PREFIX}ready`,
        protocolVersion: protocol,
        bridgeVersion: config.kitVersion,
        kitVersion: config.kitVersion,
        route: currentRoute(),
        title: stegaClean(document.title),
        sections: sectionsPayload(),
        slots: slotsPayload(),
        layouts: Object.keys(store.baseLayouts),
      });
      scheduleFrame(true);
      return;
    }

    if (!nonce || data.nonce !== nonce || event.origin !== parentOrigin) return;

    switch (data.type) {
      case `${PREFIX}draft:apply`: {
        if (data.fields && typeof data.fields === "object") applyDraft(data.fields as Record<string, unknown>);
        return;
      }
      case `${PREFIX}layout:apply`: {
        if (protocol < 2) return;
        const layouts = data.layouts && typeof data.layouts === "object" ? (data.layouts as Record<string, LayoutDoc | null>) : null;
        const kit = data.kit && typeof data.kit === "object" ? (data.kit as SiteKit) : null;
        if (editing && editing.kind !== "field") finishEdit(true);
        store.applyLayouts(layouts, kit);
        scheduleFrame(true);
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
        if (target && data.scroll !== false) target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        return;
      }
      case `${PREFIX}element:select`: {
        const target = findElement(data.id);
        selectElement(target, "editor");
        if (target && data.scroll !== false) target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
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
        startFieldEdit(target);
        return;
      }
      case `${PREFIX}element:edit:start`: {
        const target = findElement(data.id);
        if (!target || !editHostFor(target)) {
          send({ type: `${PREFIX}error`, code: "edit_failed", message: "That element cannot be typed into on the page." });
          return;
        }
        if (selectedElement !== target) selectElement(target, "editor");
        startElementEdit(target);
        return;
      }
      case `${PREFIX}element:edit:stop`: {
        finishEdit(data.commit !== false);
        return;
      }
      case `${PREFIX}richtext:command`: {
        richCommand(typeof data.command === "string" ? data.command : "", typeof data.value === "string" ? data.value : undefined);
        return;
      }
      case `${PREFIX}scroll`: {
        if (typeof data.deltaY === "number") window.scrollBy({ top: data.deltaY, behavior: "auto" });
        if (typeof data.top === "number") window.scrollTo({ top: data.top, behavior: "auto" });
        scheduleFrame(false);
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
          hoveredElement = null;
          selected = null;
          selectedElement = null;
          sendSelect("canvas");
        }
        scheduleFrame(false);
        return;
      }
      default:
        return;
    }
  };

  // --- route changes -----------------------------------------------------------------------------------------
  const reportRoute = () => {
    send({ type: `${PREFIX}route:changed`, route: currentRoute(), title: stegaClean(document.title) });
    window.dispatchEvent(new Event("armature:navigated"));
    scheduleFrame(true);
    window.setTimeout(sendSlots, 0);
  };
  const patchHistory = (method: "pushState" | "replaceState") => {
    const original = history[method];
    history[method] = function patched(this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      window.setTimeout(reportRoute, 0);
      return result;
    } as History["pushState"];
  };

  let installed = false;
  const installOnce = () => {
    if (installed) return;
    installed = true;
    document.documentElement.setAttribute("data-armature-mode", mode);
    document.addEventListener("click", onClick, true);
    document.addEventListener("dblclick", onDoubleClick, true);
    document.addEventListener("contextmenu", onContextMenu, true);
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
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["src", "srcset", "href", "class", FIELD_ATTRIBUTE, ELEMENT_ATTRIBUTE] });
    if (typeof ResizeObserver === "function") new ResizeObserver(() => scheduleFrame(true)).observe(document.body);
    config.onSlotsChange.add(() => window.setTimeout(sendSlots, 0));
  };

  window.addEventListener("message", onMessage);
  return bridge;
}
