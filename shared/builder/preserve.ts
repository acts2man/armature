/**
 * Values the validator could not read are never lost by a publish: they are kept exactly
 * as they were in the file unless the person changed that very setting. This module puts
 * them back (the dashboard before it sends, the publish function before it commits) and
 * tells a preserved value from a new one (the publish function refuses the latter).
 * Pure module.
 */
import { UNSUPPORTED_TYPE, type Element, type LayoutDoc, type SiteKit } from "../../kit/types.ts";
import { readPath, type Problem, type ProblemPath } from "../../kit/validate.ts";
import { deepEqual } from "../contentFile.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Set a nested value immutably, creating objects on the way. */
function writePath<T>(target: T, path: ProblemPath, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path as [string | number, ...ProblemPath];
  if (Array.isArray(target)) {
    const copy = [...(target as unknown[])];
    copy[Number(head)] = writePath(copy[Number(head)], rest, value);
    return copy as unknown as T;
  }
  const record: Record<string, unknown> = isRecord(target) ? target : {};
  return { ...record, [head]: writePath(record[String(head)], rest, value) } as unknown as T;
}

/**
 * Put one dropped value back at `path` in `current`, when the person left that setting
 * alone. A dropped list item goes back into its list only when the list is untouched
 * (compared with `baseline`, the cleaned version the editing started from); a dropped
 * property goes back when nothing was set in its place, or when the default that filled
 * it is still there.
 */
function restoreAt<T>(current: T, baseline: unknown, path: ProblemPath, value: unknown, filled: unknown): T {
  const last = path[path.length - 1];
  if (typeof last === "number") {
    const parentPath = path.slice(0, -1);
    const list = readPath(current, parentPath);
    if (!Array.isArray(list) || !deepEqual(list, readPath(baseline, parentPath))) return current;
    const copy = [...list];
    copy.splice(Math.min(last, copy.length), 0, value);
    return writePath(current, parentPath, copy);
  }
  const now = readPath(current, path);
  if (now === undefined || (filled !== undefined && deepEqual(now, filled))) return writePath(current, path, value);
  return current;
}

/**
 * A layout about to be published with every unread value put back: unsupported
 * placeholders become the original elements again (wherever they now sit), dropped
 * settings return unless the person set that setting.
 */
export function restoreLayoutProblems(layout: LayoutDoc, baseline: LayoutDoc | undefined, problems: Problem[]): LayoutDoc {
  const rawElements = new Map<string, unknown>();
  const settings = new Map<string, Problem[]>();
  let out = layout;
  for (const problem of problems) {
    if (problem.effect === "file") continue;
    if (problem.effect === "element" && problem.elementId) rawElements.set(problem.elementId, problem.value);
    else if (problem.effect === "ignored" && problem.relativePath) {
      if (problem.elementId) settings.set(problem.elementId, [...(settings.get(problem.elementId) ?? []), problem]);
      else out = restoreAt(out, baseline, problem.relativePath, problem.value, problem.filled);
    }
  }
  if (rawElements.size === 0 && settings.size === 0) return out;
  const baselineById = new Map<string, Element>();
  const walkBaseline = (elements: Element[]) => {
    for (const element of elements) {
      baselineById.set(element.id, element);
      if (element.children) walkBaseline(element.children);
    }
  };
  if (baseline) walkBaseline(baseline.root);
  const restore = (elements: Element[]): Element[] =>
    elements.map((element) => {
      if (element.type === UNSUPPORTED_TYPE && rawElements.has(element.id)) return rawElements.get(element.id) as Element;
      let next = element;
      for (const problem of settings.get(element.id) ?? []) next = restoreAt(next, baselineById.get(element.id), problem.relativePath ?? [], problem.value, problem.filled);
      if (next.children) {
        const children = restore(next.children);
        if (children !== next.children) next = { ...next, children };
      }
      return next;
    });
  return { ...out, root: restore(out.root) };
}

/** The site kit about to be published with every unread value put back (see restoreLayoutProblems). */
export function restoreKitProblems(kit: SiteKit, baseline: SiteKit | undefined, problems: Problem[]): SiteKit {
  let out: unknown = kit;
  for (const problem of problems) {
    if (problem.effect !== "ignored" || !problem.relativePath) continue;
    out = restoreAt(out, baseline, problem.relativePath, problem.value, problem.filled);
  }
  return out as SiteKit;
}

/** Every element-shaped thing in a raw layout, in document order. */
function rawElements(raw: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      out.push(item);
      if (isRecord(item)) walk(item["children"]);
    }
  };
  if (isRecord(raw)) walk(raw["root"]);
  return out;
}

/**
 * Of the problems found in a file about to be committed, the ones whose value is NOT
 * already in the committed file (`theirs`, parsed but not cleaned): those are new unread
 * values and a publish refuses them. A value that is already there is preserved as is.
 */
export function unpreservedProblems(problems: Problem[], theirs: unknown): Problem[] {
  if (problems.length === 0) return [];
  const elements = rawElements(theirs);
  const byId = new Map<string, unknown>();
  for (const element of elements) if (isRecord(element) && typeof element["id"] === "string") byId.set(element["id"], element);
  const present = (container: unknown, path: ProblemPath, value: unknown): boolean => {
    const last = path[path.length - 1];
    if (typeof last === "number") {
      const list = readPath(container, path.slice(0, -1));
      return Array.isArray(list) && list.some((item) => deepEqual(item, value));
    }
    return deepEqual(readPath(container, path), value);
  };
  return problems.filter((problem) => {
    if (problem.effect === "file") return true;
    if (problem.effect === "element") return !elements.some((element) => deepEqual(element, problem.value));
    if (!problem.relativePath) return true;
    if (problem.elementId) {
      const element = byId.get(problem.elementId);
      return !element || !present(element, problem.relativePath, problem.value);
    }
    return !present(theirs, problem.relativePath, problem.value);
  });
}
