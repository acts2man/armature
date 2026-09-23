/**
 * The page builder's file rules for the dashboard and the edge functions: strict wrappers
 * over the kit's own validator (kit/validate.ts), which is the one set of rules every
 * side shares, plus file paths and the canonical on-disk form.
 *
 *   - `checkLayout` / `checkSiteKit` / `checkElement` are tolerant: they return a cleaned
 *     value and a list of plain-English problems (re-exported from the kit).
 *   - `validateLayout` / `validateSiteKit` / `validateElement` are strict: any problem
 *     is an error and no value comes back. The publish function and the clipboard use
 *     these for values that were just made in the editor.
 */
import type { Element, LayoutDoc, SiteKit } from "../../kit/types.ts";
import { checkElement, checkLayout, checkSiteKit, describeProblem, LAYOUT_LIMITS, type Problem } from "../../kit/validate.ts";

export * from "../../kit/validate.ts";

// --- reports --------------------------------------------------------------------------------------

export type ValidationReport<T> = { errors: string[]; value?: T };

const errorsFrom = (where: string, problems: Problem[]): string[] => problems.slice(0, 30).map((problem) => `${where}: ${problem.path.length ? `${problem.path.map(String).join(".")}: ` : ""}${describeProblem(problem)}`);

/** Depth and count of a tree, for the limits. */
export function measureTree(root: Element[]): { depth: number; count: number } {
  let count = 0;
  const walk = (elements: Element[], depth: number): number => {
    let deepest = depth;
    for (const element of elements) {
      count += 1;
      if (element.children && element.children.length > 0) deepest = Math.max(deepest, walk(element.children, depth + 1));
    }
    return deepest;
  };
  return { depth: root.length === 0 ? 0 : walk(root, 1), count };
}

/** The serialized size of a layout in bytes. */
export const layoutBytes = (layout: unknown): number => new TextEncoder().encode(JSON.stringify(layout)).length;

/** Strictly validate a parsed layout file: every problem is an error, and the size limit applies. */
export function validateLayout(raw: unknown, where = "layout"): ValidationReport<LayoutDoc> {
  const report = checkLayout(raw);
  const errors = errorsFrom(where, report.problems);
  if (report.value) {
    const bytes = layoutBytes(report.value);
    if (bytes > LAYOUT_LIMITS.fileBytes) errors.push(`${where}: the layout is ${(bytes / 1024 / 1024).toFixed(2)} MB; the limit is ${LAYOUT_LIMITS.fileBytes / 1024 / 1024} MB`);
  }
  return errors.length > 0 || !report.value ? { errors } : { errors, value: report.value };
}

export function validateSiteKit(raw: unknown, where = "site-kit.json"): ValidationReport<SiteKit> {
  const report = checkSiteKit(raw);
  const errors = errorsFrom(where, report.problems);
  return errors.length > 0 || !report.value ? { errors } : { errors, value: report.value };
}

export function validateElement(raw: unknown, where = "element"): ValidationReport<Element> {
  const report = checkElement(raw);
  const errors = errorsFrom(where, report.problems);
  return errors.length > 0 || !report.value ? { errors } : { errors, value: report.value };
}

/** The canonical on-disk form of a layout or kit file (sorted keys, 2-space indent, newline). */
export function serializeBuilderFile(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) out[key] = sort((input as Record<string, unknown>)[key]);
      return out;
    }
    return input;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

export const LAYOUTS_DIR = "content/layouts";
export const SITE_KIT_PATH = "content/site-kit.json";
export const MEDIA_META_PATH = "content/media.json";
export const layoutPath = (slug: string): string => `${LAYOUTS_DIR}/${slug}.json`;
