/**
 * The visual-editing protocol: what the editor (the parent window) and the bridge
 * (running inside the client's site in an iframe) say to each other.
 *
 * Site contract v1.1, "Visual editing (optional)". The bridge file at
 * bridge/armature-bridge.ts is dependency-free and copied into each site, so it
 * carries its own copy of these shapes; `bridge/bridge.test.ts` asserts the two
 * stay in step. Pure module: types and constants only.
 *
 * Every message is `{ type: "armature:<name>", nonce, ...payload }`. The nonce is
 * minted by the editor for one iframe load and echoed by the bridge; either side
 * drops a message whose origin, source window or nonce is not the one it expects.
 *
 * Reserved for later stages (not sent by anything yet):
 *   armature:tokens:*    Stage 2, colours and fonts from design tokens
 *   armature:sections:*  Stage 3, add / move / hide sections
 */

/** Bumped only when a message shape changes incompatibly. Both sides compare it. */
export const VISUAL_PROTOCOL_VERSION = 1 as const;

/** The query flag the editor adds to the site URL. Nothing activates without it. */
export const EDIT_MODE_PARAM = "armature";
export const EDIT_MODE_VALUE = "edit";

/** The attribute a site can put on any element to map it by hand. */
export const FIELD_ATTRIBUTE = "data-armature-field";

/** How long the editor waits for the bridge to answer hello before it gives up. */
export const HANDSHAKE_TIMEOUT_MS = 10_000;

/**
 * A field path names one editable value:
 *   "home.hero.title"                 a page field
 *   "home.faq.items[2].question"      one item field inside a list
 */
export type FieldPath = string;

export type ParsedFieldPath = {
  slug: string;
  section: string;
  field: string;
  /** Present for a list item field. */
  index?: number;
  itemKey?: string;
};

const PATH_PATTERN = /^([a-z0-9][a-z0-9-]*)\.([a-z0-9][a-z0-9_]*)\.([a-z0-9][a-z0-9_]*)(?:\[(\d+)\]\.([a-z0-9][a-z0-9_]*))?$/;

export function parseFieldPath(path: string): ParsedFieldPath | null {
  const match = PATH_PATTERN.exec(path);
  if (!match) return null;
  const [, slug = "", section = "", field = "", index, itemKey] = match;
  if (index !== undefined && itemKey !== undefined) {
    return { slug, section, field, index: Number(index), itemKey };
  }
  return { slug, section, field };
}

export function fieldPath(slug: string, section: string, field: string, index?: number, itemKey?: string): FieldPath {
  const base = `${slug}.${section}.${field}`;
  return index !== undefined && itemKey !== undefined ? `${base}[${index}].${itemKey}` : base;
}

/** "slug.section.field" — the path of the whole field a (possibly item) path belongs to. */
export function fieldRoot(path: FieldPath): FieldPath {
  const parsed = parseFieldPath(path);
  return parsed ? `${parsed.slug}.${parsed.section}.${parsed.field}` : path;
}

/** A rectangle in the iframe's own viewport pixels. */
export type Rect = { x: number; y: number; width: number; height: number };

export type MappedKind = "text" | "image" | "link";

/** One element on the page that the bridge mapped to a field. */
export type MappedField = {
  path: FieldPath;
  kind: MappedKind;
  rect: Rect;
  /** Lower-case tag name of the mapped element ("h1", "img", "a"). */
  tag: string;
  /** For text: true when the element holds nothing but this field, so it can be typed into in place. */
  inline: boolean;
  /** For links: the destination the site rendered. */
  href?: string;
};

export type Viewport = { width: number; height: number; scrollX: number; scrollY: number };

export type BridgeErrorCode = "protocol_mismatch" | "not_allowed" | "edit_failed" | "navigate_failed";

// --- editor -> bridge ---------------------------------------------------------

export type HelloMessage = { type: "armature:hello"; nonce: string; protocolVersion: number };
export type DraftApplyMessage = { type: "armature:draft:apply"; nonce: string; fields: Record<FieldPath, unknown> };
export type SelectRequestMessage = { type: "armature:select"; nonce: string; path: FieldPath | null; scroll?: boolean };
export type EditStartRequestMessage = { type: "armature:edit:start"; nonce: string; path: FieldPath };
export type NavigateRequestMessage = { type: "armature:navigate"; nonce: string; path: string };
export type ModeMessage = { type: "armature:mode"; nonce: string; mode: "edit" | "preview" };

