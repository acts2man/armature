/**
 * "Select your structure": the dialog that adds a new section made of columns.
 */
import { Modal } from "@/components/ui.tsx";
import { SrOnly } from "@/components/ui.tsx";
import { STRUCTURES, type Structure } from "./widgets/registry.ts";

export function StructurePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (structure: Structure) => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Select your structure">
      <p className="mb-4 text-[13px] leading-relaxed text-muted">A section is a full-width container. Pick how many columns it starts with; you can change the widths by dragging the line between columns, and add more from the Elements panel.</p>
      <div className="grid grid-cols-3 gap-3" data-testid="structure-picker">
        {STRUCTURES.map((structure) => (
          <button
            key={structure.id}
            type="button"
            data-testid={`pick-structure-${structure.id}`}
            onClick={() => {
              onPick(structure);
              onClose();
            }}
            className="flex h-20 flex-col items-stretch justify-center gap-1 rounded-control border border-line bg-panel p-2.5 hover:border-accent hover:shadow-segment focus-visible:border-accent"
          >
            {Array.from({ length: structure.rows ?? 1 }, (_, row) => (
              <span key={row} className="flex flex-1 gap-1">
                {structure.columns.map((column, index) => (
                  <span key={index} className="rounded-[3px] bg-grey-soft" style={{ width: `${column}%` }} aria-hidden="true" />
                ))}
              </span>
            ))}
            <SrOnly>{structure.label}</SrOnly>
          </button>
        ))}
      </div>
    </Modal>
  );
}
