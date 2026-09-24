/**
 * Every widget × every control: does the value reach the page? For each widget type the
 * builder offers and each leaf control on its Content, Style (normal and hover) and
 * Advanced tabs, the test sets a value the way the inspector would and renders the element
 * through the kit (its generated CSS and its HTML). A control passes when:
 *
 *   - at desktop the page changes (a declaration in the stylesheet or an attribute or text
 *     in the markup) and the element still validates;
 *   - a phone-only override changes only the phone media block, never the base rules, the
 *     tablet block or the markup;
 *   - a hover value (the Hover state of the Style tab) changes only `:hover` rules.
 *
 * Controls whose effect is behaviour a static render cannot show (a video's start time, a
 * carousel's autoplay) are listed in BEHAVIOUR_ONLY with the reason, so the test stays
 * strict everywhere else. The matrix in docs/AUDIT.md comes from
 * `COVERAGE_MATRIX=1 npx vitest run src/builder/controls/coverage.test.ts --silent=false --reporter=verbose`.
 */
// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultSiteKit, setAt, validateElement, type Device, type Element, type LayoutDoc, type Size } from "@shared/builder/index.ts";
import { ArmaturePage, createArmatureKit, elementsCss } from "@kit/index.ts";
import { setPath } from "../store.ts";
import { widgetDefinition, widgetDefinitions } from "../widgets/registry.ts";
import "../widgets/library.ts";
import { readAt } from "./path.ts";
import { advancedSpecs, borderSpecs, contentSpecsFor, styleSpecs, typographySpecs } from "./specs.ts";
import type { ControlSpec, Path } from "./types.ts";

vi.useFakeTimers({ toFake: ["Date"], now: new Date("2030-06-01T12:00:00Z") });

/** The default kit plus one menu, so the Nav Menu has something to render. */
const kit = { ...defaultSiteKit(), menus: [{ id: "main", name: "Main", items: [{ id: "home", label: "Home", kind: "url" as const, href: "/" }, { id: "about", label: "About", kind: "url" as const, href: "/about/" }] }] };
createArmatureKit({ schema: { armatureContract: 2, pages: [] }, content: {}, layouts: [], siteKit: kit, allowedOrigins: [] });

// --- what the inspector shows -------------------------------------------------------------------------

type Tab = "Content" | "Style" | "Style (hover)" | "Advanced";
type Leaf = { spec: ControlSpec & { path: Path; label?: string }; tab: Tab; group: string; /** The `if` blocks this control sits in, outermost first. */ conditions: Extract<ControlSpec, { kind: "if" }>[] };

const withPath = (spec: ControlSpec): spec is ControlSpec & { path: Path } => "path" in spec;

/** Every leaf control with a path, its group label and the conditions around it; composite popovers opened up into their fields. */
function leaves(specs: ControlSpec[], tab: Tab, group = "", conditions: Extract<ControlSpec, { kind: "if" }>[] = []): Leaf[] {
  const out: Leaf[] = [];
  for (const spec of specs) {
    if (spec.kind === "group") out.push(...leaves(spec.controls, tab, spec.label, conditions));
    else if (spec.kind === "if") out.push(...leaves(spec.controls, tab, group, [...conditions, spec]));
    else if (spec.kind === "typography") {
      out.push({ spec: { kind: "select", label: "Site text style", path: [...spec.path, "preset"], options: [{ value: "kit:type.h3", label: "Heading 3" }] }, tab, group, conditions });
      out.push({ spec: { kind: "font", label: "Family", path: [...spec.path, "fontFamily"] }, tab, group, conditions });
      out.push(...leaves(typographySpecs(spec.path), tab, group, conditions));
    } else if (spec.kind === "border") out.push(...leaves(borderSpecs(spec.path), tab, group, conditions));
    else if (withPath(spec)) out.push({ spec, tab, group, conditions });
  }
  return out;
}

function tabsOf(type: string): { tab: Tab; specs: ControlSpec[] }[] {
  return [
    { tab: "Content", specs: contentSpecsFor(type) ?? [] },
    { tab: "Style", specs: styleSpecs(type, "normal") },
    { tab: "Style (hover)", specs: styleSpecs(type, "hover") },
    // Both parents' groups, so the flex and the grid controls are covered.
    { tab: "Advanced", specs: [...advancedSpecs("container"), ...advancedSpecs("grid").filter((spec) => spec.kind === "group" && spec.label === "In its grid")] },
  ];
}

