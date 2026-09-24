/**
 * The validator for layout files and the site kit: THE one set of rules, shared by the
 * site (this folder is copied in verbatim), the dashboard and the publish function, so
 * a site can never pass its own checks while Armature rejects its files.
 *
 * It is tolerant on purpose. One bad value never takes a page down:
 *   - an invalid setting is ignored (dropped from the cleaned value) and reported; a
 *     required content setting (a heading's text, an accordion's items) gets a safe
 *     stand-in ("" or []) so the element still renders with that one value ignored;
 *   - only an element that cannot be read at all (no id, no type, content settings of
 *     the wrong shape) becomes an "unsupported" placeholder the site skips and the editor names;
 *   - the site kit fills anything unreadable from the default kit;
 *   - only a file that is not a layout at all (no root, no slug) fails to load.
 * Every problem is reported in plain English with the setting, the value found and what
 * is allowed, plus the raw value, so a publish can put it back untouched. The rules are
 * as wide as CSS itself wherever that is safe (unitless line-heights, negative spacing,
 * decimals, vw/vh/rem/ch, every colour syntax, variable font weights) and stay strict
 * only where a value could reach the page as code: links, media addresses, attribute
 * names, and anything emitted into a stylesheet.
 *
 * No React, no dependencies.
 */
import { defaultSiteKit } from "./defaults.ts";
import { CHROME_SLUGS, type Element, type LayoutDoc, type PostDoc, type PostIndex, type SiteKit, type Taxonomies } from "./types.ts";
import { UNSUPPORTED_TYPE } from "./types.ts";
import { UNITS, isColorValue, parseKitRef, parseSize } from "./values.ts";

// --- limits and patterns -------------------------------------------------------------------

export const LAYOUT_LIMITS = {
  /** Serialized layout file size. */
  fileBytes: 2 * 1024 * 1024,
  depth: 20,
  elementsPerPage: 5000,
  textChars: 20_000,
  richTextChars: 100_000,
  customCssChars: 50_000,
  attributes: 40,
} as const;

export const ELEMENT_ID_PATTERN = /^[a-z0-9]{8}$/;
export const PAGE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
/** A page slug, or one of the chrome parts (_header, _footer). */
export const isLayoutSlug = (slug: string): boolean => PAGE_SLUG_PATTERN.test(slug) || (CHROME_SLUGS as readonly string[]).includes(slug);
export const ELEMENT_TYPE_PATTERN = /^[a-z][a-z0-9-]*$/;

export const ATTRIBUTE_NAME = /^(?!on)[a-z][a-z0-9-]{0,40}$/i;
export const FORBIDDEN_ATTRIBUTES = new Set(["href", "src", "style", "srcdoc", "action", "formaction", "xlink:href", "class", "id"]);

/** Element types that carry children. */
export const CONTAINER_TYPES: readonly string[] = ["container", "grid"];
/** Widgets only agency staff may add or change (the publish function enforces it). */
export const AGENCY_ONLY_TYPES: readonly string[] = ["html"];
export const SOCIAL_NETWORKS = ["facebook", "instagram", "x", "twitter", "linkedin", "youtube", "tiktok", "pinterest", "github", "email", "phone", "website", "rss", "whatsapp"] as const;

/** Links may only use https, http, mailto, tel, a site path (/...) or a fragment (#...). */
export const isAllowedHref = (value: string): boolean => {
  if (value === "") return true;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/") || value.startsWith("#")) return true;
  return /^(https?:\/\/|mailto:|tel:)/i.test(value);
};
/** Images and media must live on the site itself or on https (or be an inline picture on its way to publish). */
export const isAllowedMediaSrc = (value: string): boolean => value === "" || (value.startsWith("/") && !value.startsWith("//") && !value.includes("..")) || /^https:\/\//i.test(value) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(value);
/** Video addresses: YouTube, Vimeo and Wistia pages, a generic https embed, or a file on the site or https. */
export const isAllowedVideoUrl = (source: string, url: string): boolean => {
  if (url === "") return true;
  if (source === "youtube") return /^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be)\//i.test(url);
  if (source === "vimeo") return /^https:\/\/(www\.|player\.)?vimeo\.com\//i.test(url);
  if (source === "wistia") return /^https:\/\/([a-z0-9-]+\.)?(wistia\.com|wistia\.net|wi\.st)\//i.test(url);
  if (source === "embed") return /^https:\/\//i.test(url) && !url.startsWith("data:");
  return isAllowedMediaSrc(url) && !url.startsWith("data:");
};

// --- problems --------------------------------------------------------------------------------

export type ProblemPath = (string | number)[];
/** ignored: the setting was dropped. element: the element became a placeholder. file: the file could not load (or the default kit applies). */
export type ProblemEffect = "ignored" | "element" | "file";

export type Problem = {
  /** Where in the file, e.g. ["root", 0, "children", 2, "style", "typography", "fontWeight"]. */
  path: ProblemPath;
  effect: ProblemEffect;
  /** "Style › Typography › Font weight", for people. */
  setting: string;
  /** The value found, as short text. */
  found: string;
  /** What is allowed, in plain words. */
  allowed: string;
  /** The raw value, exactly as it was, so a publish can put it back. */
  value: unknown;
  /** What took its place (site kit defaults), so an untouched default can be told from an edit. */
  filled?: unknown;
  /** The element the setting belongs to (its id in the cleaned layout). */
  elementId?: string;
  elementLabel?: string;
  elementType?: string;
  /** For "ignored" problems: the dropped setting's path inside its element (or inside the file when it has no element), for restoring on publish. */
  relativePath?: ProblemPath;
};

export type CheckReport<T> = {
  /** The cleaned value, or null when the file could not load at all. */
  value: T | null;
  problems: Problem[];
};

const INVALID: unique symbol = Symbol("invalid");
type Invalid = typeof INVALID;

type Detail = { path: ProblemPath; allowed: string; value: unknown };
type Ctx = {
  problems: Problem[];
  /** The deepest failure so far, so an outer report can name the exact setting. */
  detail: Detail | null;
  /** Values to fill required keys from (the default kit). */
  defaults?: unknown;
  element?: { id: string; label?: string; type: string; base: ProblemPath };
};

export type Check<T = unknown> = {
  run: (value: unknown, ctx: Ctx, path: ProblemPath) => T | Invalid;
  allowed: string;
  required?: boolean;
  /**
   * A safe stand-in for a required value that could not be read ("" for text, [] for a
   * list…), so an element of a known type still renders with that one value ignored
   * instead of becoming an "Unsupported element". Only an element's own content settings
   * are filled this way; a bad list item is still dropped from its list. Returns undefined
   * when no safe stand-in exists (an object whose required parts have none).
   */
  empty?: () => T | undefined;
};

/** The stand-in for a required value, when the check has one. */
const emptyOf = <T>(check: Check<T>): T | undefined => check.empty?.();

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A short, quoted rendering of a value for a message. */
export function shortText(value: unknown): string {
  if (value === undefined) return "nothing";
  if (typeof value === "string") return `"${value.length > 60 ? `${value.slice(0, 57)}…` : value}"`;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  } catch {
    return "(unreadable)";
  }
}

const fail = (ctx: Ctx, path: ProblemPath, allowed: string, value: unknown): Invalid => {
  if (!ctx.detail) ctx.detail = { path, allowed, value };
  return INVALID;
};

/** Reads the detail through a call, so control-flow narrowing after `ctx.detail = null` does not hide what a check just set. */
const currentDetail = (ctx: Ctx): Detail | null => ctx.detail;

const startsWith = (path: ProblemPath, prefix: ProblemPath): boolean => prefix.length <= path.length && prefix.every((part, index) => path[index] === part);

/** Record a problem for a value at `path`, using the deepest failure detail when it lies inside. */
function report(ctx: Ctx, path: ProblemPath, allowed: string, value: unknown, effect: ProblemEffect, extra: Partial<Problem> = {}): void {
  const detail = ctx.detail && startsWith(ctx.detail.path, path) ? ctx.detail : null;
  ctx.detail = null;
  const at = detail?.path ?? path;
  const problem: Problem = {
    path: at,
    effect,
    setting: settingLabel(ctx.element ? at.slice(ctx.element.base.length) : at),
    found: shortText(detail ? detail.value : value),
    allowed: detail?.allowed ?? allowed,
    value,
    ...extra,
  };
  if (effect === "ignored") {
    // The dropped key itself (not the deeper detail), relative to the element or the file.
    problem.relativePath = ctx.element ? path.slice(ctx.element.base.length) : path;
    if (ctx.element) {
      problem.elementId = ctx.element.id;
      problem.elementLabel = ctx.element.label;
      problem.elementType = ctx.element.type;
    }
  }
  ctx.problems.push(problem);
}

// --- a tiny schema language ----------------------------------------------------------------------

const req = <T>(check: Check<T>): Check<T> => ({ ...check, required: true });

