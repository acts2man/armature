/**
 * The primitive inputs every control is made of: a number with up/down buttons that step
 * (Shift = 10 steps, hold to repeat), the same on the arrow keys, a label that scrubs when
 * dragged, a size with a unit menu that also accepts typed values like "2rem", a colour
 * with the kit's swatches, a picker, opacity and the global link, and the per-device
 * switch with its override dot. One hold, one key-repeat run or one scrub is one undo
 * step: every change it makes carries the same run token (see `stepGroup`).
 */
import { clsx } from "clsx";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconChevronDown, IconChevronUp, IconDesktop, IconGlobe, IconPencil, IconPhone, IconTablet, IconX } from "@/components/icons.tsx";
import type { Device, Size, SiteKit, Unit } from "@shared/builder/index.ts";
import { isColorLiteral, parseKitRef, parseSize, resolveKitColor, sizeToCss } from "@kit/values.ts";

// --- labels and rows ---------------------------------------------------------------------------

/**
 * One control row, Elementor style: the label on the left (with the device icon right
 * after it on a responsive control), the control on the right. `stacked` puts the control
 * under the label for wide controls (a textarea, four spacing boxes); `end` sits at the
 * far right of the label line (a unit menu, a link toggle).
 */
export function Row({ label, children, htmlFor, hint, right, end, stacked, className }: { label: ReactNode; children: ReactNode; htmlFor?: string; hint?: string; /** Right after the label: the device icon. */ right?: ReactNode; /** At the far right of the label line. */ end?: ReactNode; stacked?: boolean; className?: string }) {
  const head = (
    <div className={clsx("flex min-h-5 items-center gap-1", stacked ? "justify-between" : "w-[104px] shrink-0")}>
      <span className="flex min-w-0 items-center gap-1">
        <label htmlFor={htmlFor} className="truncate text-[12px] font-medium text-muted" title={typeof label === "string" ? label : undefined}>
          {label}
        </label>
        {right && <span className="flex shrink-0 items-center gap-0.5">{right}</span>}
      </span>
      {stacked && end && <span className="flex shrink-0 items-center gap-1">{end}</span>}
    </div>
  );
  return (
    <div className={clsx("flex flex-col gap-1.5", className)} data-control-row={stacked ? "stacked" : "inline"}>
      {stacked ? (
        <>
          {head}
          {children}
        </>
      ) : (
        <div className="flex items-center gap-2">
          {head}
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
            {children}
            {end}
          </div>
        </div>
      )}
      {hint && <p className="text-[11px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

/** A small icon button on a control row (the pencil, the globe). */
export function RowButton({ label, active, onClick, children, testId, className }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; testId?: string; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onClick={onClick} data-testid={testId} className={clsx("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border", active ? "border-accent bg-blue-soft text-accent" : "border-line text-muted hover:border-muted/50 hover:text-text", className)}>
      {children}
    </button>
  );
}

/**
 * A floating panel under a control (Typography, a shadow, a colour): live edits, closes
 * on a click outside or Escape (the Escape never reaches the editor's own handler).
 */
export function Popover({ open, onClose, children, label, testId, className }: { open: boolean; onClose: () => void; children: ReactNode; label: string; testId?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} role="dialog" aria-label={label} data-testid={testId} className={clsx("toast-in absolute right-0 top-full z-30 mt-1 flex w-[300px] flex-col gap-3 rounded-[10px] border border-line bg-panel p-3 shadow-pop", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-bold text-text">{label}</span>
        <button type="button" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose} className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text">
          <IconX size={13} />
        </button>
      </div>
      {children}
    </div>
  );
}

/** The wrapper that a Popover positions against: a control row with its own popover(s). */
export function PopoverHost({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("relative", className)}>{children}</div>;
}

/** A pencil that opens a control's popover; filled when the value is set. */
export function PencilButton({ label, active, open, onClick, testId }: { label: string; active?: boolean; open?: boolean; onClick: () => void; testId?: string }) {
  return (
    <RowButton label={label} active={active || open} onClick={onClick} testId={testId}>
      <IconPencil size={13} />
    </RowButton>
  );
}

/** A globe that opens the global (site kit) picker; filled when the value is linked to the kit. */
export function GlobeButton({ label, linked, open, onClick, testId }: { label: string; linked?: boolean; open?: boolean; onClick: () => void; testId?: string }) {
  return (
    <RowButton label={label} active={linked || open} onClick={onClick} testId={testId}>
      <IconGlobe size={13} />
    </RowButton>
  );
}

/** The device icon on a responsive control: switches the whole editor; a dot means this device overrides. */
export function DeviceButton({ device, overridden, onDevice, onReset }: { device: Device; overridden: boolean; onDevice: (device: Device) => void; onReset: () => void }) {
  const Icon = device === "desktop" ? IconDesktop : device === "tablet" ? IconTablet : IconPhone;
  const next: Device = device === "desktop" ? "tablet" : device === "tablet" ? "mobile" : "desktop";
  return (
    <span className="relative inline-flex">
      <button type="button" aria-label={`Editing ${device}; switch to ${next}`} title={`Editing ${device} (click for ${next})`} onClick={() => onDevice(next)} className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text" data-testid="device-switch">
        <Icon size={13} />
      </button>
      {overridden && (
        <button type="button" aria-label={`Reset the ${device} override`} title={`${device} has its own value; click to reset`} onClick={onReset} className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent hover:scale-125" data-testid="override-dot" />
      )}
    </span>
  );
}

const inputClass = "h-8 w-full min-w-0 rounded-sm border border-line bg-panel px-2 text-[13px] text-text placeholder:text-muted/60 hover:border-muted/50 focus:border-accent";

// --- numbers ----------------------------------------------------------------------------------------

const round = (value: number, step: number) => {
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  return Number(value.toFixed(decimals));
};

/** The step for a unit: whole pixels and percents, tenths of an em, rem or unitless value. */
export const stepForUnit = (unit: Unit): number => (unit === "em" || unit === "rem" || unit === "" ? 0.1 : 1);

/** Holding a stepper button repeats after this long, then this often. */
export const HOLD_DELAY_MS = 350;
export const HOLD_REPEAT_MS = 50;

let runCounter = 0;
/** A token for one continuous run of changes (a hold, a key-repeat run, a scrub). */
export const newRun = (): string => `${Date.now().toString(36)}-${(runCounter++).toString(36)}`;

/**
 * The undo group for a change: a run (a hold, a key-repeat run, a scrub) merges into one
 * step however long it lasts and never with the next run; typing merges with typing on the
 * same path while it keeps coming (see history.ts).
 */
export const stepGroup = (path: string, run?: string): string => (run ? `drag:step:${path}:${run}` : path);

/**
 * Press-and-hold for a stepper button: one step on press, then repeats after a short delay
 * until the pointer lifts. Shift at the press means 10 steps each time. The press never
 * takes focus (the input keeps it, so Esc and the arrow keys still go where they went).
 */
export function useHold(onStep: (shift: boolean, run: string) => void, onEnd?: () => void) {
  const timers = useRef<{ timeout: number; interval: number | null } | null>(null);
  // The repeat timer always calls the latest handler, never the one from the press's render.
  const handlers = useRef({ onStep, onEnd });
  useEffect(() => {
    handlers.current = { onStep, onEnd };
  }, [onStep, onEnd]);
  const stop = useCallback(() => {
    if (!timers.current) return;
    window.clearTimeout(timers.current.timeout);
    if (timers.current.interval !== null) window.clearInterval(timers.current.interval);
    timers.current = null;
    handlers.current.onEnd?.();
  }, []);
  useEffect(() => stop, [stop]);
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stop();
    const run = newRun();
    const shift = event.shiftKey;
    handlers.current.onStep(shift, run);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const timeout = window.setTimeout(() => {
      if (!timers.current) return;
      timers.current.interval = window.setInterval(() => handlers.current.onStep(shift, run), HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
    timers.current = { timeout, interval: null };
  };
  return { onPointerDown, onPointerUp: stop, onPointerCancel: stop, onLostPointerCapture: stop, onMouseDown: (event: React.MouseEvent) => event.preventDefault() };
}

/** The accessible name is just "Increase" / "Decrease" (the field's own label names the field); the title says which. */
function StepButton({ direction, field, onStep, onEnd, testId }: { direction: 1 | -1; field?: string; onStep: (direction: 1 | -1, shift: boolean, run: string) => void; onEnd?: () => void; testId: string }) {
  const hold = useHold((shift, run) => onStep(direction, shift, run), onEnd);
  const verb = direction === 1 ? "Increase" : "Decrease";
  return (
    <button type="button" tabIndex={-1} aria-label={verb} title={`${verb}${field ? ` ${field}` : ""} (Shift for 10, hold to repeat)`} data-testid={testId} {...hold} className="flex flex-1 items-center justify-center text-muted hover:bg-ground hover:text-text active:bg-blue-soft active:text-accent">
      {direction === 1 ? <IconChevronUp size={10} /> : <IconChevronDown size={10} />}
    </button>
  );
}

/** The up/down pair beside a number: click to step, Shift for 10 steps, hold to repeat. */
export function StepButtons({ onStep, onEnd, label }: { onStep: (direction: 1 | -1, shift: boolean, run: string) => void; onEnd?: () => void; label?: string }) {
  return (
    <span className="flex h-8 w-4 shrink-0 flex-col divide-y divide-line overflow-hidden rounded-sm border border-line bg-panel" data-testid="steppers">
      <StepButton direction={1} field={label} onStep={onStep} onEnd={onEnd} testId="step-up" />
      <StepButton direction={-1} field={label} onStep={onStep} onEnd={onEnd} testId="step-down" />
    </span>
  );
}

/**
 * A number input with up/down buttons. Click a button to step, Shift for 10 steps, hold to
 * repeat; the arrow keys do the same (Shift too); drag the label sideways to scrub; or type.
 * `inherited` shows a greyed value that comes from another device. `onChange` receives the
 * run token of a hold, a key-repeat run or a scrub, so the caller can make it one undo step.
 */
export function NumberInput({
  id,
  value,
  inherited,
  onChange,
  onCommit,
  min = -Infinity,
  max = Infinity,
  step = 1,
  placeholder,
  className,
  suffix,
  label,
  ariaLabel,
  steppers = true,
  testId,
}: {
  ariaLabel?: string;
  id?: string;
  /** Goes on the text field itself. */
  testId?: string;
  value: number | undefined;
  inherited?: number;
  onChange: (value: number, run?: string) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  suffix?: ReactNode;
  /** When given, the label itself scrubs. */
  label?: ReactNode;
  /** The up/down buttons (on unless the control has its own). */
  steppers?: boolean;
}) {
  // While the field has focus it shows what is typed; otherwise it shows the value.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (value === undefined ? "" : String(value));
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) onChange(round(clamp(parsed), step));
  };
  // A hold repeats from a timer, so it steps from the last value it wrote, not a stale render.
  const latest = useRef({ value, inherited });
  useEffect(() => {
    latest.current = { value, inherited };
  }, [value, inherited]);
  const stepBy = (direction: 1 | -1, shift: boolean, run: string) => {
    const base = latest.current.value ?? latest.current.inherited ?? 0;
    const next = round(clamp(base + direction * step * (shift ? 10 : 1)), step);
    latest.current = { ...latest.current, value: next };
    setDraft((current) => (current === null ? null : String(next)));
    onChange(next, run);
  };
  const keyRun = useRef<string | null>(null);
  const scrub = useRef<{ startX: number; start: number; run: string } | null>(null);
  const onScrubDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const start = value ?? inherited ?? 0;
    scrub.current = { startX: event.clientX, start, run: newRun() };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    document.body.style.cursor = "ew-resize";
  };
  const onScrubMove = (event: React.PointerEvent) => {
    if (!scrub.current) return;
    const delta = (event.clientX - scrub.current.startX) * (event.shiftKey ? 10 : 1) * step * 0.5;
    onChange(round(clamp(scrub.current.start + delta), step), scrub.current.run);
  };
  const onScrubUp = () => {
    if (!scrub.current) return;
    scrub.current = null;
    document.body.style.cursor = "";
    onCommit?.();
  };
  const name = ariaLabel ?? (typeof label === "string" ? label : undefined);
  return (
    <div className={clsx("flex items-center gap-1.5", className)} data-testid="number-input">
      {label !== undefined && (
        <span
          role="presentation"
          title="Drag to change (Shift for x10)"
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          className="shrink-0 cursor-ew-resize select-none text-[11px] font-medium text-muted"
          data-testid="scrub-label"
        >
          {label}
        </span>
      )}
      <span className="flex min-w-0 flex-1 items-center gap-0.5">
        <input
          id={id}
          aria-label={ariaLabel}
          data-testid={testId}
          type="text"
          inputMode="decimal"
          value={text}
          placeholder={placeholder ?? (inherited !== undefined ? String(inherited) : undefined)}
          onFocus={() => setDraft(text)}
          onBlur={() => {
            setDraft(null);
            commit(text);
            onCommit?.();
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            if (event.target.value.trim() !== "" && Number.isFinite(Number.parseFloat(event.target.value))) commit(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              // A key held down is one run (the browser repeats the keydown); each new press is a new one.
              if (!event.repeat || !keyRun.current) keyRun.current = newRun();
              stepBy(event.key === "ArrowUp" ? 1 : -1, event.shiftKey, keyRun.current);
            }
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
          onKeyUp={(event) => {
            if ((event.key === "ArrowUp" || event.key === "ArrowDown") && keyRun.current) {
              keyRun.current = null;
              onCommit?.();
            }
          }}
          className={clsx(inputClass, "tabular-nums", value === undefined && inherited !== undefined && "text-muted")}
        />
        {steppers && <StepButtons onStep={stepBy} onEnd={onCommit} label={name} />}
      </span>
      {suffix}
    </div>
  );
}

// --- sizes ---------------------------------------------------------------------------------------------

export function UnitMenu({ unit, units, onChange, id }: { unit: Unit; units: Unit[]; onChange: (unit: Unit) => void; id?: string }) {
  return (
    <select id={id} aria-label="Unit" value={unit} onChange={(event) => onChange(event.target.value as Unit)} className="h-8 shrink-0 rounded-sm border border-line bg-ground px-1 text-[11px] font-semibold text-muted hover:text-text">
      {units.map((option) => (
        <option key={option || "unitless"} value={option}>
          {option === "" ? "—" : option === "auto" ? "auto" : option}
        </option>
      ))}
    </select>
  );
}

/** A value with a unit. Typing "2rem" switches the unit; the label scrubs; the buttons step by the unit (1px, 0.1em). */
export function SizeInput({
  id,
  value,
  inherited,
  units,
  onChange,
  onCommit,
  label,
  min,
  max,
  allowAuto,
  allowScreen,
  screen,
  onScreen,
}: {
  id?: string;
  value: Size | undefined;
  inherited?: Size;
  units: Unit[];
  onChange: (value: Size | undefined, run?: string) => void;
  onCommit?: () => void;
  label?: ReactNode;
  min?: number;
  max?: number;
  allowAuto?: boolean;
  /** "Fit to screen" for min-height. */
  allowScreen?: boolean;
  screen?: boolean;
  onScreen?: (on: boolean) => void;
}) {
  const shown = value ?? inherited;
  const unit: Unit = shown?.unit ?? units[0] ?? "px";
  const list = allowAuto && !units.includes("auto") ? [...units, "auto" as Unit] : units;
  const inputId = useId();
  return (
    <div className="flex items-center gap-1.5">
      {screen ? (
        <span className="flex h-8 flex-1 items-center rounded-sm border border-line bg-ground px-2 text-[12px] text-muted">Fits the screen</span>
      ) : unit === "auto" ? (
        <span className="flex h-8 flex-1 items-center rounded-sm border border-line bg-ground px-2 text-[12px] text-muted">auto</span>
      ) : (
        <NumberInput
          id={id ?? inputId}
          label={label}
          value={value?.value}
          inherited={inherited?.value}
          min={min}
          max={max}
          step={stepForUnit(unit)}
          onChange={(next, run) => onChange({ value: next, unit }, run)}
          onCommit={onCommit}
          className="min-w-0 flex-1"
        />
      )}
      {!screen && (
        <UnitMenu
          unit={unit}
          units={list}
          onChange={(next) => {
            if (next === "auto") onChange({ value: 0, unit: "auto" });
            else onChange({ value: unit === "auto" ? 0 : (shown?.value ?? 0), unit: next });
          }}
        />
      )}
      {allowScreen && (
        <button type="button" aria-pressed={!!screen} title="Fit to screen height" onClick={() => onScreen?.(!screen)} className={clsx("inline-flex h-8 shrink-0 items-center rounded-sm border px-1.5 text-[11px] font-semibold", screen ? "border-accent bg-blue-soft text-accent" : "border-line text-muted hover:text-text")}>
          Screen
        </button>
      )}
    </div>
  );
}

/** Parse a typed size such as "2rem" or "50%" for controls that accept free text. */
export const parseTypedSize = (text: string, fallback: Unit): Size | null => parseSize(text, fallback);
export const sizeText = (size: Size | undefined): string => sizeToCss(size) ?? "";

// --- colours -------------------------------------------------------------------------------------------

const KIT_COLORS: { key: string; label: string; ref: string }[] = [
  { key: "primary", label: "Primary", ref: "kit:color.primary" },
  { key: "secondary", label: "Secondary", ref: "kit:color.secondary" },
  { key: "text", label: "Text", ref: "kit:color.text" },
  { key: "accent", label: "Accent", ref: "kit:color.accent" },
];

function hexParts(color: string): { hex: string; alpha: number } {
  const trimmed = color.trim();
  const match = /^#([0-9a-f]{3,8})$/i.exec(trimmed);
  if (!match) return { hex: "#000000", alpha: 1 };
  let digits = match[1] ?? "";
  if (digits.length === 3 || digits.length === 4) digits = digits.split("").map((d) => d + d).join("");
  const hex = `#${digits.slice(0, 6)}`;
  const alpha = digits.length === 8 ? Number.parseInt(digits.slice(6, 8), 16) / 255 : 1;
  return { hex: hex.toLowerCase(), alpha };
}

const withAlpha = (hex: string, alpha: number): string => (alpha >= 0.995 ? hex : `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`);

/**
 * A colour: kit swatches (the globe marks a linked value), the browser's picker, opacity,
 * and Unlink to copy the kit value into the element.
 */
export function ColorInput({ id, value, inherited, kit, onChange, onCommit, allowClear = true, siteColors = true }: { id?: string; value: string | undefined; inherited?: string; kit: SiteKit; onChange: (value: string | undefined) => void; onCommit?: () => void; allowClear?: boolean; /** Offer the kit's colours as swatches (not when editing the kit's own colours). */ siteColors?: boolean }) {
  const shown = value ?? inherited;
  const ref = parseKitRef(shown);
  const literal = ref ? (resolveKitColor(kit, shown) ?? "#000000") : (shown ?? "");
  const { hex, alpha } = hexParts(isColorLiteral(literal) && literal.startsWith("#") ? literal : "#000000");
  const isTransparent = shown === "transparent";
  const swatches = !siteColors ? [] : [...KIT_COLORS, ...kit.colors.custom.map((color) => ({ key: color.id, label: color.label, ref: `kit:color.custom.${color.id}` }))];
  const inputId = useId();
  return (
    <div className="flex flex-col gap-2" data-testid="color-control">
      <div className="flex flex-wrap items-center gap-1.5">
        {swatches.map((swatch) => {
          const swatchColor = resolveKitColor(kit, swatch.ref) ?? "#000000";
          const active = shown === swatch.ref;
          return (
            <button
              key={swatch.key}
              type="button"
              title={`${swatch.label} (site colour)`}
              aria-label={`Use the site colour ${swatch.label}`}
              aria-pressed={active}
              onClick={() => {
                onChange(swatch.ref);
                onCommit?.();
              }}
              className={clsx("relative h-6 w-6 rounded-full border border-line", active && "ring-2 ring-accent ring-offset-1")}
              style={{ background: swatchColor }}
              data-testid={`swatch-${swatch.key}`}
            >
              {active && <IconGlobe size={10} className="absolute -bottom-1 -right-1 rounded-full bg-panel text-accent" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-1.5">
        <label className="relative inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-line" title="Pick a colour" style={{ background: isTransparent ? "repeating-conic-gradient(#e6eaee 0 25%, #fff 0 50%) 0 0/8px 8px" : (shown ? literal : "#ffffff") }}>
          <input
            id={id ?? inputId}
            type="color"
            aria-label="Pick a colour"
            value={hex}
            onChange={(event) => onChange(withAlpha(event.target.value, alpha))}
            onBlur={() => onCommit?.()}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <input
          type="text"
          aria-label="Colour value"
          value={ref ? `${ref.name === "custom" ? ref.sub : ref.name} (site)` : (shown ?? "")}
          readOnly={!!ref}
          placeholder={inherited === undefined ? "none" : undefined}
          onChange={(event) => {
            const next = event.target.value.trim();
            if (next === "" || isColorLiteral(next)) onChange(next === "" ? undefined : next);
          }}
          onBlur={() => onCommit?.()}
          className={clsx(inputClass, "flex-1 font-mono text-[12px]", ref && "text-accent")}
          data-testid="color-text"
        />
        {ref ? (
          <button
            type="button"
            title="Unlink from the site colour (keep this exact colour)"
            aria-label="Unlink from the site colour"
            onClick={() => {
              onChange(literal);
              onCommit?.();
            }}
            className="inline-flex h-8 items-center gap-1 rounded-sm border border-line px-1.5 text-[11px] font-semibold text-accent hover:bg-ground"
            data-testid="unlink-color"
          >
            <IconGlobe size={12} /> Unlink
          </button>
        ) : (
          <button
            type="button"
            title="Transparent"
            aria-label="Transparent"
            aria-pressed={isTransparent}
            onClick={() => {
              onChange("transparent");
              onCommit?.();
            }}
            className={clsx("h-8 w-8 shrink-0 rounded-sm border border-line", isTransparent && "ring-2 ring-accent")}
            style={{ background: "repeating-conic-gradient(#e6eaee 0 25%, #fff 0 50%) 0 0/8px 8px" }}
          />
        )}
        {allowClear && value !== undefined && (
          <button type="button" title="Clear" aria-label="Clear the colour" onClick={() => { onChange(undefined); onCommit?.(); }} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text">
            <IconX size={14} />
          </button>
        )}
      </div>
      {!ref && shown && shown.startsWith("#") && (
        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="shrink-0">Opacity</span>
          <input type="range" min={0} max={100} value={Math.round(alpha * 100)} onChange={(event) => onChange(withAlpha(hex, Number(event.target.value) / 100))} onMouseUp={() => onCommit?.()} onKeyUp={() => onCommit?.()} className="h-1 min-w-0 flex-1 accent-[var(--accent)]" aria-label="Opacity slider" />
          <NumberInput ariaLabel="Opacity" value={Math.round(alpha * 100)} min={0} max={100} step={1} onChange={(next) => onChange(withAlpha(hex, next / 100))} onCommit={onCommit} className="w-[76px] shrink-0" suffix={<span className="text-[11px] text-muted">%</span>} />
        </div>
      )}
    </div>
  );
}

/** The swatch on a colour row: shows the colour (a globe when linked to the kit) and opens the picker. */
export function ColorSwatch({ value, kit, open, onClick, label, testId = "color-swatch" }: { value: string | undefined; kit: SiteKit; open: boolean; onClick: () => void; label: string; testId?: string }) {
  const ref = parseKitRef(value);
  const literal = ref ? resolveKitColor(kit, value) : value;
  const transparent = value === "transparent";
  const name = ref ? `${ref.name === "custom" ? ref.sub : ref.name} (site colour)` : (value ?? "not set");
  return (
    <button
      type="button"
      aria-label={`${label}: ${name}`}
      title={name}
      aria-expanded={open}
      onClick={onClick}
      data-testid={testId}
      data-value={value ?? ""}
      className={clsx("relative inline-flex h-7 w-9 shrink-0 items-center justify-center rounded-sm border", open ? "border-accent" : "border-line hover:border-muted/50")}
      style={{ background: transparent || !literal ? "repeating-conic-gradient(#e6eaee 0 25%, #fff 0 50%) 0 0/8px 8px" : literal }}
    >
      {!value && <IconX size={12} className="text-muted" />}
      {ref && <IconGlobe size={11} className="absolute -bottom-1 -right-1 rounded-full bg-panel text-accent" />}
    </button>
  );
}

/** The kit's colours as a list, for the globe on a colour control. */
export function GlobalColorList({ value, kit, onPick }: { value: string | undefined; kit: SiteKit; onPick: (ref: string) => void }) {
  const swatches = [...KIT_COLORS, ...kit.colors.custom.map((color) => ({ key: color.id, label: color.label, ref: `kit:color.custom.${color.id}` }))];
  return (
    <ul role="listbox" aria-label="Global colours" className="flex flex-col gap-0.5" data-testid="global-colours">
      {swatches.map((swatch) => {
        const color = resolveKitColor(kit, swatch.ref) ?? "#000000";
        const active = value === swatch.ref;
        return (
          <li key={swatch.key}>
            <button type="button" role="option" aria-selected={active} onClick={() => onPick(swatch.ref)} data-testid={`global-colour-${swatch.key}`} className={clsx("flex h-8 w-full items-center gap-2 rounded-sm px-1.5 text-left text-[12px] hover:bg-ground", active && "bg-blue-soft text-accent")}>
              <span className="h-5 w-5 shrink-0 rounded-full border border-line" style={{ background: color }} aria-hidden="true" />
              <span className="flex-1 truncate">{swatch.label}</span>
              <span className="font-mono text-[11px] text-muted">{color}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// --- segmented choices ---------------------------------------------------------------------------------------

export function Choice<T extends string>({ value, options, onChange, label, allowNone }: { value: T | undefined; options: { value: T; label: ReactNode; title?: string }[]; onChange: (next: T | undefined) => void; label: string; allowNone?: boolean }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-control bg-ground p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            title={option.title}
            aria-pressed={active}
            onClick={() => onChange(active && allowNone ? undefined : option.value)}
            className={clsx("h-7 min-w-7 flex-1 rounded-sm px-1.5 text-[12px] font-semibold", active ? "bg-panel text-text shadow-segment" : "text-muted hover:text-text")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export const controlInputClass = inputClass;
