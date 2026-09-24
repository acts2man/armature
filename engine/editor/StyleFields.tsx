/**
 * The engine's own size fields for the Style tab: a value with a unit menu, and the
 * four-box padding / margin row. They look like the builder's controls (the same Row and
 * unit menu) but each box writes exactly one CSS declaration for its own side, and each
 * input carries a test id. Typing commits as you type; Enter blurs.
 */
import { clsx } from "clsx";
import { useId, useState } from "react";
import type { Size, Unit } from "../../shared/builder/index.ts";
import { Row, UnitMenu, controlInputClass } from "../../src/builder/controls/inputs.tsx";
import type { CustomContext, Path } from "../../src/builder/controls/types.ts";

function NumberBox({ id, value, unit, testId, ariaLabel, onChange, className }: { id?: string; value: number | undefined; unit: Unit; testId: string; ariaLabel: string; onChange: (value: number) => void; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (value === undefined ? "" : String(value));
  const step = unit === "em" || unit === "rem" || unit === "" ? 0.1 : 1;
  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) onChange(Math.round(parsed / step) * step);
  };
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      data-testid={testId}
      value={text}
      onFocus={() => setDraft(text)}
      onBlur={() => {
        setDraft(null);
        commit(text);
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        if (event.target.value.trim() !== "" && Number.isFinite(Number.parseFloat(event.target.value))) commit(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const next = Math.round(((value ?? 0) + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1)) / step) * step;
          setDraft(String(next));
          onChange(next);
        }
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      className={clsx(controlInputClass, "tabular-nums", className)}
    />
  );
}

/** One size (font size, say): a number and its unit. */
export function EngineSizeField({ context, path, label, units, testId }: { context: CustomContext; path: Path; label: string; units: Unit[]; testId: string }) {
  const id = useId();
  const value = context.read(path) as Size | undefined;
  const unit: Unit = value?.unit ?? units[0] ?? "px";
  const key = path.join(".");
  return (
    <Row label={label} htmlFor={id}>
      <div className="flex w-full items-center gap-1.5">
        <NumberBox id={id} value={value?.value} unit={unit} testId={testId} ariaLabel={label} onChange={(next) => context.write(path, { value: next, unit }, `Changed ${label.toLowerCase()}`, key)} className="min-w-0 flex-1" />
        <UnitMenu unit={unit} units={units} onChange={(next) => context.write(path, { value: value?.value ?? 0, unit: next }, `Changed ${label.toLowerCase()} unit`, key)} />
      </div>
    </Row>
  );
}

const SIDES = ["top", "right", "bottom", "left"] as const;
const SIDE_LABELS = { top: "Top", right: "Right", bottom: "Bottom", left: "Left" };

/** Padding or margin as four boxes; each box writes its own side only. */
export function EngineSidesField({ context, property, label, units }: { context: CustomContext; property: "padding" | "margin"; label: string; units: Unit[] }) {
  const sides = SIDES.map((side) => ({ side, value: context.read([property, side]) as Size | undefined }));
  const [unit, setUnit] = useState<Unit>(() => sides.find((entry) => entry.value)?.value?.unit ?? units[0] ?? "px");
  return (
    <Row label={label} stacked end={<UnitMenu unit={unit} units={units} onChange={setUnit} />}>
      <div className="grid grid-cols-4 gap-1">
        {sides.map(({ side, value }) => (
          <div key={side} className="flex flex-col-reverse items-stretch gap-0.5 text-center">
            <span className="text-[10px] font-medium text-muted">{SIDE_LABELS[side]}</span>
            <NumberBox value={value?.unit === unit ? value.value : value?.value} unit={unit} testId={`engine-style-${property}-${side}`} ariaLabel={`${label} ${side}`} onChange={(next) => context.write([property, side], { value: next, unit }, `Changed ${label.toLowerCase()} ${side}`, `${property}.${side}`)} />
          </div>
        ))}
      </div>
    </Row>
  );
}