const str = (max: number, options: { pattern?: RegExp; allowed?: string; min?: number } = {}): Check<string> => ({
  allowed: options.allowed ?? `text up to ${max} characters`,
  empty: () => "",
  run: (value, ctx, path) => {
    if (typeof value !== "string" || value.length > max || value.length < (options.min ?? 0) || (options.pattern && !options.pattern.test(value))) return fail(ctx, path, options.allowed ?? `text up to ${max} characters`, value);
    return value;
  },
});

const num = (min: number, max: number, options: { int?: boolean; allowed?: string } = {}): Check<number> => {
  const allowed = options.allowed ?? `${options.int ? "a whole number" : "a number"} from ${min} to ${max}`;
  return {
    allowed,
    empty: () => (min <= 0 && max >= 0 ? 0 : min),
    run: (value, ctx, path) => {
      const number = typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : value;
      if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max || (options.int && !Number.isInteger(number))) return fail(ctx, path, allowed, value);
      return number;
    },
  };
};

const bool = (): Check<boolean> => ({ allowed: "on or off (true or false)", empty: () => false, run: (value, ctx, path) => (typeof value === "boolean" ? value : fail(ctx, path, "on or off (true or false)", value)) });

const lit = <T extends string | number>(literal: T): Check<T> => ({ allowed: `exactly ${shortText(literal)}`, empty: () => literal, run: (value, ctx, path) => (value === literal ? literal : fail(ctx, path, `exactly ${shortText(literal)}`, value)) });

const en = <T extends string>(values: readonly T[], label?: string): Check<T> => {
  const allowed = label ?? `one of ${values.map((item) => (item === "" ? '""' : item)).join(", ")}`;
  return { allowed, empty: () => values[0] as T, run: (value, ctx, path) => (typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : fail(ctx, path, allowed, value)) };
};

const nullable = <T>(check: Check<T>): Check<T | null> => ({ allowed: `${check.allowed}, or nothing`, empty: () => null, run: (value, ctx, path) => (value === null ? null : check.run(value, ctx, path)) });

/** A list. A bad item is dropped and reported; the list fails only when too few remain. */
const arr = <T>(inner: Check<T>, max: number, min = 0): Check<T[]> => ({
  allowed: `a list of up to ${max} items, each ${inner.allowed}`,
  empty: () => [],
  run: (value, ctx, path) => {
    if (!Array.isArray(value)) return fail(ctx, path, `a list (${inner.allowed})`, value);
    const out: T[] = [];
    value.slice(0, max).forEach((item, index) => {
      const result = inner.run(item, ctx, [...path, index]);
      if (result === INVALID) report(ctx, [...path, index], inner.allowed, item, "ignored");
      else out.push(result);
    });
    if (out.length < min) return fail(ctx, path, `a list of at least ${min} (${inner.allowed})`, value);
    return out;
  },
});

const union = <T>(checks: Check<T>[], allowed?: string): Check<T> => ({
  allowed: allowed ?? checks.map((check) => check.allowed).join(", or "),
  empty: checks.find((check) => check.empty)?.empty,
  run: (value, ctx, path) => {
    const outer = ctx.detail;
    // The branch that got furthest (the deepest failure) names the real problem, e.g. a
    // link mark's address rather than "not a text mark".
    let best: Detail | null = null;
    for (const check of checks) {
      ctx.detail = null;
      const result = check.run(value, ctx, path);
      if (result !== INVALID) {
        ctx.detail = outer;
        return result;
      }
      const found = currentDetail(ctx);
      if (found && found.path.length > path.length && (!best || found.path.length > best.path.length)) best = found;
    }
    ctx.detail = outer ?? best;
    return fail(ctx, path, allowed ?? checks.map((check) => check.allowed).join(", or "), value);
  },
});

const refine = <T>(check: Check<T>, predicate: (value: T) => boolean, allowed: string): Check<T> => ({
  allowed: check.allowed,
  empty: check.empty,
  run: (value, ctx, path) => {
    const result = check.run(value, ctx, path);
    if (result === INVALID) return result;
    return predicate(result) ? result : fail(ctx, path, allowed, value);
  },
});

const lazy = <T>(make: () => Check<T>, allowed: string): Check<T> => {
  let cached: Check<T> | null = null;
  return { allowed, run: (value, ctx, path) => (cached ??= make()).run(value, ctx, path) };
};

/** True at an element's own content settings (`props`), the one place a required value is filled with a stand-in. */
const atElementProps = (ctx: Ctx, path: ProblemPath): boolean => !!ctx.element && path.length === ctx.element.base.length + 1 && path[path.length - 1] === "props";

/**
 * An object. Optional keys that fail are dropped and reported; a required key that fails
 * makes the object fail, unless the context can fill it from defaults or, for an element's
 * own content settings, from the check's stand-in (an empty text, an empty list). Unknown
 * keys pass through untouched (they are never read, and a publish keeps them).
 */
const obj = (shape: Record<string, Check>, label = "an object"): Check<Record<string, unknown>> => ({
  allowed: label,
  empty: () => {
    const out: Record<string, unknown> = {};
    for (const [key, check] of Object.entries(shape)) {
      if (!check.required) continue;
      const stand = emptyOf(check);
      if (stand === undefined) return undefined;
      out[key] = stand;
    }
    return out;
  },
  run: (value, ctx, path) => {
    if (!isRecord(value)) return fail(ctx, path, label, value);
    const out: Record<string, unknown> = { ...value };
    for (const [key, check] of Object.entries(shape)) {
      const at = [...path, key];
      const raw = value[key];
      const result = raw === undefined ? INVALID : check.run(raw, ctx, at);
      if (result !== INVALID) {
        out[key] = result;
        continue;
      }
      if (!check.required) {
        if (raw !== undefined) report(ctx, at, check.allowed, raw, "ignored");
        delete out[key];
        continue;
      }
      const filled = ctx.defaults === undefined ? undefined : readPath(ctx.defaults, at);
      if (filled !== undefined) {
        report(ctx, at, check.allowed, raw, "ignored", { filled });
        out[key] = filled;
        continue;
      }
      const stand = atElementProps(ctx, path) ? emptyOf(check) : undefined;
      if (stand !== undefined) {
        report(ctx, at, `${check.allowed} (it is required)`, raw, "ignored", { filled: stand });
        out[key] = stand;
        continue;
      }
      if (raw === undefined) return fail(ctx, at, `${check.allowed} (it is required)`, undefined);
      return INVALID;
    }
    return out;
  },
});

/** A responsive value: the value itself, or { desktop, tablet?, mobile? }. A bad override is dropped; a bad desktop value fails. */
const responsive = <T>(inner: Check<T>): Check<unknown> => ({
  allowed: `${inner.allowed} (or per device: desktop, tablet, mobile)`,
  empty: inner.empty,
  run: (value, ctx, path) => {
    if (isRecord(value) && "desktop" in value) {
      const desktop = inner.run(value["desktop"], ctx, [...path, "desktop"]);
      if (desktop === INVALID) return INVALID;
      const out: Record<string, unknown> = { desktop };
      for (const device of ["tablet", "mobile"]) {
        if (value[device] === undefined) continue;
        const result = inner.run(value[device], ctx, [...path, device]);
        if (result === INVALID) report(ctx, [...path, device], inner.allowed, value[device], "ignored");
        else out[device] = result;
      }
      return out;
    }
    return inner.run(value, ctx, path);
  },
});

const record = (keyPattern: RegExp, inner: Check, max = 200): Check<Record<string, unknown>> => ({
  allowed: `a map of names to ${inner.allowed}`,
  empty: () => ({}),
  run: (value, ctx, path) => {
    if (!isRecord(value)) return fail(ctx, path, `a map of names to ${inner.allowed}`, value);
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value).slice(0, max)) {
      if (!keyPattern.test(key)) {
        report(ctx, [...path, key], "a plain attribute name", raw, "ignored");
        continue;
      }
      const result = inner.run(raw, ctx, [...path, key]);
      if (result === INVALID) report(ctx, [...path, key], inner.allowed, raw, "ignored");
      else out[key] = result;
    }
    return out;
  },
});

/** Read a nested value by path (arrays by index). */
export function readPath(target: unknown, path: ProblemPath): unknown {
  let current: unknown = target;
  for (const part of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[part];
  }
  return current;
}

// --- primitives ----------------------------------------------------------------------------------

