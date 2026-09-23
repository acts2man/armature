/**
 * What a client may change in a page layout, checked against what is committed (the
 * publish function enforces it; the editor already hides what is not allowed).
 *
 * - Agency staff: everything.
 * - "content" level: no layout or kit changes at all (Stage 1 editing only).
 * - "style" level: words, pictures and styling, but not structure: the same elements, in
 *   the same containers, in the same order.
 * - "builder" level: structure too.
 * At every client level: locked elements (and everything inside them) keep their place,
 * style and advanced settings (their words may change); lock flags, agency-only widgets
 * (the HTML embed) and agency-only settings (CSS id, classes, attributes, custom CSS)
 * never change.
 */
import type { Element, LayoutDoc } from "../../kit/types.ts";
import { stableJson } from "./merge.ts";
import { AGENCY_ONLY_TYPES } from "../../kit/validate.ts";

export type EditingLevel = "content" | "style" | "builder";
export type Permissions = { staff: boolean; level: EditingLevel };

type Entry = { element: Element; parent: string | null; index: number; locked: boolean };

function index(layout: LayoutDoc | null): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const walk = (elements: Element[], parent: string | null, locked: boolean) => {
    elements.forEach((element, position) => {
      const isLocked = locked || element.locked === true;
      out.set(element.id, { element, parent, index: position, locked: isLocked });
      if (element.children) walk(element.children, element.id, isLocked);
    });
  };
  if (layout) walk(layout.root, null, false);
  return out;
}

const AGENCY_ADVANCED = ["cssId", "cssClasses", "attributes", "customCss"] as const;
const name = (element: Element) => element.label || element.type.replace(/-/g, " ");

/** Every rule the change breaks, in plain words (empty when it is allowed). */
export function layoutPermissionErrors(theirs: LayoutDoc | null, mine: LayoutDoc | null, permissions: Permissions, options: { coded?: boolean } = {}): string[] {
  if (permissions.staff) return [];
  if (stableJson(theirs) === stableJson(mine)) return [];
  const page = mine?.label ?? theirs?.label ?? mine?.pageSlug ?? theirs?.pageSlug ?? "this page";
  if (permissions.level === "content") return [`${page}: your account can change words and pictures only; ask the agency to change the layout.`];
  const errors: string[] = [];
  const before = index(theirs);
  const after = index(mine);

  // A page coded into the site gets its first layout by being restyled: only its own site
  // sections, nothing added (the editor seeds them from the site's code, which this cannot see).
  const firstLayoutOfCodedPage = !theirs && !!mine && options.coded === true && mine.root.every((element) => element.type === "site-section" && !element.children?.length);
  if (permissions.level === "style" && !firstLayoutOfCodedPage) {
    const structure = (map: Map<string, Entry>) => stableJson([...map].map(([id, entry]) => [id, entry.element.type, entry.parent, entry.index]).sort());
    if (structure(before) !== structure(after)) errors.push(`${page}: your account can restyle this page but not add, move or remove elements.`);
    if (!theirs || !mine) errors.push(`${page}: your account cannot create or delete pages.`);
  }

  for (const [id, entry] of before) {
    const next = after.get(id);
    const element = entry.element;
    if (AGENCY_ONLY_TYPES.includes(element.type) && (!next || stableJson({ ...next.element, children: undefined, meta: undefined }) !== stableJson({ ...element, children: undefined, meta: undefined }))) {
      errors.push(`${page}: the ${name(element)} is managed by the agency.`);
      continue;
    }
    if (entry.locked) {
      if (!next) {
        errors.push(`${page}: "${name(element)}" is locked and cannot be deleted.`);
        continue;
      }
      if (next.parent !== entry.parent || next.index !== entry.index) errors.push(`${page}: "${name(element)}" is locked and cannot be moved.`);
      if (stableJson(next.element.style) !== stableJson(element.style) || stableJson(next.element.advanced) !== stableJson(element.advanced)) errors.push(`${page}: "${name(element)}" is locked and cannot be restyled.`);
    }
    if (next && (next.element.locked === true) !== (element.locked === true)) errors.push(`${page}: only the agency can lock or unlock "${name(element)}".`);
    if (next) {
      for (const key of AGENCY_ADVANCED) {
        if (stableJson(next.element.advanced[key]) !== stableJson(element.advanced[key])) {
          errors.push(`${page}: "${name(element)}": its CSS and attributes are managed by the agency.`);
          break;
        }
      }
    }
  }
  for (const [id, entry] of after) {
    if (before.has(id)) continue;
    const element = entry.element;
    if (AGENCY_ONLY_TYPES.includes(element.type)) errors.push(`${page}: only the agency can add a ${name(element)}.`);
    if (element.locked) errors.push(`${page}: only the agency can lock elements.`);
    if (AGENCY_ADVANCED.some((key) => element.advanced[key] !== undefined)) errors.push(`${page}: "${name(element)}": CSS and attributes are managed by the agency.`);
    // A new element cannot land inside a locked container.
    const parent = entry.parent ? before.get(entry.parent) : undefined;
    if (parent?.locked) errors.push(`${page}: "${name(parent.element)}" is locked; nothing can be added inside it.`);
  }
  return Array.from(new Set(errors));
}

/** Kit changes: only the content level is refused. */
export const kitPermissionErrors = (changed: boolean, permissions: Permissions): string[] => (changed && !permissions.staff && permissions.level === "content" ? ["Your account can change words and pictures only; ask the agency to change the site's colours and fonts."] : []);