// --- a value that differs from what the element has --------------------------------------------------

const RESPONSIVE_KINDS = new Set(["select", "choice", "toggle", "number", "size", "sides", "corners", "gap", "color", "shadow", "stroke", "background"]);
/** The overlay control is always per device; the others say so in their spec. */
const isResponsive = (spec: ControlSpec) => spec.kind === "overlay" || (RESPONSIVE_KINDS.has(spec.kind) && "responsive" in spec && !!spec.responsive);

const size = (units: string[] | undefined, value = 12): Size => ({ value, unit: (units?.[0] ?? "px") as Size["unit"] });
const sides = (units: string[] | undefined, value: number) => ({ top: size(units, value), right: size(units, value), bottom: size(units, value), left: size(units, value) });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A value for the control that is not the value the element already shows, so the page must
 * change. `variant` makes a second, different value (the phone override after the desktop one).
 */
function sample(spec: ControlSpec & { path: Path }, current: unknown, variant = 0): unknown {
  switch (spec.kind) {
    case "text": {
      const last = spec.path[spec.path.length - 1] ?? "";
      const value = last === "href" || last === "redirect" ? "/contact/" : last === "url" ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ" : last === "date" ? "2031-01-01T10:00" : last === "poster" || last === "src" ? "/assets/cover.webp" : last === "name" ? "full_name" : last === "cssId" ? "pricing" : last === "cssClasses" ? "is-featured" : last === "code" ? "<p>Other code</p>" : "Other words";
      return (same(value, current) ? `${value} again` : value).slice(0, spec.max ?? 500);
    }
    case "items": {
      let row: Record<string, unknown> = { id: "row00001", ...spec.create() };
      for (const field of leaves(spec.fields, "Content")) for (const [path, value] of writes(field.spec, readAt(row, field.spec.path))) row = setPath(row, path, value);
      return [row];
    }
    case "lines":
      return ["One", "Two"];
    case "select":
    case "choice": {
      const parse = (raw: string) => (spec.numeric ? Number(raw) : raw);
      return spec.options.map((item) => parse(item.value)).find((value) => !same(value, current) && value !== "");
    }
    case "toggle":
      return current === true ? false : true;
    case "number": {
      const min = spec.min ?? -Infinity;
      const max = spec.max ?? Infinity;
      const base = typeof current === "number" ? current : Math.max(min, Math.min(max, 1));
      const step = spec.step ?? 1;
      const up = base + step;
      return up <= max ? up : base - step;
    }
    case "size": {
      const next = size(spec.units, (spec.min !== undefined && spec.min > 12 ? spec.min : 12) + variant);
      return same(next, current) ? size(spec.units, next.value + 1) : next;
    }
    case "sides":
      return sides(spec.units, 12 + variant);
    case "corners":
      return { topLeft: size(spec.units, 12 + variant), topRight: size(spec.units, 12 + variant), bottomRight: size(spec.units, 12 + variant), bottomLeft: size(spec.units, 12 + variant) };
    case "gap":
      return { column: size(["px"], 7 + variant), row: size(["px"], 9 + variant) };
    case "color":
      return current === "#123456" ? "#654321" : "#123456";
    case "font":
      return "Fraunces";
    case "link":
      return { href: "https://example.com/other", newTab: true };
    case "image":
      return "/assets/other-photo.webp";
    case "icon":
      return { name: "star", nodes: [["path", { d: "M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" }]] };
    case "shadow":
      return { x: 1 + variant, y: 4, blur: 12, color: "#00000033" };
    case "stroke":
      return { width: 2 + variant, color: "kit:color.text" };
    case "background":
      return { kind: "gradient", type: "linear", angle: 90 + variant * 10, stops: [{ color: "kit:color.primary", position: 0 }, { color: "#ffffff", position: 100 }] };
    case "overlay":
      return { background: { kind: "color", color: "#000000" }, opacity: 0.4 + variant / 10, blend: "multiply" };
    case "attributes":
      return [{ name: "data-track", value: "hero" }];
    case "css":
      return "selector { color: red }";
    default:
      return undefined;
  }
}

/** Writes for one control: an image control writes its src, everything else its own path. */
function writes(spec: ControlSpec & { path: Path }, current: unknown, variant = 0): [Path, unknown][] {
  if (spec.kind === "image") return [[[...spec.path, "src"], sample(spec, current, variant)]];
  return [[spec.path, sample(spec, current, variant)]];
}