const SIZE_ALLOWED = `a size such as 12px, 1.25rem, 50%, -0.02em, 1.4 (no unit), 0 or auto (units: ${UNITS.filter(Boolean).join(", ")})`;
/** { value, unit }, or a CSS string such as "12px" / "1.4" / "auto" (read into the object form). */
const size: Check = {
  allowed: SIZE_ALLOWED,
  run: (value, ctx, path) => {
    if (typeof value === "string") {
      const parsed = parseSize(value, "");
      return parsed ?? fail(ctx, path, SIZE_ALLOWED, value);
    }
    if (typeof value === "number" && Number.isFinite(value)) return { value, unit: value === 0 ? "px" : "" };
    if (!isRecord(value)) return fail(ctx, path, SIZE_ALLOWED, value);
    const number = typeof value["value"] === "string" && /^-?\d*\.?\d+$/.test(value["value"]) ? Number(value["value"]) : value["value"];
    const unit = value["unit"] === undefined && value["value"] === 0 ? "px" : value["unit"];
    if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > 1_000_000 || typeof unit !== "string" || !(UNITS as readonly string[]).includes(unit)) return fail(ctx, path, SIZE_ALLOWED, value);
    return { value: number, unit };
  },
};
const sides = (inner: Check) => obj({ top: inner, right: inner, bottom: inner, left: inner }, `top, right, bottom and left, each ${inner.allowed}`);
const corners = (inner: Check) => obj({ topLeft: inner, topRight: inner, bottomRight: inner, bottomLeft: inner }, `four corners, each ${inner.allowed}`);

const COLOR_ALLOWED = "a colour: #1f3a2e, #1f3a2e80, #fff, rgb()/rgba()/hsl()/hsla()/oklch() and the other colour functions, a named colour such as white, transparent, currentColor, var(--name), or a kit colour such as kit:color.primary";
const color: Check<string> = { allowed: COLOR_ALLOWED, run: (value, ctx, path) => (isColorValue(value) ? (value as string).trim() : fail(ctx, path, COLOR_ALLOWED, value)) };

const FONT_ALLOWED = 'a font family such as Poppins or "Helvetica Neue", Arial, or a kit font such as kit:font.heading';
const fontRef: Check<string> = {
  allowed: FONT_ALLOWED,
  run: (value, ctx, path) => {
    if (typeof value !== "string" || value.length > 200 || /[;{}<>\\]/.test(value)) return fail(ctx, path, FONT_ALLOWED, value);
    if (value.startsWith("kit:") && parseKitRef(value)?.group !== "font") return fail(ctx, path, FONT_ALLOWED, value);
    return value;
  },
};

const kitRef = (group: "type" | "button", example: string): Check<string> => {
  const allowed = `a kit ${group === "type" ? "text style" : "button style"} reference such as ${example}`;
  return { allowed, run: (value, ctx, path) => (typeof value === "string" && value.length <= 60 && parseKitRef(value)?.group === group ? value : fail(ctx, path, allowed, value)) };
};

const HREF_ALLOWED = "a link starting with https://, http://, mailto:, tel:, / or #";
const href: Check<string> = { allowed: HREF_ALLOWED, empty: () => "", run: (value, ctx, path) => (typeof value === "string" && value.length <= 2000 && isAllowedHref(value) ? value : fail(ctx, path, HREF_ALLOWED, value)) };
const MEDIA_ALLOWED = "a picture or video on this site (/assets/...) or an https:// address";
const mediaSrc: Check<string> = { allowed: MEDIA_ALLOWED, empty: () => "", run: (value, ctx, path) => (typeof value === "string" && value.length <= 2_000_000 && isAllowedMediaSrc(value) ? value : fail(ctx, path, MEDIA_ALLOWED, value)) };

const link = obj({ href: req(href), newTab: bool(), rel: str(60) }, "a link with an address");

const iconNode: Check = {
  allowed: "an SVG shape (path, circle, rect, line, polyline, polygon, ellipse) with its attributes",
  run: (value, ctx, path) => {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" || !["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"].includes(value[0])) return fail(ctx, path, "an SVG shape (path, circle, rect, line, polyline, polygon, ellipse) with its attributes", value);
    const attrs = record(/^[a-zA-Z-]{1,32}$/, str(2000)).run(value[1], ctx, [...path, 1]);
    if (attrs === INVALID) return INVALID;
    return [value[0], attrs];
  },
};
const icon = obj({ name: req(str(64)), nodes: req(arr(iconNode, 40)) }, "an icon (name and SVG nodes)");
const gap = obj({ column: size, row: size }, "column and row gaps");

// --- style ------------------------------------------------------------------------------------------

const FONT_WEIGHT_ALLOWED = "a whole number from 1 to 1000 (100 thin … 400 regular … 650 … 700 bold … 900 black), or normal, bold, lighter or bolder";
const fontWeight: Check = {
  allowed: FONT_WEIGHT_ALLOWED,
  run: (value, ctx, path) => {
    if (typeof value === "string" && ["normal", "bold", "lighter", "bolder"].includes(value.trim().toLowerCase())) return value.trim().toLowerCase();
    const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
    if (typeof number === "number" && Number.isInteger(number) && number >= 1 && number <= 1000) return number;
    return fail(ctx, path, FONT_WEIGHT_ALLOWED, value);
  },
};
const textAlign = en(["left", "center", "right", "justify", "start", "end"]);
const textTransform = en(["none", "uppercase", "lowercase", "capitalize"]);

const typography = obj(
  {
    preset: kitRef("type", "kit:type.h2"),
    fontFamily: fontRef,
    fontSize: responsive(size),
    fontWeight: responsive(fontWeight),
    textTransform: responsive(textTransform),
    fontStyle: responsive(en(["normal", "italic", "oblique"])),
    textDecoration: responsive(en(["none", "underline", "line-through", "overline"])),
    lineHeight: responsive(size),
    letterSpacing: responsive(size),
    wordSpacing: responsive(size),
    textAlign: responsive(textAlign),
  },
  "typography settings",
);

const shadow = obj({ x: req(num(-1000, 1000)), y: req(num(-1000, 1000)), blur: req(num(0, 1000)), spread: num(-1000, 1000), color: req(color), inset: bool() }, "a shadow with x, y, blur and colour");
const borderStyle = en(["none", "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset", "hidden"]);
const border = obj({ style: responsive(borderStyle), width: responsive(sides(size)), color: responsive(color), radius: responsive(corners(size)) }, "border settings");

const BG_SIZE_ALLOWED = "auto, cover, contain, or a CSS background size such as 100% auto";
const backgroundSize: Check<string> = { allowed: BG_SIZE_ALLOWED, run: (value, ctx, path) => (typeof value === "string" && value.length <= 40 && /^[a-z0-9%\s.]+$/i.test(value) ? value : fail(ctx, path, BG_SIZE_ALLOWED, value)) };
const background = union(
  [
    obj({ kind: req(lit("none")) }, "no background"),
    obj({ kind: req(lit("color")), color: req(color) }, "a colour background"),
    obj({ kind: req(lit("gradient")), type: req(en(["linear", "radial"])), angle: num(-360, 360), stops: req(arr(obj({ color: req(color), position: req(num(0, 100)) }, "a stop with a colour and a position 0–100"), 10, 2)) }, "a gradient with at least two stops"),
    obj(
      {
        kind: req(lit("image")),
        src: req(mediaSrc),
        position: str(40, { pattern: /^[a-z0-9%\s.-]*$/i, allowed: "a position such as center, top left or 50% 30%" }),
        attachment: en(["scroll", "fixed"]),
        repeat: en(["no-repeat", "repeat", "repeat-x", "repeat-y"]),
        size: backgroundSize,
        focal: obj({ x: req(num(0, 100)), y: req(num(0, 100)) }, "a focal point with x and y from 0 to 100"),
      },
      "an image background with a picture",
    ),
    obj({ kind: req(lit("video")), src: req(mediaSrc), poster: mediaSrc, loop: bool(), playOnMobile: bool() }, "a video background with a video address"),
  ],
  'a background: { kind: "none" | "color" | "gradient" | "image" | "video", … }',
);
const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"] as const;
const backgroundOverlay = obj({ background: req(background), opacity: req(num(0, 1)), blend: en(BLEND_MODES) }, "an overlay with a background and an opacity from 0 to 1");
const textStroke = obj({ width: req(num(0, 50)), color: req(color) }, "a stroke width (0–50) and colour");

const styleBaseShape = {
  typography,
  color: responsive(color),
  textShadow: responsive(shadow),
  textStroke: responsive(textStroke),
  boxShadow: responsive(shadow),
  border,
  background: responsive(background),
  backgroundOverlay: responsive(backgroundOverlay),
  opacity: responsive(num(0, 1)),
  mixBlendMode: responsive(en(BLEND_MODES)),
  transition: num(0, 10_000, { allowed: "a duration in milliseconds from 0 to 10000" }),
};
const styleBase = obj(styleBaseShape, "style settings");
const style = obj({ ...styleBaseShape, hover: styleBase }, "style settings");

// --- advanced -----------------------------------------------------------------------------------------

