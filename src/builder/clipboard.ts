/**
 * Copy and paste of elements and styles. The system clipboard carries a tagged JSON
 * payload so copies work across pages, sites and browser tabs; an in-memory copy is the
 * fallback when the clipboard is not available (no permission, an insecure context).
 */
import { validateElement, withFreshIds, type Advanced, type Element, type Style } from "@shared/builder/index.ts";

export type ClipboardPayload = { armature: "element"; element: Element } | { armature: "style"; style: Style; advanced: Advanced };

let memory: ClipboardPayload | null = null;

export async function writeClipboard(payload: ClipboardPayload): Promise<void> {
  memory = payload;
  try {
    await navigator.clipboard?.writeText(JSON.stringify(payload));
  } catch {
    // the in-memory copy still works within this tab
  }
}

/** The clipboard's element or style, validated, or null. */
export async function readClipboard(): Promise<ClipboardPayload | null> {
  let text: string | null;
  try {
    text = (await navigator.clipboard?.readText()) ?? null;
  } catch {
    text = null;
  }
  if (text) {
    const parsed = parsePayload(text);
    if (parsed) return parsed;
  }
  return memory;
}

export function parsePayload(text: string): ClipboardPayload | null {
  try {
    const parsed = JSON.parse(text) as Partial<ClipboardPayload>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.armature === "element") {
      const report = validateElement((parsed as { element: unknown }).element);
      return report.value ? { armature: "element", element: report.value } : null;
    }
    if (parsed.armature === "style") {
      const style = (parsed as { style?: unknown }).style;
      const advanced = (parsed as { advanced?: unknown }).advanced;
      const probe = validateElement({ id: "abcdefgh", type: "spacer", props: {}, style: style ?? {}, advanced: advanced ?? {}, meta: { createdBy: "", updatedAt: "" } });
      return probe.value ? { armature: "style", style: probe.value.style, advanced: probe.value.advanced } : null;
    }
    return null;
  } catch {
    return null;
  }
}

/** A pasted element gets fresh ids so it never collides with the original. */
export const pastedElement = (element: Element): Element => withFreshIds(element);
