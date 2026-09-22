import type { Path } from "./types.ts";

/** Reads a path out of an element or the kit ("props.text", "colors.primary"). */
export function readAt(source: unknown, path: Path): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