/** Make every `if` around a control true by trying the tab's other controls (each option of a select, a toggle on, a sample value). */
function satisfy(element: Element, conditions: Extract<ControlSpec, { kind: "if" }>[], candidates: Leaf[]): Element | null {
  let next = element;
  for (const condition of conditions) {
    const holds = (candidate: Element) => condition.when((path) => readAt(candidate, path));
    if (holds(next)) continue;
    let found: Element | null = null;
    for (const { spec } of candidates) {
      const attempts: unknown[] = spec.kind === "select" || spec.kind === "choice" ? spec.options.map((option) => (spec.numeric ? Number(option.value) : option.value)) : spec.kind === "toggle" ? [true] : [sample(spec, readAt(next, spec.path))];
      for (const value of attempts) {
        let attempt = next;
        for (const [path, written] of spec.kind === "image" ? writes(spec, undefined) : [[spec.path, value] as [Path, unknown]]) attempt = setPath(attempt, path, written);
        if (holds(attempt)) {
          found = attempt;
          break;
        }
      }
      if (found) break;
    }
    if (!found) return null;
    next = found;
  }
  return next;
}

/** Content the probed control needs around it before it can show: a picture before its link, a menu before its alignment. */
const CONTENT_KINDS = new Set(["text", "image", "icon", "items", "lines", "link"]);

/**
 * What a control needs set before its effect can show, when the sample of a sibling is not
 * enough: the counter's separator shows from 1,000 up; the countdown's ending text once the
 * date has passed; the Nav Menu needs a menu to render at all.
 */
const PRECONDITIONS: Record<string, Record<string, unknown>> = {
  "counter:props.separator": { "props.end": 12345 },
  "countdown:props.expired": { "props.date": "2020-01-01T00:00" },
  "nav-menu:*": { "props.menu": "main" },
  // A file address plays under every source the select offers, so switching the source stays valid.
  "video:props.source": { "props.url": "https://cdn.example.com/clip.mp4" },
};

/**
 * The element a control is probed on: the widget as created, its conditions met, and (when
 * `populate` is on) the tab's other content filled in, so a picture's link has a picture and
 * a video's title has a video. Filling in is a second try only: a list's shared icon shows
 * until every row gets its own.
 */
function prepare(type: string, leaf: Leaf, all: Leaf[], populate: boolean): Element | null {
  let element = widgetDefinition(type)!.create();
  if (populate) {
    for (const sibling of all) {
      if (sibling === leaf || !CONTENT_KINDS.has(sibling.spec.kind) || sibling.spec.path.join(".") === leaf.spec.path.join(".")) continue;
      for (const [path, value] of writes(sibling.spec, readAt(element, sibling.spec.path))) element = setPath(element, path, value);
    }
  }
  for (const [path, value] of Object.entries({ ...PRECONDITIONS[`${type}:*`], ...PRECONDITIONS[`${type}:${leaf.spec.path.join(".")}`] })) element = setPath(element, path.split("."), value);
  return satisfy(element, leaf.conditions, all);
}

// --- rendering ------------------------------------------------------------------------------------------

type Output = { css: string; html: string };

function render(element: Element): Output {
  const layout: LayoutDoc = { version: 1, pageSlug: "probe", path: "/probe", root: [element] };
  const html = renderToStaticMarkup(createElement(ArmaturePage, { slug: "probe", layout })).replace(/<style[^>]*>[\s\S]*?<\/style>/, "");
  return { css: elementsCss([element], kit), html };
}

const MOBILE = `@media (max-width: ${kit.breakpoints.mobile}px) {`;

/** The stylesheet split by media block ("base" outside any). */
function buckets(css: string): Record<string, string> {
  const out: Record<string, string[]> = { base: [] };
  let current = "base";
  for (const line of css.split("\n")) {
    if (line.startsWith("@media")) {
      current = line.trim();
      out[current] ??= [];
      continue;
    }
    if (line === "}") {
      current = "base";
      continue;
    }
    out[current]!.push(line.trim());
  }
  return Object.fromEntries(Object.entries(out).map(([key, lines]) => [key, lines.join("\n")]));
}