const ATTR_ALLOWED = "an attribute name of letters, digits and -, not starting with 'on', and not href, src, style, class, id, action or srcdoc";
const attribute = obj({ name: req({ allowed: ATTR_ALLOWED, run: (value, ctx, path) => (typeof value === "string" && ATTRIBUTE_NAME.test(value) && !FORBIDDEN_ATTRIBUTES.has(value.toLowerCase()) ? value : fail(ctx, path, ATTR_ALLOWED, value)) }), value: req(str(2000)) }, "an attribute with a name and a value");

const advanced = obj(
  {
    margin: responsive(sides(size)),
    padding: responsive(sides(size)),
    width: responsive(en(["full", "inline", "custom"])),
    customWidth: responsive(size),
    maxWidth: responsive(size),
    alignSelf: responsive(en(["auto", "flex-start", "center", "flex-end", "stretch", "start", "end"])),
    order: responsive(num(-9999, 9999, { int: true })),
    flexGrow: responsive(num(0, 999)),
    flexShrink: responsive(num(0, 999)),
    gridColumnSpan: responsive(num(1, 48, { int: true })),
    gridRowSpan: responsive(num(1, 96, { int: true })),
    position: obj({ type: req(en(["default", "absolute", "fixed", "relative", "sticky"])), top: responsive(size), right: responsive(size), bottom: responsive(size), left: responsive(size), zIndex: num(-9999, 99_999, { int: true }) }, "a position with a type"),
    animation: obj({ type: req(en(["none", "fadeIn", "fadeInUp", "fadeInDown", "fadeInLeft", "fadeInRight", "zoomIn", "slideInUp", "bounceIn"])), duration: num(0, 60_000), delay: num(0, 60_000) }, "an entrance animation with a type"),
    hoverAnimation: en(["none", "grow", "shrink", "float", "sink", "rotate", "pulse", "wobble"]),
    scroll: obj({ parallax: num(-10, 10) }, "scroll effects"),
    hidden: obj({ desktop: bool(), tablet: bool(), mobile: bool() }, "hidden per device"),
    cssId: str(64, { pattern: /^[a-zA-Z_][a-zA-Z0-9_-]*$|^$/, allowed: "a CSS id that starts with a letter and uses letters, digits, - and _" }),
    cssClasses: str(1000, { pattern: /^[^<>"'&\\]*$/, allowed: "class names separated by spaces (no quotes or angle brackets)" }),
    attributes: arr(attribute, LAYOUT_LIMITS.attributes),
    customCss: str(LAYOUT_LIMITS.customCssChars, { allowed: `custom CSS up to ${LAYOUT_LIMITS.customCssChars} characters` }),
  },
  "advanced settings",
);

// --- rich text ----------------------------------------------------------------------------------------

const richMark = union(
  [
    obj({ type: req(lit("bold")) }, "bold"),
    obj({ type: req(lit("italic")) }, "italic"),
    obj({ type: req(lit("underline")) }, "underline"),
    obj({ type: req(lit("strike")) }, "strike"),
    obj({ type: req(lit("code")) }, "code"),
    obj({ type: req(lit("link")), attrs: req(obj({ href: req(href), target: nullable(en(["_blank"])) }, "link attributes with an address")) }, "a link"),
    obj({ type: req(lit("textStyle")), attrs: req(obj({ color }, "a text colour")) }, "a text colour"),
    obj({ type: req(lit("highlight")), attrs: req(obj({ color }, "a highlight colour")) }, "a highlight"),
  ],
  "a text mark: bold, italic, underline, strike, code, link, textStyle or highlight",
);
const richInline = union(
  [obj({ type: req(lit("text")), text: req(str(LAYOUT_LIMITS.richTextChars)), marks: arr(richMark, 8) }, "a run of text"), obj({ type: req(lit("hardBreak")) }, "a line break")],
  "a run of text or a line break",
);
const richBlock: Check = lazy(
  () =>
    union(
      [
        obj({ type: req(lit("paragraph")), attrs: obj({ textAlign }, "paragraph attributes"), content: arr(richInline, 5000) }, "a paragraph"),
        obj({ type: req(lit("heading")), attrs: req(obj({ level: req(num(1, 6, { int: true })), textAlign }, "a heading level 1–6")), content: arr(richInline, 5000) }, "a heading"),
        obj({ type: req(lit("bulletList")), content: req(arr(richListItem, 500)) }, "a bullet list"),
        obj({ type: req(lit("orderedList")), attrs: obj({ start: num(0, 1_000_000, { int: true }) }, "list attributes"), content: req(arr(richListItem, 500)) }, "a numbered list"),
        obj({ type: req(lit("blockquote")), content: req(arr(richBlock, 200)) }, "a quote"),
      ],
      "a paragraph, heading, list or quote",
    ),
  "a paragraph, heading, list or quote",
);
const richListItem: Check = lazy(() => obj({ type: req(lit("listItem")), content: req(arr(richBlock, 100)) }, "a list item"), "a list item");
const richDoc = obj({ type: req(lit("doc")), content: req(arr(richBlock, 1000)) }, "a rich-text document");

// --- widget props -------------------------------------------------------------------------------------------

const containerTag = en(["div", "section", "header", "footer", "article", "aside", "nav", "main"]);
const minHeight = responsive(union([size, lit("screen")], `${SIZE_ALLOWED}, or "screen"`));
const layoutMode = en(["boxed", "full"]);
const rowId = str(12, { pattern: /^[a-z0-9]{1,12}$/, allowed: "a row id of up to 12 lowercase letters or digits" });
const align3 = responsive(en(["left", "center", "right"]));
const titleTag = en(["h2", "h3", "h4", "h5", "h6", "p", "div"]);
const boxPosition = en(["top", "left", "right"]);
const aspect = en(["1/1", "4/3", "3/2", "16/9", "3/4", "auto"]);
const gridTrack = union<number | string>([num(1, 24, { int: true }), str(300, { pattern: /^[a-z0-9\s().,%\-[\]/]+$/i, allowed: "a column count or a grid template such as 1fr 2fr or repeat(auto-fit, minmax(240px, 1fr))" })]);
const images = arr(obj({ id: req(rowId), src: req(mediaSrc), alt: str(500), caption: str(500) }, "a picture with an id and a source"), 100);
const panelItems = arr(obj({ id: req(rowId), title: req(str(300)), content: req(str(10_000)) }, "an item with an id, a title and content"), 50);
const flipSide = { icon: nullable(icon), src: mediaSrc, title: req(str(300)), description: str(3000) };
const buttonPreset = kitRef("button", "kit:button.primary");

const kitId = str(41, { pattern: /^[a-z0-9][a-z0-9_-]{0,40}$/, allowed: "an id of lowercase letters, digits, - and _" });

export const PROPS_CHECKS: Record<string, Check<Record<string, unknown>>> = {
  container: obj(
    {
      tag: containerTag,
      layout: layoutMode,
      contentWidth: responsive(size),
      minHeight,
      direction: responsive(en(["row", "column", "row-reverse", "column-reverse"])),
      justify: responsive(en(["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly", "start", "end"])),
      align: responsive(en(["flex-start", "center", "flex-end", "stretch", "baseline", "start", "end"])),
      gap: responsive(gap),
      wrap: responsive(bool()),
      overflow: en(["visible", "hidden"]),
      link,
    },
    "container settings",
  ),
  grid: obj(
    {
      tag: containerTag,
      layout: layoutMode,
      contentWidth: responsive(size),
      minHeight,
      columns: responsive(gridTrack),
      rows: responsive(gridTrack),
      gap: responsive(gap),
      autoFlow: en(["row", "column", "row dense", "column dense"]),
      justifyItems: responsive(en(["start", "center", "end", "stretch"])),
      alignItems: responsive(en(["start", "center", "end", "stretch"])),
      overflow: en(["visible", "hidden"]),
    },
    "grid settings",
  ),
  heading: obj({ text: req(str(LAYOUT_LIMITS.textChars)), tag: en(["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span"]), link }, "a heading with its text"),
  text: obj({ doc: req(richDoc) }, "a text block with a rich-text document"),
  image: obj(
    {
      src: req(mediaSrc),
      alt: str(500),
      width: responsive(size),
      height: responsive(size),
      fit: en(["cover", "contain", "fill", "none", "scale-down"]),
      focal: obj({ x: req(num(0, 100)), y: req(num(0, 100)) }, "a focal point with x and y from 0 to 100"),
      align: align3,
      link: union([obj({ kind: req(lit("none")) }, "no link"), obj({ kind: req(lit("lightbox")) }, "a lightbox"), obj({ kind: req(lit("url")), href: req(href), newTab: bool() }, "a link with an address")], "none, lightbox, or a url link"),
      caption: str(1000),
      naturalWidth: num(1, 20_000, { int: true }),
      naturalHeight: num(1, 20_000, { int: true }),
    },
    "an image with a source",
  ),
  "site-logo": obj({ src: req(mediaSrc), alt: str(500), height: responsive(size), linkHome: bool(), align: responsive(en(["left", "center", "right"])), naturalWidth: num(1, 20000, { int: true }), naturalHeight: num(1, 20000, { int: true }) }, "a site logo with a picture"),
  "nav-menu": obj({ menu: kitId, layout: en(["horizontal", "vertical"]), align: responsive(en(["left", "center", "right"])), breakpoint: num(320, 2000, { int: true }), sticky: bool(), gap: size }, "a navigation menu"),
  button: obj({ text: req(str(300)), link, preset: buttonPreset, size: en(["sm", "md", "lg", "xl"]), icon: nullable(icon), iconPosition: en(["before", "after"]), align: responsive(en(["left", "center", "right", "justify"])) }, "a button with its text"),
  spacer: obj({ height: responsive(size) }, "spacer settings"),
  divider: obj({ style: borderStyle, width: responsive(size), weight: size, color, align: en(["left", "center", "right"]), text: str(300), icon: nullable(icon) }, "divider settings"),
  "site-section": obj({ key: req(str(60, { pattern: /^[a-z0-9][a-z0-9_-]*$/, allowed: "a section key of lowercase letters, digits, - and _" })) }, "a site section with a key"),
  icon: obj({ icon: req(nullable(icon)), link, size: responsive(size), view: en(["default", "stacked", "framed"]), shape: en(["circle", "square"]), color, secondary: color, align: align3, rotate: num(-360, 360) }, "an icon"),
  video: refine(
    obj(
      {
        source: req(en(["youtube", "vimeo", "wistia", "file", "embed"])),
        url: req(str(2000)),
        poster: mediaSrc,
        autoplay: bool(),
        loop: bool(),
        controls: bool(),
        muted: bool(),
        aspect: en(["16/9", "4/3", "1/1", "9/16", "21/9"]),
        start: num(0, 86_400, { int: true }),
        title: str(200),
      },
      "a video with a source and an address",
    ),
    (props) => isAllowedVideoUrl(String(props["source"]), String(props["url"])),
    "a YouTube, Vimeo or Wistia address, a generic https embed address, or a video file on this site or on https://",
  ),
  "icon-box": obj({ icon: req(nullable(icon)), title: req(str(300)), titleTag, description: str(5000), link, position: boxPosition, align: align3, iconColor: color, iconSize: size }, "an icon box with a title"),
  "image-box": obj({ src: req(mediaSrc), alt: str(500), title: req(str(300)), titleTag, description: str(5000), link, position: boxPosition, align: align3, imageWidth: size }, "an image box with a picture and a title"),
  "icon-list": obj({ items: req(arr(obj({ id: req(rowId), text: req(str(500)), icon: nullable(icon), link }, "an item with an id and text"), 100)), icon: nullable(icon), layout: en(["stacked", "inline"]), divider: bool(), iconColor: color, gap: size }, "an icon list with items"),
  accordion: obj({ items: req(panelItems), open: en(["first", "none", "all"]), titleTag, iconPosition: en(["left", "right"]) }, "an accordion with items"),
  toggle: obj({ items: req(panelItems), open: en(["first", "none", "all"]), titleTag, iconPosition: en(["left", "right"]) }, "a toggle with items"),
  tabs: obj({ items: req(panelItems), layout: en(["horizontal", "vertical"]), align: en(["start", "center", "end", "stretch"]) }, "tabs with items"),
  testimonial: obj({ quote: req(str(5000)), name: req(str(200)), role: str(200), src: mediaSrc, alt: str(500), rating: num(0, 5), align: align3, layout: en(["image-top", "image-left", "image-bottom"]) }, "a testimonial with a quote and a name"),
  "star-rating": refine(obj({ rating: req(num(0, 10)), scale: union<number>([lit(5), lit(10)]), title: str(200), color, emptyColor: color, size, align: align3 }, "a star rating"), (props) => Number(props["rating"]) <= Number(props["scale"] ?? 5), "a rating no higher than its scale"),
  counter: obj({ start: num(-1e12, 1e12), end: req(num(-1e12, 1e12)), duration: num(0, 20_000, { int: true }), prefix: str(20), suffix: str(20), separator: bool(), decimals: num(0, 4, { int: true }), title: str(200), align: align3 }, "a counter with an end number"),
  progress: obj({ title: str(200), percent: req(num(0, 100)), showPercent: bool(), innerText: str(100), color, trackColor: color, height: size }, "a progress bar with a percentage"),
  alert: obj({ kind: req(en(["info", "success", "warning", "danger"])), title: req(str(300)), description: str(3000), dismissible: bool(), icon: bool() }, "an alert with a kind and a title"),
  "social-icons": obj(
    {
      items: req(arr(obj({ id: req(rowId), network: req(en(SOCIAL_NETWORKS)), href: req(union([href, str(255, { pattern: /^[^\s@:/]{1,64}@[^\s@:/]{1,190}$|^[+()\-.\s\d]{5,40}$/, allowed: "an email address or a phone number" })])), label: str(80) }, "a network with an address"), 30)),
      shape: en(["rounded", "square", "circle"]),
      size,
      colors: en(["brand", "custom"]),
      color,
      iconColor: color,
      gap: size,
      align: align3,
    },
    "social icons with items",
  ),
  gallery: obj({ images: req(images), columns: responsive(num(1, 8, { int: true })), gap: size, aspect, lightbox: bool(), captions: bool() }, "a gallery with pictures"),
  carousel: obj({ images: req(images), perView: responsive(num(1, 6, { int: true })), gap: size, aspect, autoplay: bool(), interval: num(1500, 30_000, { int: true }), loop: bool(), arrows: bool(), dots: bool(), pauseOnHover: bool(), captions: bool(), lightbox: bool() }, "a carousel with pictures"),
  map: obj({ address: req(str(300)), zoom: num(1, 20, { int: true }), height: responsive(size), title: str(200) }, "a map with an address"),
  cta: obj({ layout: en(["classic", "cover"]), src: mediaSrc, alt: str(500), title: req(str(300)), description: str(3000), buttonText: str(120), link, ribbon: str(40), align: align3, minHeight: size }, "a call to action with a title"),
  "price-table": obj({ heading: req(str(200)), subheading: str(300), currency: str(8), price: req(str(40)), period: str(40), features: req(arr(obj({ id: req(rowId), text: req(str(300)), included: req(bool()) }, "a feature with text and included on/off"), 40)), buttonText: str(120), link, ribbon: str(40), footer: str(500), featured: bool() }, "a price table with a heading, a price and features"),
  countdown: obj({ mode: en(["date", "evergreen"]), date: refine(str(40), (value) => !Number.isNaN(Date.parse(value)), "a date and time"), minutes: num(1, 525_600, { int: true }), units: obj({ days: bool(), hours: bool(), minutes: bool(), seconds: bool() }, "units to show"), labels: bool(), expired: str(300) }, "a countdown"),
  "flip-box": obj({ front: req(obj(flipSide, "a front side with a title")), back: req(obj({ ...flipSide, buttonText: str(120), link }, "a back side with a title")), effect: en(["flip", "slide", "fade"]), direction: en(["left", "right", "up", "down"]), height: responsive(size), frontColor: color, backColor: color }, "a flip box with a front and a back"),
  blockquote: obj({ quote: req(str(5000)), author: str(200), source: str(200), link, look: en(["border", "quotation", "boxed"]), align: align3 }, "a quote with its text"),
  toc: obj({ title: str(200), headings: arr(en(["h2", "h3", "h4", "h5", "h6"]), 5, 1), marker: en(["numbers", "bullets", "none"]), collapsible: bool(), startOpen: bool() }, "a table of contents"),
  html: obj({ code: req(str(100_000)), height: responsive(size), title: str(200) }, "an HTML embed with code"),
  form: refine(
    obj(
      {
        fields: req(
          arr(
            obj(
              {
                id: req(rowId),
                type: req(en(["text", "email", "tel", "textarea", "number", "date", "select", "radio", "checkbox", "consent"])),
                label: req(str(300)),
                name: req(str(40, { pattern: /^[a-z][a-z0-9_]{0,39}$/, allowed: "a field name of lowercase letters, digits and _" })),
                placeholder: str(200),
                required: bool(),
                options: arr(str(200), 50),
                width: union<number>([lit(100), lit(50), lit(33)]),
                help: str(300),
              },
              "a field with an id, type, label and name",
            ),
            30,
            1,
          ),
        ),
        submitText: str(120),
        success: str(1000),
        redirect: href,
        buttonPreset,
        name: str(120),
        labels: bool(),
      },
      "a form with at least one field",
    ),
    (props) => {
      const fields = props["fields"] as { name: string }[];
      return new Set(fields.map((field) => field.name)).size === fields.length;
    },
    "every field with its own name",
  ),
};

/** Register the props rules for a widget added later (the dashboard's widget library calls this at module load). */
export function registerPropsCheck(type: string, check: Check<Record<string, unknown>>): void {
  PROPS_CHECKS[type] = check;
}

export const isKnownElementType = (type: string): boolean => type in PROPS_CHECKS;

// --- elements ---------------------------------------------------------------------------------------------

const meta = obj({ createdBy: req(str(200)), updatedAt: req(str(40)) }, "who created the element and when it changed");

/** JSON with sorted keys, so the same element hashes the same whatever order its keys were written in. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** A deterministic eight-character id for a placeholder, from the raw element and its place. */
export function placeholderId(seed: string, taken: Set<string>): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let attempt = 0;
  for (;;) {
    let hash = 2166136261 ^ attempt;
    for (const char of seed) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    let out = "";
    let value = hash;
    for (let i = 0; i < 8; i++) {
      out += alphabet[value % alphabet.length];
      value = Math.floor(value / alphabet.length) + (i * 7919 + (hash % 97));
    }
    if (!taken.has(out)) return out;
    attempt += 1;
  }
}

type ElementCtx = Ctx & { ids: Set<string>; count: number };

const humanType = (type: string): string => type.replace(/-/g, " ");

/** The placeholder that stands in for an element the validator could not read. */
function placeholder(raw: unknown, id: string, originalType: string, reason: string): Element {
  const label = isRecord(raw) && typeof raw["label"] === "string" ? raw["label"].slice(0, 80) : undefined;
  const element: Element = { id, type: UNSUPPORTED_TYPE, props: { originalType, reason }, style: {}, advanced: {}, meta: { createdBy: "validator", updatedAt: "" } };
  if (label) element.label = label;
  return element;
}

function checkOneElement(raw: unknown, ctx: ElementCtx, path: ProblemPath, depth: number): Element {
  const mark = ctx.problems.length;
  const rawId = isRecord(raw) ? raw["id"] : undefined;
  const rawType = isRecord(raw) ? raw["type"] : undefined;
  const typeText = typeof rawType === "string" ? rawType.slice(0, 40) : "unknown";
  const idOk = typeof rawId === "string" && ELEMENT_ID_PATTERN.test(rawId) && !ctx.ids.has(rawId);
  const id = idOk ? rawId : placeholderId(`${path.join(".")}:${stableStringify(raw).slice(0, 4000)}`, ctx.ids);
  ctx.ids.add(id);
  ctx.count += 1;

  const unsupported = (reason: string, allowed: string): Element => {
    ctx.problems.length = mark; // whatever was dropped inside no longer matters: the whole element is kept as is
    ctx.detail = null;
    ctx.element = undefined;
    const element = placeholder(raw, id, typeText, reason);
    ctx.problems.push({ path, effect: "element", setting: "Element", found: reason, allowed, value: raw, elementId: id, elementLabel: element.label, elementType: typeText });
    return element;
  };

  if (!isRecord(raw)) return unsupported("it is not an element", "an element with an id, a type and its settings");
  if (typeof rawId !== "string" || !ELEMENT_ID_PATTERN.test(rawId)) return unsupported(`its element id ${shortText(rawId)} is not eight lowercase letters or digits`, "an element id of eight lowercase letters or digits");
  if (!idOk) return unsupported(`its element id "${rawId}" appears twice on this page`, "an element id no other element on the page uses");
  if (typeof rawType !== "string" || !ELEMENT_TYPE_PATTERN.test(rawType) || rawType.length > 40) return unsupported(`its type ${shortText(rawType)} is not a widget name`, "a widget type such as heading, text, image or container");
  if (raw["props"] !== undefined && !isRecord(raw["props"])) return unsupported("its content settings are not an object", "content settings as an object");
  if (depth > LAYOUT_LIMITS.depth) return unsupported(`it is nested more than ${LAYOUT_LIMITS.depth} levels deep`, `elements nested at most ${LAYOUT_LIMITS.depth} deep`);

  const label = typeof raw["label"] === "string" && raw["label"].length <= 80 ? raw["label"] : undefined;
  ctx.element = { id, label, type: rawType, base: path };
  const out: Element = { ...(raw as unknown as Element), id, type: rawType, props: (raw["props"] as Record<string, unknown> | undefined) ?? {}, style: {}, advanced: {}, meta: { createdBy: "unknown", updatedAt: "" } };
  if (raw["label"] !== undefined && label === undefined) {
    report(ctx, [...path, "label"], "a name up to 80 characters", raw["label"], "ignored");
    delete (out as Partial<Element>).label;
  }
  if (raw["locked"] !== undefined && typeof raw["locked"] !== "boolean") {
    report(ctx, [...path, "locked"], "on or off", raw["locked"], "ignored");
    delete (out as Partial<Element>).locked;
  }

  const check = PROPS_CHECKS[rawType];
  if (check) {
    const props = check.run(out.props, ctx, [...path, "props"]);
    if (props === INVALID) {
      const detail = ctx.detail && startsWith(ctx.detail.path, [...path, "props"]) ? ctx.detail : null;
      const where = detail ? settingLabel(detail.path.slice(path.length)) : "Content";
      return unsupported(detail ? `${where} is ${shortText(detail.value)}` : `its content settings are not ${check.allowed}`, detail?.allowed ?? check.allowed);
    }
    out.props = props;
  }

  for (const key of ["style", "advanced"] as const) {
    const rawPart = raw[key];
    if (rawPart === undefined) continue;
    const result = (key === "style" ? style : advanced).run(rawPart, ctx, [...path, key]);
    if (result === INVALID) report(ctx, [...path, key], key === "style" ? "style settings as an object" : "advanced settings as an object", rawPart, "ignored");
    else out[key] = result as Element[typeof key];
  }
  const metaResult = raw["meta"] === undefined ? INVALID : meta.run(raw["meta"], ctx, [...path, "meta"]);
  ctx.detail = null;
  if (metaResult !== INVALID) out.meta = metaResult as Element["meta"];

  const rawChildren = raw["children"];
  if (rawChildren !== undefined) {
    if (!Array.isArray(rawChildren)) {
      report(ctx, [...path, "children"], "a list of elements", rawChildren, "ignored");
      delete (out as Partial<Element>).children;
    } else if (rawChildren.length > 0 && !CONTAINER_TYPES.includes(rawType)) {
      // The element itself is fine; only its inner elements cannot be shown. They stay in the file.
      report(ctx, [...path, "children"], "inner elements only inside a container or grid", rawChildren, "ignored", { setting: "Inner elements", found: `${rawChildren.length} ${rawChildren.length === 1 ? "element" : "elements"} inside a ${humanType(rawType)}` });
      delete (out as Partial<Element>).children;
    } else {
      ctx.element = undefined;
      out.children = rawChildren.map((child, index) => checkOneElement(child, ctx, [...path, "children", index], depth + 1));
    }
  }
  ctx.element = undefined;
  return out;
}

/** One element on its own (the clipboard, tests). Placeholders count as problems. */
export function checkElement(raw: unknown): CheckReport<Element> {
  const ctx: ElementCtx = { problems: [], detail: null, ids: new Set(), count: 0 };
  const value = checkOneElement(raw, ctx, [], 1);
  return { value, problems: ctx.problems };
}

// --- layouts ----------------------------------------------------------------------------------------------

const PATH_ALLOWED = "a page address that starts with / and has no spaces or quotes, such as /about-us/";
const pagePath = str(200, { pattern: /^\/[^\s"'<>\\]*$/, allowed: PATH_ALLOWED });
const absoluteUrl: Check<string> = {
  allowed: "an https:// or http:// address up to 2000 characters",
  empty: () => "",
  run: (value, ctx, path) => (typeof value === "string" && value.length <= 2000 && /^https?:\/\/[^\s]+$/i.test(value) ? value : fail(ctx, path, "an https:// or http:// address up to 2000 characters", value)),
};
const breadcrumbItem = obj({ name: req(str(200)), url: req(union([absoluteUrl, href], "an address on this site (/...) or a full https URL")) }, "a breadcrumb item with a name and address");
const articleData = obj(
  {
    headline: str(300),
    description: str(1000),
    image: mediaSrc,
    author: str(200),
    datePublished: str(60),
    dateModified: str(60),
  },
  "article structured data",
);
const localBusinessData = obj(
  {
    name: str(200),
    type: str(80, { pattern: /^[A-Za-z][A-Za-z0-9]*$/, allowed: "a schema.org type such as LocalBusiness, Restaurant, HomeAndConstructionBusiness" }),
    telephone: str(60),
    email: str(200),
    streetAddress: str(300),
    addressLocality: str(200),
    addressRegion: str(200),
    postalCode: str(40),
    addressCountry: str(80),
    logo: mediaSrc,
    latitude: num(-90, 90),
    longitude: num(-180, 180),
    openingHours: str(500),
    sameAs: arr(absoluteUrl, 20),
    priceRange: str(20),
  },
  "the business details for structured data",
);
const structuredData = union(
  [
    obj({ kind: req(lit("none")) }, "no structured data"),
    obj({ kind: req(lit("LocalBusiness")), override: localBusinessData }, "LocalBusiness structured data"),
    obj({ kind: req(lit("Organization")), override: localBusinessData }, "Organization structured data"),
    obj({ kind: req(lit("Article")), article: req(articleData) }, "Article structured data with the article fields"),
    obj({ kind: req(lit("FAQ")), fromAccordionId: str(20, { pattern: /^[a-z0-9]{8}$/, allowed: "an element id (eight characters)" }) }, "FAQ structured data from an accordion on the page"),
    obj({ kind: req(lit("BreadcrumbList")), items: req(arr(breadcrumbItem, 20, 1)) }, "BreadcrumbList structured data with at least one item"),
  ],
  'structured data: { kind: "none" | "LocalBusiness" | "Organization" | "Article" | "FAQ" | "BreadcrumbList", … }',
);
const pageSeo = obj(
  {
    title: str(200),
    description: str(500),
    ogImage: mediaSrc,
    ogTitle: str(200),
    ogDescription: str(500),
    twitterTitle: str(200),
    twitterDescription: str(500),
    twitterImage: mediaSrc,
    canonical: absoluteUrl,
    noindex: bool(),
    nofollow: bool(),
    structuredData: structuredData,
  },
  "page SEO settings",
);
const pageSettings = obj({ hideTitle: bool(), bodyBackground: nullable(color), fullCanvas: bool() }, "page settings");

const siteSeoCheck = obj(
  {
    siteName: str(200),
    siteUrl: absoluteUrl,
    defaultShareImage: mediaSrc,
    titlePattern: str(200),
    googleVerification: str(200, { pattern: /^[A-Za-z0-9_-]{20,200}$/, allowed: "a Google Search Console verification code (letters, digits, - and _)" }),
    defaultDescription: str(500),
    business: localBusinessData,
    robotsExtras: str(2000),
  },
  "site-wide SEO settings",
);

/**
 * Check a parsed layout file. `value` is null only when the file is not a layout at all;
 * otherwise it is the cleaned layout, with every problem listed.
 */
export function checkLayout(raw: unknown): CheckReport<LayoutDoc> {
  const ctx: ElementCtx = { problems: [], detail: null, ids: new Set(), count: 0 };
  const fatal = (path: ProblemPath, allowed: string, value: unknown): CheckReport<LayoutDoc> => {
    ctx.problems.push({ path, effect: "file", setting: settingLabel(path), found: shortText(value), allowed, value });
    return { value: null, problems: ctx.problems };
  };
  if (!isRecord(raw)) return fatal([], "a layout file: an object with version 1, a pageSlug, a path and a root list of elements", raw);
  if (raw["version"] !== 1) return fatal(["version"], "version 1 (the only layout format there is)", raw["version"]);
  if (typeof raw["pageSlug"] !== "string" || !isLayoutSlug(raw["pageSlug"]) || raw["pageSlug"].length > 100) return fatal(["pageSlug"], "a page slug of lowercase letters, digits and hyphens (or _header / _footer)", raw["pageSlug"]);
  if (!Array.isArray(raw["root"])) return fatal(["root"], "a root list of elements", raw["root"]);
  const path = pagePath.run(raw["path"], ctx, ["path"]);
  if (path === INVALID) return fatal(["path"], PATH_ALLOWED, raw["path"]);
  if (raw["root"].length > LAYOUT_LIMITS.elementsPerPage) return fatal(["root"], `at most ${LAYOUT_LIMITS.elementsPerPage} elements on one page`, `${raw["root"].length} elements`);

  const layout: LayoutDoc = { ...(raw as unknown as LayoutDoc), version: 1, pageSlug: raw["pageSlug"], path, root: [] };
  if (raw["label"] !== undefined) {
    if (typeof raw["label"] === "string" && raw["label"].length <= 120) layout.label = raw["label"];
    else {
      report(ctx, ["label"], "a page name up to 120 characters", raw["label"], "ignored");
      delete layout.label;
    }
  }
  for (const [key, check] of [["seo", pageSeo], ["pageSettings", pageSettings]] as const) {
    if (raw[key] === undefined) continue;
    const result = check.run(raw[key], ctx, [key]);
    if (result === INVALID) {
      report(ctx, [key], check.allowed, raw[key], "ignored");
      delete layout[key];
    } else layout[key] = result as never;
  }
  layout.root = raw["root"].map((element, index) => checkOneElement(element, ctx, ["root", index], 1));
  if (ctx.count > LAYOUT_LIMITS.elementsPerPage) return fatal(["root"], `at most ${LAYOUT_LIMITS.elementsPerPage} elements on one page`, `${ctx.count} elements`);
  return { value: layout, problems: ctx.problems };
}

// --- posts (the blog) ---------------------------------------------------------------------------------------

const POST_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/;
const taxonomySlug = str(80, { pattern: POST_SLUG_PATTERN, allowed: "a slug of lowercase letters, digits and hyphens" });
const isoDate = str(60, { pattern: /^(|\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)$/, allowed: "an ISO date like 2026-05-01 or 2026-05-01T14:00:00Z (empty means draft)" });
const postSettings = obj(
  {
    title: req(str(300)),
    excerpt: str(500),
    coverImage: mediaSrc,
    author: str(40, { pattern: /^[A-Za-z0-9-]{1,40}$/, allowed: "an id up to 40 characters" }),
    authorName: str(200),
    publishedAt: isoDate,
    categories: arr(taxonomySlug, 30),
    tags: arr(taxonomySlug, 60),
    seo: pageSeo,
  },
  "the post settings (title, excerpt, cover image, author, publishedAt, categories, tags)",
);

/**
 * Check a parsed post file (content/posts/<slug>.json). Returns null only when the file
 * is not a post at all; otherwise the cleaned post, with every problem listed.
 */
export function checkPost(raw: unknown): CheckReport<PostDoc> {
  const ctx: ElementCtx = { problems: [], detail: null, ids: new Set(), count: 0 };
  const fatal = (path: ProblemPath, allowed: string, value: unknown): CheckReport<PostDoc> => {
    ctx.problems.push({ path, effect: "file", setting: settingLabel(path), found: shortText(value), allowed, value });
    return { value: null, problems: ctx.problems };
  };
  if (!isRecord(raw)) return fatal([], "a post file: an object with version 1, kind: \"post\", a slug, a path, settings and a root list of elements", raw);
  if (raw["version"] !== 1) return fatal(["version"], "version 1", raw["version"]);
  if (raw["kind"] !== "post") return fatal(["kind"], 'exactly "post"', raw["kind"]);
  if (typeof raw["slug"] !== "string" || !POST_SLUG_PATTERN.test(raw["slug"])) return fatal(["slug"], "a slug of lowercase letters, digits and hyphens", raw["slug"]);
  if (!Array.isArray(raw["root"])) return fatal(["root"], "a root list of elements", raw["root"]);
  const path = pagePath.run(raw["path"], ctx, ["path"]);
  if (path === INVALID) return fatal(["path"], PATH_ALLOWED, raw["path"]);
  const settings = postSettings.run(raw["settings"], ctx, ["settings"]);
  if (settings === INVALID) return fatal(["settings"], "the post settings, with at least a title", raw["settings"]);
  const post: PostDoc = { version: 1, kind: "post", slug: raw["slug"], path, settings: settings as unknown as PostDoc["settings"], root: [] };
  post.root = raw["root"].map((element, index) => checkOneElement(element, ctx, ["root", index], 1));
  return { value: post, problems: ctx.problems };
}

const postIndexEntry = obj(
  {
    slug: req(taxonomySlug),
    path: req(pagePath),
    title: req(str(300)),
    excerpt: req(str(500)),
    coverImage: nullable(mediaSrc),
    authorName: req(str(200)),
    publishedAt: req(isoDate),
    categories: req(arr(taxonomySlug, 30)),
    tags: req(arr(taxonomySlug, 60)),
  },
  "an entry with a slug, path, title and publishedAt",
);
const postIndexCheck = obj({ version: req(lit(1)), posts: req(arr(postIndexEntry, 10_000)) }, "an index of every post");

export function checkPostIndex(raw: unknown): CheckReport<PostIndex> {
  const ctx: Ctx = { problems: [], detail: null };
  if (!isRecord(raw)) return { value: { version: 1, posts: [] }, problems: [] };
  const result = postIndexCheck.run(raw, ctx, []);
  return { value: result === INVALID ? { version: 1, posts: [] } : (result as unknown as PostIndex), problems: ctx.problems };
}

const taxonomyTerm = obj({ slug: req(taxonomySlug), name: req(str(120)), description: str(500) }, "a taxonomy term with a slug and name");
const taxonomiesCheck = obj({ categories: req(arr(taxonomyTerm, 500)), tags: req(arr(taxonomyTerm, 2000)) }, "categories and tags");

export function checkTaxonomies(raw: unknown): CheckReport<Taxonomies> {
  const ctx: Ctx = { problems: [], detail: null };
  if (!isRecord(raw)) return { value: { categories: [], tags: [] }, problems: [] };
  const result = taxonomiesCheck.run(raw, ctx, []);
  return { value: result === INVALID ? { categories: [], tags: [] } : (result as unknown as Taxonomies), problems: ctx.problems };
}

// --- the site kit ---------------------------------------------------------------------------------------------

const typographyPreset = obj({ fontFamily: fontRef, fontSize: req(responsive(size)), fontWeight, lineHeight: size, letterSpacing: size, textTransform }, "a text style with a size");
const buttonPresetShape = obj({ background: req(color), color: req(color), borderWidth: size, borderColor: color, radius: size, padding: sides(size), hover: obj({ background: color, color, borderColor: color }, "hover colours") }, "a button style with a background and a text colour");

const menuItem: Check<Record<string, unknown>> = lazy(
  () =>
    obj(
      {
        id: req(kitId),
        label: req(str(120)),
        kind: req(en(["page", "url"])),
        page: str(100, { pattern: PAGE_SLUG_PATTERN, allowed: "a page slug" }),
        href: href,
        newTab: bool(),
        children: arr(menuItem, 50),
      },
      "a menu item with an id, a label and a kind (page or url)",
    ),
  "a menu item",
);
const menuCheck = obj({ id: req(kitId), name: req(str(80)), items: req(arr(menuItem, 100)) }, "a menu with an id, a name and its items");

const siteKitCheck = obj(
  {
    version: req(lit(1)),
    colors: req(obj({ primary: req(color), secondary: req(color), text: req(color), accent: req(color), custom: req(arr(obj({ id: req(kitId), label: req(str(60)), value: req(color) }, "a colour with an id, a label and a value"), 40)) }, "the site colours")),
    fonts: req(obj({ heading: req(fontRef), body: req(fontRef), custom: req(arr(obj({ id: req(kitId), family: req(fontRef), source: req(en(["google", "system"])) }, "a font with an id, a family and a source"), 20)) }, "the site fonts")),
    typography: req(obj({ h1: req(typographyPreset), h2: req(typographyPreset), h3: req(typographyPreset), h4: req(typographyPreset), h5: req(typographyPreset), h6: req(typographyPreset), body: req(typographyPreset), small: req(typographyPreset), button: req(typographyPreset) }, "the text styles")),
    buttons: req(obj({ primary: req(buttonPresetShape), secondary: req(buttonPresetShape), outline: req(buttonPresetShape) }, "the button styles")),
    links: req(obj({ color: req(color), hover: req(color) }, "link colours")),
    forms: req(obj({ fieldBackground: req(color), fieldBorder: req(color), fieldRadius: req(size), fieldText: req(color) }, "form field styles")),
    container: req(obj({ contentWidth: req(size), padding: req(sides(size)), gap: req(size) }, "container defaults")),
    breakpoints: req(refine(obj({ tablet: req(num(480, 2000, { int: true })), mobile: req(num(320, 1200, { int: true })) }, "tablet and mobile breakpoints in pixels"), (points) => Number(points["mobile"]) < Number(points["tablet"]), "a mobile breakpoint below the tablet one")),
    imageRadius: req(size),
    pageBackground: req(color),
    menus: arr(menuCheck, 20),
    seo: siteSeoCheck,
  },
  "a site kit",
);

/** Check a parsed site kit. Always yields a usable kit: anything unreadable is filled from the default kit and reported. */
export function checkSiteKit(raw: unknown): CheckReport<SiteKit> {
  const defaults = defaultSiteKit();
  const ctx: Ctx = { problems: [], detail: null, defaults };
  if (!isRecord(raw)) {
    ctx.problems.push({ path: [], effect: "file", setting: "Site kit", found: shortText(raw), allowed: "a site kit object (content/site-kit.json)", value: raw, filled: defaults });
    return { value: defaults, problems: ctx.problems };
  }
  const result = siteKitCheck.run(raw, ctx, []);
  return { value: result === INVALID ? defaults : (result as unknown as SiteKit), problems: ctx.problems };
}

// --- words ------------------------------------------------------------------------------------------------------

const SETTING_WORDS: Record<string, string> = {
  style: "Style",
  advanced: "Advanced",
  props: "Content",
  hover: "Hover",
  typography: "Typography",
  fontFamily: "Font",
  fontSize: "Font size",
  fontWeight: "Font weight",
  lineHeight: "Line height",
  letterSpacing: "Letter spacing",
  wordSpacing: "Word spacing",
  textTransform: "Transform",
  textAlign: "Alignment",
  textDecoration: "Decoration",
  fontStyle: "Font style",
  textShadow: "Text shadow",
  boxShadow: "Box shadow",
  textStroke: "Text stroke",
  backgroundOverlay: "Background overlay",
  mixBlendMode: "Blend mode",
  customWidth: "Custom width",
  maxWidth: "Max width",
  alignSelf: "Align self",
  flexGrow: "Grow",
  flexShrink: "Shrink",
  gridColumnSpan: "Column span",
  gridRowSpan: "Row span",
  zIndex: "Z-index",
  hoverAnimation: "Hover animation",
  cssId: "CSS id",
  cssClasses: "CSS classes",
  customCss: "Custom CSS",
  contentWidth: "Content width",
  minHeight: "Min height",
  src: "Source",
  alt: "Alt text",
  href: "Address",
  newTab: "Open in a new tab",
  doc: "Text",
  desktop: "on desktop",
  tablet: "on tablet",
  mobile: "on phone",
  seo: "SEO",
  pageSettings: "Page settings",
  pageSlug: "Page slug",
  bodyBackground: "Body background",
  fullCanvas: "Full canvas",
  hideTitle: "Hide title",
  ogImage: "Share image",
  ogTitle: "Share title (Open Graph)",
  ogDescription: "Share description (Open Graph)",
  twitterTitle: "Share title (X/Twitter)",
  twitterDescription: "Share description (X/Twitter)",
  twitterImage: "Share picture (X/Twitter)",
  canonical: "Canonical URL",
  noindex: "Hide from search engines",
  nofollow: "Don't follow links",
  structuredData: "Structured data",
  siteName: "Site name",
  siteUrl: "Site URL",
  defaultShareImage: "Default share picture",
  titlePattern: "Title pattern",
  googleVerification: "Google verification code",
  defaultDescription: "Default description",
  business: "Business details",
  robotsExtras: "Extra robots.txt lines",
  streetAddress: "Street address",
  addressLocality: "City",
  addressRegion: "Region or state",
  postalCode: "Postal code",
  addressCountry: "Country",
  openingHours: "Opening hours",
  sameAs: "Also known as",
  priceRange: "Price range",
  headline: "Article headline",
  datePublished: "Date published",
  dateModified: "Date modified",
  fromAccordionId: "From accordion",
  pageBackground: "Page background",
  imageRadius: "Picture corners",
  fieldBackground: "Field background",
  fieldBorder: "Field border",
  fieldRadius: "Field corners",
  fieldText: "Field text",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  h5: "Heading 5",
  h6: "Heading 6",
};

const wordsFor = (key: string): string => SETTING_WORDS[key] ?? key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/^./, (char) => char.toUpperCase());

/** "Style › Typography › Font weight", or "Content › Items › row 2 › Title". */
export function settingLabel(path: ProblemPath): string {
  const parts: string[] = [];
  path.forEach((part, index) => {
    if (typeof part === "number") {
      const previous = path[index - 1];
      if (previous === "root" || previous === "children") return;
      parts.push(`row ${part + 1}`);
      return;
    }
    if (part === "root" || part === "children") return;
    parts.push(wordsFor(part));
  });
  return parts.length === 0 ? "the file" : parts.join(" › ");
}

/** A problem as one plain-English sentence or two. `page` names the page (or the file) it belongs to. */
export function describeProblem(problem: Problem, page?: string): string {
  const where = page ? `${page}: ` : "";
  if (problem.effect === "file") return `${where}the file could not be loaded: ${problem.setting === "the file" ? "" : `${problem.setting} is ${problem.found}; `}it needs ${problem.allowed}.`;
  const element = problem.elementType ? `the ${problem.elementLabel ? `"${problem.elementLabel}" ` : ""}${humanType(problem.elementType)}` : null;
  if (problem.effect === "element") return `${where}${element ?? "an element"} could not be read: ${problem.found}. Allowed: ${problem.allowed}. It shows as "Unsupported element" in the editor, is skipped on the site, and is kept exactly as it is in the file.`;
  const filled = problem.filled !== undefined ? ` The default (${shortText(problem.filled)}) applies meanwhile.` : "";
  return `${where}${element ? `${element}'s ` : ""}${problem.setting} is ${problem.found}, which is not ${problem.allowed}. It is ignored until it is changed, and kept as it is in the file.${filled}`;
}
