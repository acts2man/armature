/**
 * The handles on the selected element, drawn above the frame: padding (green, inside)
 * and margin (amber, outside) on each side, image width and height, the boundary between
 * two side-by-side columns, a spacer's height and a container's minimum height. Every
 * handle drags with the pointer (Shift or Alt moves the opposite side too, Esc reverts)
 * and nudges with the arrow keys (Shift for 10), and the page follows live.
 */
import { clsx } from "clsx";
import { useState } from "react";
import { resolve, type Device, type Element, type ImageProps, type Sides, type Size } from "@shared/builder/index.ts";
import type { ElementRect } from "@shared/visualProtocol.ts";
import { dragHeight, dragSpacing, inwardDelta, keyDelta, resizeColumns, resizeImage, trackHandle, type HandleWrite, type Side } from "./handles.ts";
import { isContainerType } from "./store.ts";

export type HandleActions = {
  onWrite: (writes: HandleWrite[], label: string, group: string) => void;
  /** Esc during a drag: drop every change the drag made. */
  onCancel: (group: string) => void;
};

type Active = { label: string; value: string; x: number; y: number };

const sizeText = (size: Size | undefined) => (size ? `${size.value}${size.unit}` : "");

export function Handles({
  selected,
  element,
  next,
  parent,
  scale,
  device,
  actions,
}: {
  selected: ElementRect;
  element: Element;
  /** The next sibling when it sits beside this one (a column boundary). */
  next?: { rect: ElementRect; element: Element };
  parent?: ElementRect;
  scale: number;
  device: Device;
  actions: HandleActions;
}) {
  const [active, setActive] = useState<Active | null>(null);
  const r = selected.rect;
  const s = scale;
  const isBox = isContainerType(element.type) || element.type === "site-section";

  /** Starts a drag: `compute` turns the total movement into writes and a value to show. */
  const begin = (event: React.PointerEvent, kind: string, compute: (dx: number, dy: number, symmetric: boolean) => { writes: HandleWrite[]; label: string; value: string }) => {
    const group = `drag:${kind}:${element.id}:${Math.round(event.timeStamp)}`;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    trackHandle(event, s, {
      onMove: (dx, dy, modifiers) => {
        const result = compute(dx, dy, modifiers.shift || modifiers.alt);
        moved = true;
        actions.onWrite(result.writes, result.label, group);
        setActive({ label: result.label, value: result.value, x: startX + dx * s, y: startY + dy * s });
      },
      onEnd: () => setActive(null),
      onCancel: () => {
        setActive(null);
        if (moved) actions.onCancel(group);
      },
    });
  };
  /** The same change from the keyboard: each press is its own step, merged while pressing. */
  const nudge = (event: React.KeyboardEvent, kind: string, axis: "x" | "y", compute: (dx: number, dy: number, symmetric: boolean) => { writes: HandleWrite[]; label: string }) => {
    const delta = keyDelta(event, axis);
    if (delta === null) return;
    event.preventDefault();
    event.stopPropagation();
    const result = compute(axis === "x" ? delta : 0, axis === "y" ? delta : 0, event.altKey);
    actions.onWrite(result.writes, result.label, `key:${kind}:${element.id}`);
  };

  const handles: React.ReactNode[] = [];

  // --- spacing ------------------------------------------------------------------------------------------
  const spacingSides: Side[] = isBox ? ["top", "right", "bottom", "left"] : [];
  const marginSides: Side[] = ["top", "bottom"];
  const spacing = (kind: "padding" | "margin", side: Side) => {
    const measured = { ...selected[kind] };
    const current = resolve<Partial<Sides<Size>>>(element.advanced[kind] as never, device);
    const name = kind === "padding" ? "Padding" : "Margin";
    return (dx: number, dy: number, symmetric: boolean) => {
      const inward = inwardDelta(side, dx, dy);
      const delta = kind === "padding" ? inward : -inward;
      const value = dragSpacing(current, measured, side, delta, { kind, symmetric });
      return { writes: [{ id: element.id, path: ["advanced", kind], value, responsive: true }], label: `${name} ${side}${symmetric ? " and " + ({ top: "bottom", bottom: "top", left: "right", right: "left" } as const)[side] : ""}`, value: sizeText(value[side]) };
    };
  };
  const spacingHandle = (kind: "padding" | "margin", side: Side) => {
    const box = selected[kind];
    const vertical = side === "left" || side === "right";
    // Padding sits just inside its edge, margin just outside, so the two never overlap.
    const offset = (kind === "padding" ? Math.max(box[side] * s, 7) : -Math.max(box[side] * s, 7));
    const cx = side === "left" ? r.x * s + offset : side === "right" ? (r.x + r.width) * s - offset : (r.x + r.width / 2) * s + (kind === "margin" ? 22 : 0);
    const cy = side === "top" ? r.y * s + offset : side === "bottom" ? (r.y + r.height) * s - offset : (r.y + r.height / 2) * s;
    const label = `${kind === "padding" ? "Padding" : "Margin"} ${side}: drag, or use the arrow keys`;
    return (
      <button
        key={`${kind}-${side}`}
        type="button"
        aria-label={label}
        title={`${kind === "padding" ? "Padding" : "Margin"} ${side} (${Math.round(box[side])}px). Shift: both sides`}
        data-testid={`handle-${kind}-${side}`}
        onPointerDown={(event) => begin(event, `${kind}-${side}`, spacing(kind, side))}
        onKeyDown={(event) => nudge(event, `${kind}-${side}`, vertical ? "x" : "y", spacing(kind, side))}
        className={clsx(
          "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.15)] focus-visible:outline-2 focus-visible:outline-accent",
          vertical ? "h-4 w-1.5 cursor-ew-resize" : "h-1.5 w-4 cursor-ns-resize",
          kind === "padding" ? "bg-green" : "bg-amber",
        )}
        style={{ left: cx, top: cy }}
      />
    );
  };
  for (const side of spacingSides) handles.push(spacingHandle("padding", side));
  for (const side of marginSides) handles.push(spacingHandle("margin", side));

  // --- image width and height ---------------------------------------------------------------------------
  if (element.type === "image" && selected.inner) {
    const img = selected.inner;
    const props = element.props as ImageProps;
    const box = r.width - selected.padding.left - selected.padding.right;
    const width = (dx: number) => {
      const value = resizeImage(resolve<Size>(props.width as never, device), img.width, box, dx);
      return { writes: [{ id: element.id, path: ["props", "width"], value, responsive: true }], label: "Resized the image", value: sizeText(value) };
    };
    const height = (_dx: number, dy: number) => {
      const value = dragHeight(img.height, dy, 16, 2000, resolve<Size>(props.height as never, device));
      return { writes: [{ id: element.id, path: ["props", "height"], value, responsive: true }, ...(props.fit ? [] : [{ id: element.id, path: ["props", "fit"], value: "cover", responsive: false }])], label: "Changed the image height", value: sizeText(value) };
    };
    handles.push(
      <button key="img-w" type="button" aria-label="Image width: drag, or use the arrow keys" data-testid="handle-image-width" onPointerDown={(event) => begin(event, "img-w", (dx) => width(dx))} onKeyDown={(event) => nudge(event, "img-w", "x", (dx) => width(dx))} className="pointer-events-auto absolute h-6 w-2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-accent bg-white" style={{ left: (img.x + img.width) * s, top: (img.y + img.height / 2) * s }} />,
      <button key="img-c" type="button" aria-label="Image size: drag the corner" tabIndex={-1} data-testid="handle-image-corner" onPointerDown={(event) => begin(event, "img-c", (dx) => width(dx))} className="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize border-2 border-accent bg-white" style={{ left: (img.x + img.width) * s, top: (img.y + img.height) * s }} />,
      <button key="img-h" type="button" aria-label="Image height: drag, or use the arrow keys" data-testid="handle-image-height" onPointerDown={(event) => begin(event, "img-h", height)} onKeyDown={(event) => nudge(event, "img-h", "y", height)} className="pointer-events-auto absolute h-2 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-full border-2 border-accent bg-white" style={{ left: (img.x + img.width / 2) * s, top: (img.y + img.height) * s }} />,
    );
  }

  // --- column boundary -------------------------------------------------------------------------------------
  if (next && parent) {
    const row = parent.inner ?? parent.rect;
    const rowWidth = row.width;
    const left = r.width;
    const right = next.rect.rect.width;
    const percentOf = (target: Element): number | undefined => {
      const mode = resolve<string>(target.advanced.width as never, device);
      const size = resolve<Size>(target.advanced.customWidth as never, device);
      return mode === "custom" && size?.unit === "%" ? size.value : undefined;
    };
    const ownLeft = percentOf(element);
    const ownRight = percentOf(next.element);
    const columns = (dx: number) => {
      const [l, rr] = resizeColumns(left, right, rowWidth, dx, 5, ownLeft !== undefined && ownRight !== undefined ? [ownLeft, ownRight] : undefined);
      return {
        writes: [
          { id: element.id, path: ["advanced", "width"], value: "custom", responsive: true },
          { id: element.id, path: ["advanced", "customWidth"], value: { value: l, unit: "%" }, responsive: true },
          { id: next.element.id, path: ["advanced", "width"], value: "custom", responsive: true },
          { id: next.element.id, path: ["advanced", "customWidth"], value: { value: rr, unit: "%" }, responsive: true },
        ],
        label: "Resized the columns",
        value: `${l}% · ${rr}%`,
      };
    };
    const x = ((r.x + r.width + next.rect.rect.x) / 2) * s;
    handles.push(
      <button key="columns" type="button" aria-label="Column width: drag, or use the arrow keys" data-testid="handle-columns" onPointerDown={(event) => begin(event, "columns", (dx) => columns(dx))} onKeyDown={(event) => nudge(event, "columns", "x", (dx) => columns(dx * 4))} className="pointer-events-auto absolute h-10 w-2.5 -translate-x-1/2 -translate-y-1/2 cursor-col-resize rounded-full border-2 border-white bg-accent shadow-pop" style={{ left: x, top: (r.y + r.height / 2) * s }} />,
    );
  }

  // --- heights: spacer, container minimum height -----------------------------------------------------------------
  if (element.type === "spacer" || isContainerType(element.type)) {
    const spacer = element.type === "spacer";
    const height = (_dx: number, dy: number) => {
      const own = resolve<Size | "screen">((element.props as Record<string, unknown>)[spacer ? "height" : "minHeight"] as never, device);
      const value = dragHeight(r.height, dy, spacer ? 1 : 0, spacer ? 1000 : 3000, own);
      return { writes: [{ id: element.id, path: ["props", spacer ? "height" : "minHeight"], value, responsive: true }], label: spacer ? "Changed the spacer height" : "Changed the minimum height", value: sizeText(value) };
    };
    handles.push(
      <button
        key="height"
        type="button"
        aria-label={spacer ? "Spacer height: drag, or use the arrow keys" : "Minimum height: drag, or use the arrow keys"}
        data-testid={spacer ? "handle-spacer" : "handle-min-height"}
        onPointerDown={(event) => begin(event, "height", height)}
        onKeyDown={(event) => nudge(event, "height", "y", height)}
        className="pointer-events-auto absolute flex h-2.5 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize items-center justify-center rounded-full border-2 border-white bg-accent shadow-pop"
        style={{ left: (r.x + r.width * (spacer ? 0.5 : 0.75)) * s, top: (r.y + r.height) * s }}
      />,
    );
  }

  return (
    <>
      {/* While dragging a spacing handle: the padding and margin areas, shaded. */}
      {active && (
        <>
          {/* Padding inside the edges, margin outside, shaded while a handle drags. */}
          <div className="pointer-events-none absolute bg-green/10" style={{ left: r.x * s, top: r.y * s, width: r.width * s, height: selected.padding.top * s }} />
          <div className="pointer-events-none absolute bg-green/10" style={{ left: r.x * s, top: (r.y + r.height - selected.padding.bottom) * s, width: r.width * s, height: selected.padding.bottom * s }} />
          <div className="pointer-events-none absolute bg-green/10" style={{ left: r.x * s, top: (r.y + selected.padding.top) * s, width: selected.padding.left * s, height: Math.max(0, r.height - selected.padding.top - selected.padding.bottom) * s }} />
          <div className="pointer-events-none absolute bg-green/10" style={{ left: (r.x + r.width - selected.padding.right) * s, top: (r.y + selected.padding.top) * s, width: selected.padding.right * s, height: Math.max(0, r.height - selected.padding.top - selected.padding.bottom) * s }} />
          <div className="pointer-events-none absolute bg-amber/10" style={{ left: r.x * s, top: (r.y - Math.max(0, selected.margin.top)) * s, width: r.width * s, height: Math.max(0, selected.margin.top) * s }} />
          <div className="pointer-events-none absolute bg-amber/10" style={{ left: r.x * s, top: (r.y + r.height) * s, width: r.width * s, height: Math.max(0, selected.margin.bottom) * s }} />
        </>
      )}
      {handles}
      {active && (
        <span className="pointer-events-none fixed z-50 -translate-y-8 rounded-sm bg-ink px-2 py-1 text-[11px] font-semibold text-white shadow-dark" style={{ left: active.x + 12, top: active.y }} data-testid="handle-value">
          {active.label}: {active.value}
        </span>
      )}
    </>
  );
}