const changedBuckets = (before: string, after: string): string[] => {
  const a = buckets(before);
  const b = buckets(after);
  return Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).filter((key) => a[key] !== b[key]);
};

const hoverOnly = (css: string) => css.split("\n").filter((line) => line.includes(":hover")).join("\n");
const notHover = (css: string) => css.split("\n").filter((line) => !line.includes(":hover")).join("\n");

// --- the probe --------------------------------------------------------------------------------------------

type Verdict = "ok" | "no effect" | "leaks" | "invalid" | "n/a" | "cannot enable";
type Cell = { widget: string; tab: Tab; group: string; label: string; path: string; desktop: Verdict; phone: Verdict; hover: Verdict; detail?: string };

/** The control on the widget as created; when its effect cannot show there, once more with the tab's content filled in. */
function probe(type: string, leaf: Leaf, all: Leaf[]): Cell {
  const bare = probeOn(type, leaf, all, false);
  return bare.desktop === "ok" ? bare : probeOn(type, leaf, all, true);
}

function probeOn(type: string, leaf: Leaf, all: Leaf[], populate: boolean): Cell {
  const cell: Cell = { widget: type, tab: leaf.tab, group: leaf.group, label: leaf.spec.label ?? leaf.spec.kind, path: leaf.spec.path.join("."), desktop: "n/a", phone: "n/a", hover: "n/a" };
  const base = prepare(type, leaf, all, populate);
  if (!base) {
    cell.desktop = "cannot enable";
    return cell;
  }
  const before = render(base);
  const responsive = isResponsive(leaf.spec);
  const underHover = leaf.spec.path[0] === "style" && leaf.spec.path[1] === "hover";

  // Desktop. A select or choice gets every option tried: the first may be what the widget does anyway.
  const current = readAt(base, leaf.spec.path);
  const spec = leaf.spec;
  const values: unknown[] = spec.kind === "select" || spec.kind === "choice" ? spec.options.map((option) => (spec.numeric ? Number(option.value) : option.value)).filter((value) => !same(value, current) && value !== "") : [undefined];
  let desktop = base;
  let afterDesktop = before;
  for (const option of values) {
    desktop = base;
    for (const [path, value] of writes(spec, current)) desktop = setPath(desktop, path, responsive ? setAt(readAt(base, path) as never, "desktop", (option ?? value) as never) : (option ?? value));
    afterDesktop = render(desktop);
    if (afterDesktop.css !== before.css || afterDesktop.html !== before.html) break;
  }
  const report = validateElement(desktop, type);
  if (report.errors.length > 0) {
    cell.desktop = "invalid";
    cell.detail = report.errors.join("; ");
  } else if (afterDesktop.css === before.css && afterDesktop.html === before.html) cell.desktop = "no effect";
  else cell.desktop = "ok";

  // Hover: only the :hover rules may change.
  if (underHover) {
    if (afterDesktop.html !== before.html || notHover(afterDesktop.css) !== notHover(before.css)) cell.hover = "leaks";
    else if (hoverOnly(afterDesktop.css) === hoverOnly(before.css)) cell.hover = "no effect";
    else cell.hover = "ok";
  }

  // A phone-only override on top of the desktop value: only the phone block may change, and
  // the desktop value stays (the file format needs a desktop base, which the desktop value is).
  if (responsive) {
    let phone = desktop;
    for (const [path, value] of writes(leaf.spec, readAt(desktop, leaf.spec.path), 1)) phone = setPath(phone, path, setAt(readAt(desktop, path) as never, "mobile" as Device, value as never));
    const afterPhone = render(phone);
    const changed = changedBuckets(afterDesktop.css, afterPhone.css);
    if (afterPhone.html !== afterDesktop.html || changed.some((key) => key !== MOBILE)) {
      cell.phone = "leaks";
      cell.detail = `changed: ${[...changed, ...(afterPhone.html !== afterDesktop.html ? ["html"] : [])].join(", ")}`;
    } else if (!changed.includes(MOBILE)) cell.phone = "no effect";
    else cell.phone = "ok";
  }
  return cell;
}

/**
 * Controls whose value only shows when the visitor does something (presses play, submits
 * the form, scrolls) or when the page runs: a static render cannot show them, so they are
 * checked by the widget's own tests instead and recorded here with the reason.
 */
