/**
 * Direct manipulation on the canvas: the maths behind the resize and spacing handles
 * (pure, unit-tested), and one pointer helper every handle uses. A handle reports a
 * change as a list of writes; the editor turns each pointer frame into one command in a
 * "drag:" group, so a whole drag is one undo step and the page follows it live.
 */
import type { Sides, Size } from "@shared/builder/index.ts";

export type Side = "top" | "right" | "bottom" | "left";
export const SIDES: Side[] = ["top", "right", "bottom", "left"];
export const OPPOSITE: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** One change a handle makes: a path on an element, written for the current device when responsive. */
export type HandleWrite = { id: string; path: string[]; value: unknown; responsive: boolean };

export const px = (value: number): Size => ({ value: Math.round(value), unit: "px" });
export const pct = (value: number): Size => ({ value: Math.round(value * 10) / 10, unit: "%" });
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * New spacing for one side after a drag of `delta` model pixels. Padding grows as the
 * handle moves inward, margin as it moves outward; Alt moves the opposite side too and
 * Shift all four. Sides that were not touched keep their value.
 */
export function dragSpacing(
  current: Partial<Sides<Size>> | undefined,
  measured: Record<Side, number>,
  side: Side,
  delta: number,
  options: { kind: "padding" | "margin"; /** Alt: the opposite side too. Shift: all four. */ mode?: "one" | "opposite" | "all" },
): Partial<Sides<Size>> {
  const min = options.kind === "padding" ? 0 : -500;
  // The element's own pixel value when it has one (so repeated nudges add up), else what the page measured.
  const own = current?.[side];
  const base = own && own.unit === "px" ? own.value : measured[side];
  const next = clamp(base + delta, min, 1000);
  const out: Partial<Sides<Size>> = { ...(current ?? {}) };
  out[side] = px(next);
  if (options.mode === "opposite") out[OPPOSITE[side]] = px(next);
  if (options.mode === "all") for (const other of SIDES) out[other] = px(next);
  return out;
}

/** How far the pointer moved "into" a side: positive grows padding, for margin it is flipped by the caller. */
export function inwardDelta(side: Side, dx: number, dy: number): number {
  switch (side) {
    case "top":
      return dy;
    case "bottom":
      return -dy;
    case "left":
      return dx;
    case "right":
      return -dx;
  }
}

/** Percentages a resize snaps to when it comes within `within` of one. */
export const SNAPS = [25, 100 / 3, 50, 200 / 3, 75, 100];
export function snapPercent(value: number, within = 1.5, snaps: number[] = SNAPS): number {
  for (const snap of snaps) if (Math.abs(value - snap) <= within) return Math.round(snap * 10) / 10;
  return value;
}

/**
 * Resize two side-by-side columns: `delta` model pixels moves the boundary between them.
 * Returns both widths as percentages of the row, keeping their sum, each at least `min`%.
 */
export function resizeColumns(left: number, right: number, row: number, delta: number, min = 5, current?: [number, number]): [number, number] {
  if (row <= 0) return [left, right];
  // The columns' own percentages when both have one, else their measured share of the row.
  const l = current ? current[0] : (left / row) * 100;
  const r = current ? current[1] : (right / row) * 100;
  const total = l + r;
  // Snap the boundary at the usual splits of the pair (a quarter, a third, a half, ...).
  const raw = clamp(l + (delta / row) * 100, min, total - min);
  const share = snapPercent((raw / total) * 100);
  const nextLeft = Math.round(((share / 100) * total) * 10) / 10;
  return [nextLeft, Math.round((total - nextLeft) * 10) / 10];
}

/**
 * An image's new width after dragging its right edge or corner: percentages of the box
 * it sits in when the width is already a percentage (the default), pixels otherwise.
 */
export function resizeImage(current: Size | undefined, imageWidth: number, boxWidth: number, delta: number): Size {
  if (current?.unit === "%" && boxWidth > 0) return pct(snapPercent(clamp(current.value + (delta / boxWidth) * 100, 5, 100)));
  if (current?.unit === "px") return px(clamp(current.value + delta, 16, Math.max(16, boxWidth)));
  const width = clamp(imageWidth + delta, 16, Math.max(16, boxWidth));
  return pct(boxWidth > 0 ? snapPercent(clamp((width / boxWidth) * 100, 5, 100)) : 100);
}

/** A height dragged from the bottom edge (spacer height, container minimum height, image height). */
export const dragHeight = (height: number, delta: number, min = 0, max = 2000, current?: Size | "screen"): Size => px(clamp((current && current !== "screen" && current.unit === "px" ? current.value : height) + delta, min, max));

/** Arrow keys on a focused handle: one model pixel, ten with Shift. */
export function keyDelta(event: { key: string; shiftKey: boolean }, axis: "x" | "y"): number | null {
  const step = event.shiftKey ? 10 : 1;
  if (axis === "y" && event.key === "ArrowDown") return step;
  if (axis === "y" && event.key === "ArrowUp") return -step;
  if (axis === "x" && event.key === "ArrowRight") return step;
  if (axis === "x" && event.key === "ArrowLeft") return -step;
  return null;
}

/**
 * Pointer tracking for a handle: captures the pointer, reports the movement in model
 * pixels (screen pixels divided by the canvas scale) at most once per frame, and ends on
 * release, cancel or Escape (which reverts through `onCancel`).
 */
export function trackHandle(
  event: React.PointerEvent,
  scale: number,
  handlers: { onMove: (dx: number, dy: number, modifiers: { shift: boolean; alt: boolean }) => void; onEnd: () => void; onCancel: () => void },
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget as HTMLElement;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startY = event.clientY;
  let frame = 0;
  let last: PointerEvent | null = null;
  target.setPointerCapture(pointerId);
  const flush = () => {
    frame = 0;
    if (!last) return;
    handlers.onMove((last.clientX - startX) / scale, (last.clientY - startY) / scale, { shift: last.shiftKey, alt: last.altKey });
  };
  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    last = next;
    if (!frame) frame = requestAnimationFrame(flush);
  };
  const cleanup = () => {
    if (frame) cancelAnimationFrame(frame);
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", cancel);
    window.removeEventListener("keydown", key, true);
    document.body.style.cursor = "";
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  };
  const up = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    last = next;
    flush();
    cleanup();
    handlers.onEnd();
  };
  const cancel = () => {
    cleanup();
    handlers.onCancel();
  };
  const key = (next: KeyboardEvent) => {
    if (next.key !== "Escape") return;
    next.preventDefault();
    next.stopPropagation();
    cancel();
  };
  document.body.style.cursor = getComputedStyle(target).cursor;
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", cancel);
  window.addEventListener("keydown", key, true);
}
