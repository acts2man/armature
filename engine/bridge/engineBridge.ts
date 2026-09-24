/**
 * The code engine's in-page bridge, injected into the preview by the Vite plugin. It
 * speaks the same protocol shapes as the site kit's bridge (armature:hello / ready,
 * armature:elements:map, armature:element:hover / select, inline editing, rich-text
 * commands, scroll, navigate, keys) and adds a few engine messages:
 *
 *   armature:engine:nodes     the NodeRef behind every element id (locations, indices)
 *   armature:engine:computed  the selected element's computed style, for the Style tab
 *   armature:engine:css       (editor → bridge) reload a stylesheet after the engine wrote it
 *
 * Active only inside an iframe opened with ?armature=edit by an allowed editor origin.
 * Self-contained: no imports, so it can be served as one module.
 */

type Rect = { x: number; y: number; width: number; height: number };
type Box = { top: number; right: number; bottom: number; left: number };
type Loc = { file: string; line: number; col: number };
type RichRun = { text: string; bold?: boolean; italic?: boolean; href?: string; br?: boolean };

type Config = { editorOrigins: string[] };

const config: Config = ((globalThis as unknown as { __ARMATURE_ENGINE_CONFIG?: Config }).__ARMATURE_ENGINE_CONFIG ?? { editorOrigins: [] }) as Config;
const PREFIX = "armature:";
const BRIDGE_VERSION = "engine-0.1.0";
const PROTOCOL = 2;
const TAG = "data-ae";
const USAGE = "data-ae-p";
const INDEX = "data-ae-i";
const COMPONENT = "data-ae-c";
const SKIP_TAGS = new Set(["HTML", "HEAD", "BODY", "SCRIPT", "STYLE", "LINK", "META", "TITLE", "NOSCRIPT", "TEMPLATE"]);
const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
const MEDIA = new Set(["IMG", "PICTURE", "VIDEO", "IFRAME", "SVG", "CANVAS"]);
const TEXTLIKE = new Set(["P", "SPAN", "LI", "BLOCKQUOTE", "LABEL", "SMALL", "STRONG", "EM", "TD", "TH", "DT", "DD", "FIGCAPTION", "B", "I", "CODE", "PRE", "TIME", "CITE", "ADDRESS"]);

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function editFlag(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("armature") === "edit";
  } catch {
    return false;
  }
}

function withEditFlag(href: string): string {
  try {
    const url = new URL(href, window.location.href);
    url.searchParams.set("armature", "edit");
    return url.pathname + url.search + url.hash;
  } catch {
    return href;
  }
}

