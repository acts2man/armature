/**
 * The Structure group of a section's Layout tab: the column presets as tiles. Picking one
 * rebuilds the section's rows and columns and moves what is inside into the new columns.
 */
import { clsx } from "clsx";
import type { Element } from "@shared/builder/index.ts";
import { SrOnly } from "@/components/ui.tsx";
import { STRUCTURES, type Structure } from "../widgets/registry.ts";

const isContainer = (element: Element) => element.type === "container" || element.type === "grid";

/** The structure a section currently has: its first row's column widths, or one column. */
export function currentStructure(children: Element[] | undefined): Structure | undefined {
  const rows = (children ?? []).filter((child) => isContainer(child) && (child.children ?? []).length > 0 && (child.children ?? []).every(isContainer));
  if (rows.length === 0) return (children ?? []).some(isContainer) ? undefined : STRUCTURES[0];
  const first = rows[0];
  const widths = (first?.children ?? []).map((column) => {
    const custom = column.advanced.customWidth;
    const size = custom && typeof custom === "object" && "desktop" in custom ? custom.desktop : custom;
    return size && typeof size === "object" && "value" in size ? Number(size.value) : 100;
  });
  return STRUCTURES.find((structure) => (structure.rows ?? 1) === rows.length && structure.columns.length === widths.length && structure.columns.every((width, index) => Math.abs(width - (widths[index] ?? 0)) < 1.5));
}

export function StructureControl({ children, onPick }: { children: Element[] | undefined; onPick?: (structureId: string) => void }) {
  const current = currentStructure(children);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] leading-relaxed text-muted">Change the columns. What is inside moves into the new columns, first to last.</p>
      <div className="grid grid-cols-3 gap-2" data-testid="structure-control">
        {STRUCTURES.map((structure) => {
          const active = current?.id === structure.id;
          return (
            <button
              key={structure.id}
              type="button"
              aria-pressed={active}
              disabled={!onPick}
              data-testid={`structure-${structure.id}`}
              onClick={() => onPick?.(structure.id)}
              title={structure.label}
              className={clsx("flex h-12 flex-col items-stretch justify-center gap-0.5 rounded-control border bg-panel p-1.5 disabled:opacity-40", active ? "border-accent shadow-segment" : "border-line hover:border-accent")}
            >
              {Array.from({ length: structure.rows ?? 1 }, (_, row) => (
                <span key={row} className="flex flex-1 gap-0.5">
                  {structure.columns.map((column, index) => (
                    <span key={index} className={clsx("rounded-[2px]", active ? "bg-accent/40" : "bg-grey-soft")} style={{ width: `${column}%` }} aria-hidden="true" />
                  ))}
                </span>
              ))}
              <SrOnly>{structure.label}</SrOnly>
            </button>
          );
        })}
      </div>
    </div>
  );
}
