/**
 * The Elements mode of the engine's left panel: a two-column grid of the elements the
 * engine can insert into a React file (Heading, Text, Image, Button, Box, Row). Click
 * inserts after the selected element (inside it when it is an empty container); drag a
 * tile onto the page to choose the spot.
 */
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { IconBox, IconHeading, IconImage, IconLayout, IconParagraph, IconPointer } from "../../src/components/icons.tsx";
import type { InsertKind } from "../shared/types.ts";
import type { EngineDragSource } from "./useEngineDrag.ts";

export const TILES: { kind: InsertKind; label: string; icon: ReactNode; hint: string }[] = [
  { kind: "heading", label: "Heading", icon: <IconHeading size={18} />, hint: "An h2 with placeholder words" },
  { kind: "text", label: "Text", icon: <IconParagraph size={18} />, hint: "A paragraph" },
  { kind: "image", label: "Image", icon: <IconImage size={18} />, hint: "A picture with alt text" },
  { kind: "button", label: "Button", icon: <IconPointer size={18} />, hint: "A button" },
  { kind: "container", label: "Box", icon: <IconBox size={18} />, hint: "A div to hold other elements" },
  { kind: "row", label: "Row", icon: <IconLayout size={18} />, hint: "A flex row" },
];

export const insertLabel = (kind: InsertKind): string => TILES.find((tile) => tile.kind === kind)?.label ?? kind;

export function EngineElementsPanel({ selectionLabel, onInsert, onBeginDrag }: { selectionLabel: string | null; onInsert: (kind: InsertKind) => void; onBeginDrag: (event: React.PointerEvent, source: EngineDragSource) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="engine-elements-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 pb-2.5 pt-3.5">
        <h2 className="font-display text-[16px] font-semibold text-text">Elements</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-3">
        <p className="mb-3 px-1 text-[12px] leading-relaxed text-muted">{selectionLabel ? `Click a tile to add it after ${selectionLabel}, or drag it onto the page.` : "Drag a tile onto the page, or select an element first and click a tile to add after it."}</p>
        <div className="grid grid-cols-2 gap-1.5">
          {TILES.map((tile) => (
            <button
              key={tile.kind}
              type="button"
              title={`${tile.hint}. Drag onto the page, or click to insert.`}
              data-testid={`engine-tile-${tile.kind === "container" ? "box" : tile.kind}`}
              onPointerDown={(event) => onBeginDrag(event, { kind: "new", insert: tile.kind, label: tile.label })}
              onClick={() => onInsert(tile.kind)}
              className={clsx("flex h-[68px] cursor-grab select-none flex-col items-center justify-center gap-1.5 rounded-control border border-line bg-panel text-[12px] font-medium text-text transition-[border-color,box-shadow] duration-150 hover:border-accent hover:shadow-segment active:cursor-grabbing")}
            >
              <span className="text-muted">{tile.icon}</span>
              <span className="truncate px-1">{tile.label}</span>
            </button>
          ))}
        </div>
        <p className="mt-4 px-1 text-[12px] leading-relaxed text-muted">New elements are written into the page's React file next to the selected element, with plain placeholder words you can change on the page.</p>
      </div>
    </div>
  );
}