function parseLoc(value: string | null): Loc | null {
  if (!value) return null;
  const match = /^(.*):(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  return { file: match[1] as string, line: Number(match[2]), col: Number(match[3]) };
}

function toRect(element: Element): Rect {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

const num = (value: string) => Number.parseFloat(value) || 0;

function start(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if ((window as unknown as { __armatureEngine?: boolean }).__armatureEngine) return;
  (window as unknown as { __armatureEngine?: boolean }).__armatureEngine = true;
  if (!inIframe() || !editFlag()) return;
  const allowed = config.editorOrigins.map((origin) => origin.replace(/\/+$/, ""));

  let parentOrigin: string | null = null;
  let nonce: string | null = null;
  let mode: "edit" | "preview" = "edit";
  let selected: Element | null = null;
  let hovered: Element | null = null;
  let suppress = 0;

  const send = (message: Record<string, unknown>) => {
    if (!parentOrigin || !nonce) return;
    window.parent.postMessage({ ...message, nonce }, parentOrigin);
  };

  // --- ids ---------------------------------------------------------------------------------------------
  const ids = new WeakMap<Element, string>();
  const byId = new Map<string, Element>();

  const isTagged = (element: Element) => element.hasAttribute(TAG) || element.hasAttribute(USAGE);
  const taggedParent = (element: Element): Element | null => {
    let current = element.parentElement;
    while (current) {
      if (isTagged(current) && !SKIP_TAGS.has(current.tagName)) return current;
      current = current.parentElement;
    }
    return null;
  };

  const indicesOf = (element: Element): number[] => {
    const out: number[] = [];
    let current: Element | null = element;
    while (current) {
      const value = current.getAttribute(INDEX);
      if (value !== null && value !== "") out.unshift(Number(value));
      current = current.parentElement;
    }
    return out;
  };

  const assignIds = () => {
    byId.clear();
    const seen = new Map<string, number>();
    for (const element of Array.from(document.querySelectorAll(`[${TAG}],[${USAGE}]`))) {
      if (SKIP_TAGS.has(element.tagName)) continue;
      const base = `${element.getAttribute(TAG) ?? ""}|${element.getAttribute(USAGE) ?? ""}|${indicesOf(element).join(",")}`;
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}#${count}`;
      ids.set(element, id);
      byId.set(id, element);
    }
  };

  const idOf = (element: Element | null): string | null => (element ? (ids.get(element) ?? null) : null);

  const kindOf = (element: Element): string => {
    const tag = element.tagName;
    if (HEADINGS.has(tag)) return "heading";
    if (MEDIA.has(tag)) return "image";
    if (tag === "BUTTON") return "button";
    if (tag === "A") return /\b(button|btn|cta)\b/.test(element.className) ? "button" : "link";
    if (TEXTLIKE.has(tag)) return "text";
    const hasElementChildren = Array.from(element.children).some((child) => !SKIP_TAGS.has(child.tagName));
    if (!hasElementChildren && (element.textContent ?? "").trim()) return "text";
    return "container";
  };

  const describe = (element: Element) => {
    const style = getComputedStyle(element);
    const parent = taggedParent(element);
    return {
      id: idOf(element) ?? "",
      type: kindOf(element),
      tag: element.tagName.toLowerCase(),
      rect: toRect(element),
      padding: { top: num(style.paddingTop), right: num(style.paddingRight), bottom: num(style.paddingBottom), left: num(style.paddingLeft) } as Box,
      margin: { top: num(style.marginTop), right: num(style.marginRight), bottom: num(style.marginBottom), left: num(style.marginLeft) } as Box,
      parentId: idOf(parent),
      page: window.location.pathname,
      empty: element.childNodes.length === 0,
    };
  };

  const nodeRef = (element: Element) => {
    const ancestors: Loc[] = [];
    let current = taggedParent(element);
    while (current && ancestors.length < 12) {
      const loc = parseLoc(current.getAttribute(TAG)) ?? parseLoc(current.getAttribute(USAGE));
      if (loc) ancestors.push(loc);
      current = taggedParent(current);
    }
    const text = (element.textContent ?? "").trim();
    return {
      loc: parseLoc(element.getAttribute(TAG)),
      usage: parseLoc(element.getAttribute(USAGE)),
      indices: indicesOf(element),
      ancestors,
      component: element.getAttribute(COMPONENT),
      tag: element.tagName.toLowerCase(),
      text: text.length > 240 ? `${text.slice(0, 240)}…` : text,
      src: element.getAttribute("src"),
      alt: element.getAttribute("alt"),
      href: element.getAttribute("href"),
      className: typeof element.className === "string" ? element.className : "",
    };
  };

  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY });

  const allElements = () => Array.from(byId.values()).filter((element) => element.isConnected).map(describe);

  const sendMap = () => {
    assignIds();
    const elements = allElements();
    send({ type: `${PREFIX}elements:map`, elements, viewport: viewport() });
    const nodes: Record<string, unknown> = {};
    for (const [id, element] of byId) nodes[id] = nodeRef(element);
    send({ type: `${PREFIX}engine:nodes`, nodes });
  };
  const sendRects = () => {
    send({ type: `${PREFIX}elements:map`, elements: allElements(), viewport: viewport() });
    send({ type: `${PREFIX}viewport`, viewport: viewport() });
  };
  const sendSelect = (source: "canvas" | "editor" | "refresh") => {
    if (selected && !selected.isConnected) selected = null;
    send({ type: `${PREFIX}element:select`, id: idOf(selected), source });
    if (selected && source !== "refresh") sendComputed(selected);
  };
  const sendHover = () => send({ type: `${PREFIX}element:hover`, id: hovered && mode === "edit" ? idOf(hovered) : null });

  const COMPUTED_KEYS = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "fontSize", "fontWeight", "lineHeight", "fontFamily", "color", "backgroundColor", "borderRadius", "borderWidth", "borderColor", "width", "height", "textAlign", "gap", "display", "flexDirection", "justifyContent", "alignItems", "letterSpacing", "opacity"];
  const sendComputed = (element: Element) => {
    const style = getComputedStyle(element);
    const computed: Record<string, string> = {};
    for (const key of COMPUTED_KEYS) computed[key] = style[key as keyof CSSStyleDeclaration] as string;
    send({ type: `${PREFIX}engine:computed`, id: idOf(element), computed });
  };

  // --- rAF throttling ----------------------------------------------------------------------------------
  let frame = 0;
  let mapDirty = false;
  const schedule = (withMap: boolean) => {
    if (withMap) mapDirty = true;
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      if (mapDirty) {
        mapDirty = false;
        sendMap();
      } else {
        sendRects();
      }
      sendSelect("refresh");
      sendHover();
    });
  };
  let mutationTimer = 0;
  const observer = new MutationObserver(() => {
    if (suppress > 0) return;
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(() => schedule(true), 80);
  });

  // --- inline editing ------------------------------------------------------------------------------------
  type Editing = { host: HTMLElement; original: string; id: string };
  let editing: Editing | null = null;

  const runsOf = (node: Node, inherited: { bold?: boolean; italic?: boolean; href?: string } = {}): RichRun[] => {
    const out: RichRun[] = [];
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.textContent ?? "").replace(/ /g, " ");
        if (text) out.push({ ...inherited, text });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        const tag = element.tagName;
        if (tag === "BR") {
          out.push({ text: "", br: true });
          continue;
        }
        const next = { ...inherited };
        if (tag === "B" || tag === "STRONG" || (element.style.fontWeight && Number(element.style.fontWeight) >= 600) || element.style.fontWeight === "bold") next.bold = true;
        if (tag === "I" || tag === "EM" || element.style.fontStyle === "italic") next.italic = true;
        if (tag === "A" && element.getAttribute("href")) next.href = element.getAttribute("href") ?? undefined;
        if (tag === "DIV" || tag === "P") {
          if (out.length > 0) out.push({ text: "", br: true });
        }
        out.push(...runsOf(element, next));
      }
    }
    return out;
  };

  const stopEditing = (commit: boolean) => {
    if (!editing) return;
    const { host, original, id } = editing;
    const runs = runsOf(host);
    host.removeAttribute("contenteditable");
    host.style.outline = "";
    editing = null;
    suppress += 1;
    if (!commit) host.innerHTML = original;
    window.setTimeout(() => {
      suppress = Math.max(0, suppress - 1);
    }, 0);
    send({ type: `${PREFIX}element:edit:${commit ? "commit" : "cancel"}`, id, value: runs });
  };

  const startEditing = (element: Element) => {
    if (editing) stopEditing(true);
    const host = element as HTMLElement;
    editing = { host, original: host.innerHTML, id: idOf(element) ?? "" };
    host.setAttribute("contenteditable", "true");
    host.style.outline = "none";
    host.focus();
    const range = document.createRange();
    range.selectNodeContents(host);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    send({ type: `${PREFIX}element:edit:start`, id: editing.id, value: runsOf(host) });
    sendRichState();
  };

  const sendRichState = () => {
    if (!editing) return;
    const anchor = window.getSelection()?.anchorNode ?? null;
    const element = anchor ? (anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement) : null;
    const link = element?.closest("a") ?? null;
    send({
      type: `${PREFIX}richtext:state`,
      id: editing.id,
      state: { bold: document.queryCommandState("bold"), italic: document.queryCommandState("italic"), underline: false, strike: false, bulletList: false, orderedList: false, block: "p", link: link && editing.host.contains(link) ? link.getAttribute("href") : null, align: "left" },
    });
  };

  document.addEventListener("input", () => {
    if (!editing) return;
    send({ type: `${PREFIX}element:edit:input`, id: editing.id, value: runsOf(editing.host) });
    schedule(false);
  });
  document.addEventListener("selectionchange", () => {
    if (editing) sendRichState();
  });

  // --- pointer and keyboard --------------------------------------------------------------------------------
  const targetOf = (event: Event): Element | null => {
    const path = (event.composedPath ? event.composedPath() : []) as Node[];
    for (const node of path) {
      if (node instanceof Element && isTagged(node) && !SKIP_TAGS.has(node.tagName)) return node;
    }
    const element = event.target instanceof Element ? event.target : null;
    return element ? (isTagged(element) ? element : taggedParent(element)) : null;
  };

  document.addEventListener(
    "mousemove",
    (event) => {
      if (mode !== "edit" || editing) return;
      const target = targetOf(event);
      if (target !== hovered) {
        hovered = target;
        sendHover();
      }
    },
    { passive: true },
  );
  document.addEventListener("mouseleave", () => {
    hovered = null;
    sendHover();
  });

  document.addEventListener(
    "click",
    (event) => {
      if (mode === "preview") return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") ?? null;
      if (editing) {
        if (!editing.host.contains(event.target as Node)) stopEditing(true);
        else return;
      }
      event.preventDefault();
      event.stopPropagation();
      const target = targetOf(event);
      if (anchor && (event.metaKey || event.ctrlKey)) {
        const href = anchor.getAttribute("href") ?? "";
        send({ type: `${PREFIX}navigate`, href, external: /^https?:/.test(href) && !href.startsWith(window.location.origin), followed: true });
        window.location.assign(withEditFlag(href));
        return;
      }
      if (target === selected && target && kindOf(target) !== "container" && kindOf(target) !== "image" && event.detail >= 2) {
        startEditing(target);
        return;
      }
      selected = target;
      sendSelect("canvas");
      if (anchor) send({ type: `${PREFIX}navigate`, href: anchor.getAttribute("href") ?? "", external: false, followed: false });
    },
    true,
  );
  document.addEventListener(
    "dblclick",
    (event) => {
      if (mode === "preview" || editing) return;
      const target = targetOf(event);
      if (target && kindOf(target) !== "container" && kindOf(target) !== "image") {
        event.preventDefault();
        selected = target;
        sendSelect("canvas");
        startEditing(target);
      }
    },
    true,
  );
  document.addEventListener("contextmenu", (event) => {
    if (mode === "preview") return;
    const target = targetOf(event);
    if (!target) return;
    event.preventDefault();
    selected = target;
    sendSelect("canvas");
    send({ type: `${PREFIX}element:contextmenu`, id: idOf(target), x: event.clientX, y: event.clientY });
  });
  // Forms and buttons never act in edit mode.
  document.addEventListener("submit", (event) => mode === "edit" && event.preventDefault(), true);

  document.addEventListener("keydown", (event) => {
    if (editing) {
      if (event.key === "Escape") {
        event.preventDefault();
        stopEditing(false);
      } else if (event.key === "Enter" && !event.shiftKey && (HEADINGS.has(editing.host.tagName) || editing.host.tagName === "A" || editing.host.tagName === "BUTTON")) {
        event.preventDefault();
        stopEditing(true);
      }
      return;
    }
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    let shortcut: string | null = null;
    if (mod && key === "z") shortcut = event.shiftKey ? "redo" : "undo";
    else if (mod && key === "y") shortcut = "redo";
    else if (mod && key === "s") shortcut = "publish";
    else if (mod && key === "d") shortcut = "duplicate";
    else if (event.key === "Delete" || event.key === "Backspace") shortcut = "delete";
    else if (event.key === "Escape") shortcut = "escape";
    else if (event.key === "ArrowUp") shortcut = "up";
    else if (event.key === "ArrowDown") shortcut = "down";
    else if (event.key === "ArrowLeft") shortcut = "left";
    else if (event.key === "ArrowRight") shortcut = "right";
    else if (event.key === "?") shortcut = "help";
    if (shortcut) {
      event.preventDefault();
      send({ type: `${PREFIX}key`, key: shortcut });
    }
  });

  window.addEventListener("scroll", () => schedule(false), { passive: true });
  window.addEventListener("resize", () => schedule(false));

  // --- route changes ---------------------------------------------------------------------------------------
  const history = window.history;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method];
    history[method] = function patched(this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      window.setTimeout(() => {
        send({ type: `${PREFIX}route:changed`, route: window.location.pathname, title: document.title });
        schedule(true);
      }, 0);
      return result;
    };
  }
  window.addEventListener("popstate", () => {
    send({ type: `${PREFIX}route:changed`, route: window.location.pathname, title: document.title });
    schedule(true);
  });

  // --- stylesheet refresh (the plain-CSS fallback wrote into a linked stylesheet) ---------------------------
  const refreshStylesheets = (path: string) => {
    const name = path.split("/").pop() ?? path;
    for (const link of Array.from(document.querySelectorAll<HTMLLinkElement>("link[rel='stylesheet']"))) {
      if (!link.href.includes(name)) continue;
      const url = new URL(link.href);
      url.searchParams.set("armature-t", String(Date.now()));
      link.href = url.toString();
    }
  };

  const tailwindActive = (): boolean => {
    try {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const rule of Array.from(rules).slice(0, 80)) {
          const text = rule.cssText;
          if (text.includes("--tw-") || text.includes("tailwindcss")) return true;
        }
      }
    } catch {
      // ignore
    }
    return false;
  };

  // --- messages from the editor ------------------------------------------------------------------------------
  window.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: unknown; nonce?: unknown } | null;
    if (!data || typeof data.type !== "string" || !data.type.startsWith(PREFIX)) return;
    if (event.source !== window.parent) return;
    if (allowed.length > 0 && !allowed.includes(event.origin)) return;
    const message = data as Record<string, unknown> & { type: string; nonce: string };
    if (message.type === `${PREFIX}hello`) {
      parentOrigin = event.origin;
      nonce = String(message.nonce);
      send({ type: `${PREFIX}ready`, protocolVersion: PROTOCOL, bridgeVersion: BRIDGE_VERSION, route: window.location.pathname, title: document.title, kitVersion: "engine", sections: [], slots: [], layouts: [], tailwind: tailwindActive() });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
      schedule(true);
      return;
    }
    if (!nonce || message.nonce !== nonce) return;
    switch (message.type) {
      case `${PREFIX}mode`:
        mode = message.mode === "preview" ? "preview" : "edit";
        if (mode === "preview") {
          if (editing) stopEditing(true);
          hovered = null;
          sendHover();
        }
        break;
      case `${PREFIX}element:select`: {
        const id = typeof message.id === "string" ? message.id : null;
        selected = id ? (byId.get(id) ?? null) : null;
        if (selected && message.scroll) selected.scrollIntoView({ block: "center", behavior: "smooth" });
        sendSelect("editor");
        break;
      }
      case `${PREFIX}element:edit:start`: {
        const element = byId.get(String(message.id));
        if (element) {
          selected = element;
          startEditing(element);
        }
        break;
      }
      case `${PREFIX}element:edit:stop`:
        stopEditing(message.commit !== false);
        break;
      case `${PREFIX}richtext:command`: {
        if (!editing) break;
        editing.host.focus();
        const command = String(message.command);
        const value = typeof message.value === "string" ? message.value : undefined;
        if (command === "bold" || command === "italic") document.execCommand(command);
        else if (command === "link") {
          if (value) document.execCommand("createLink", false, value);
          else document.execCommand("unlink");
        } else if (command === "clear") {
          document.execCommand("removeFormat");
          document.execCommand("unlink");
        }
        sendRichState();
        send({ type: `${PREFIX}element:edit:input`, id: editing.id, value: runsOf(editing.host) });
        break;
      }
      case `${PREFIX}scroll`:
        if (typeof message.top === "number") window.scrollTo({ top: message.top });
        else if (typeof message.deltaY === "number") window.scrollBy({ top: message.deltaY });
        break;
      case `${PREFIX}navigate`:
        window.location.assign(withEditFlag(String(message.path)));
        break;
      case `${PREFIX}engine:css`:
        refreshStylesheets(String(message.path));
        break;
      case `${PREFIX}engine:refresh`:
        schedule(true);
        break;
      default:
        break;
    }
  });
}

start();