const BEHAVIOUR_ONLY: Record<string, string> = {
  "video:props.autoplay": "part of the player address, built when the visitor presses play (builder.spec.ts: the video facade)",
  "video:props.loop": "part of the player address, built when the visitor presses play",
  "video:props.muted": "part of the player address, built when the visitor presses play",
  "video:props.start": "part of the player address, built when the visitor presses play",
  "carousel:props.autoplay": "runs after the page loads (never in the editor)",
  "carousel:props.interval": "runs after the page loads",
  "carousel:props.pauseOnHover": "runs after the page loads",
  "carousel:props.loop": "runs after the page loads",
  "form:props.success": "shown after the form is sent (builder.spec.ts: the form sends and shows the thank-you)",
  "form:props.redirect": "followed after the form is sent",
  "counter:props.duration": "the count-up animation after the page loads",
};

const ALL = widgetDefinitions().map((definition) => definition.type);
const results: Cell[] = [];

describe("every control reaches the page", () => {
  for (const type of ALL) {
    it(`${type}: content, style, hover and advanced controls at desktop, as a phone override and on hover`, () => {
      const failures: string[] = [];
      for (const { tab, specs } of tabsOf(type)) {
        const all = leaves(specs, tab);
        for (const leaf of all) {
          const cell = probe(type, leaf, all);
          results.push(cell);
          const key = `${type}:${cell.path}`;
          if (BEHAVIOUR_ONLY[key]) continue;
          const where = `${tab} › ${cell.group} › ${cell.label} (${cell.path})`;
          if (cell.desktop !== "ok") failures.push(`${where}: desktop ${cell.desktop}${cell.detail ? ` (${cell.detail})` : ""}`);
          if (cell.phone !== "ok" && cell.phone !== "n/a") failures.push(`${where}: phone override ${cell.phone}${cell.detail ? ` (${cell.detail})` : ""}`);
          if (cell.hover !== "ok" && cell.hover !== "n/a") failures.push(`${where}: hover ${cell.hover}`);
        }
      }
      expect(failures).toEqual([]);
    });
  }

  it("covers the whole library, and every behaviour-only exception names a real control", () => {
    expect(ALL.length).toBeGreaterThanOrEqual(32);
    const keys = new Set(results.map((cell) => `${cell.widget}:${cell.path}`));
    for (const key of Object.keys(BEHAVIOUR_ONLY)) expect(keys.has(key), `${key} is a control`).toBe(true);
    if (import.meta.env["COVERAGE_MATRIX"]) console.log(matrix(results));
  });
});

// --- the matrix for docs/AUDIT.md -----------------------------------------------------------------------------

function matrix(cells: Cell[]): string {
  const tabs: Tab[] = ["Content", "Style", "Style (hover)", "Advanced"];
  const summary = (widget: string, tab: Tab): string => {
    const own = cells.filter((cell) => cell.widget === widget && cell.tab === tab);
    if (own.length === 0) return "—";
    const problems = own.filter((cell) => cell.desktop !== "ok" || (cell.phone !== "ok" && cell.phone !== "n/a") || (cell.hover !== "ok" && cell.hover !== "n/a"));
    const behaviour = problems.filter((cell) => BEHAVIOUR_ONLY[`${cell.widget}:${cell.path}`]);
    const broken = problems.filter((cell) => !BEHAVIOUR_ONLY[`${cell.widget}:${cell.path}`]);
    const phone = own.filter((cell) => cell.phone !== "n/a").length;
    const hover = own.filter((cell) => cell.hover !== "n/a").length;
    const counts = `${own.length} controls${phone ? `, ${phone} per device` : ""}${hover ? `, ${hover} on hover` : ""}`;
    const notes = [...(behaviour.length ? [`${behaviour.length} behaviour-only: ${behaviour.map((cell) => cell.label).join(", ")}`] : []), ...(broken.length ? [`broken: ${broken.map((cell) => `${cell.label} (${cell.desktop}/${cell.phone}/${cell.hover})`).join(", ")}`] : [])];
    return `${broken.length ? "**Still broken**" : "Works"} (${counts}${notes.length ? `; ${notes.join("; ")}` : ""})`;
  };
  const lines = [`| Widget | ${tabs.join(" | ")} |`, `| --- | ${tabs.map(() => "---").join(" | ")} |`];
  for (const widget of ALL) lines.push(`| ${widget} | ${tabs.map((tab) => summary(widget, tab)).join(" | ")} |`);
  return lines.join("\n");
}