export type EditorToBridge =
  | HelloMessage
  | DraftApplyMessage
  | SelectRequestMessage
  | EditStartRequestMessage
  | NavigateRequestMessage
  | ModeMessage;

// --- bridge -> editor ---------------------------------------------------------

export type ReadyMessage = {
  type: "armature:ready";
  nonce: string;
  protocolVersion: number;
  bridgeVersion: string;
  route: string;
  title: string;
};
export type FieldsMapMessage = { type: "armature:fields:map"; nonce: string; fields: MappedField[]; viewport: Viewport };
export type HoverMessage = { type: "armature:hover"; nonce: string; field: MappedField | null };
/** `source`: "canvas" for a click on the page, "editor" answering a select request, "refresh" a fresh rectangle for the same selection. */
export type SelectMessage = { type: "armature:select"; nonce: string; field: MappedField | null; source: "canvas" | "editor" | "refresh" };
export type EditStartMessage = { type: "armature:edit:start"; nonce: string; path: FieldPath; value: string };
export type EditInputMessage = { type: "armature:edit:input"; nonce: string; path: FieldPath; value: string };
export type EditCommitMessage = { type: "armature:edit:commit"; nonce: string; path: FieldPath; value: string };
export type EditCancelMessage = { type: "armature:edit:cancel"; nonce: string; path: FieldPath };
export type RouteChangedMessage = { type: "armature:route:changed"; nonce: string; route: string; title: string };
/**
 * A link was clicked. `followed` is true when the bridge is navigating (Ctrl/Cmd-click, or any
 * click in preview); false for a plain click in edit mode, which the editor answers with a hint.
 */
export type NavigateMessage = { type: "armature:navigate"; nonce: string; href: string; external: boolean; followed: boolean };
export type ViewportMessage = { type: "armature:viewport"; nonce: string; viewport: Viewport };
export type ErrorMessage = { type: "armature:error"; nonce: string; code: BridgeErrorCode; message: string };
/** A keyboard shortcut pressed while the frame had focus, forwarded so the editor can act on it. */
export type ShortcutKey = "undo" | "redo" | "publish" | "next" | "help";
export type KeyMessage = { type: "armature:key"; nonce: string; key: ShortcutKey };

export type BridgeToEditor =
  | ReadyMessage
  | FieldsMapMessage
  | HoverMessage
  | SelectMessage
  | EditStartMessage
  | EditInputMessage
  | EditCommitMessage
  | EditCancelMessage
  | RouteChangedMessage
  | NavigateMessage
  | ViewportMessage
  | ErrorMessage
  | KeyMessage;

export const EDITOR_MESSAGE_TYPES: readonly EditorToBridge["type"][] = [
  "armature:hello",
  "armature:draft:apply",
  "armature:select",
  "armature:edit:start",
  "armature:navigate",
  "armature:mode",
];

export const BRIDGE_MESSAGE_TYPES: readonly BridgeToEditor["type"][] = [
  "armature:ready",
  "armature:fields:map",
  "armature:hover",
  "armature:select",
  "armature:edit:start",
  "armature:edit:input",
  "armature:edit:commit",
  "armature:edit:cancel",
  "armature:route:changed",
  "armature:navigate",
  "armature:viewport",
  "armature:error",
  "armature:key",
];

export function isBridgeMessage(value: unknown): value is BridgeToEditor {
  if (!value || typeof value !== "object") return false;
  const record = value as { type?: unknown; nonce?: unknown };
  return typeof record.type === "string" && (BRIDGE_MESSAGE_TYPES as readonly string[]).includes(record.type) && typeof record.nonce === "string";
}

/** The site URL the editor loads in the iframe: the page path plus the edit flag. */
export function editUrl(liveUrl: string, pagePath: string): string {
  const base = new URL(pagePath || "/", liveUrl.endsWith("/") ? liveUrl : `${liveUrl}/`);
  base.searchParams.set(EDIT_MODE_PARAM, EDIT_MODE_VALUE);
  return base.toString();
}
