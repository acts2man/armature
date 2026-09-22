/**
 * The primitive inputs every control is made of: a number that scrubs when its label
 * is dragged (Shift = x10) and steps with the arrow keys, a size with a unit menu that
 * also accepts typed values like "2rem", a colour with the kit's swatches, a picker,
 * opacity and the global link, and the per-device switch with its override dot.
 */
import { clsx } from "clsx";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconDesktop, IconGlobe, IconPhone, IconTablet, IconX } from "@/components/icons.tsx";
import type { Device, Size, SiteKit, Unit } from "@shared/builder/index.ts";
import { isColorLiteral, parseKitRef, parseSize, resolveKitColor, sizeToCss } from "@kit/values.ts";

// --- labels and rows ---------------------------------------------------------------------------

export function Row({ label, children, htmlFor, hint, right, className }: { label: ReactNode; children: ReactNode; htmlFor?: string; hint?: string; right?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-muted">
          {label}
        </label>
        {right && <span className="flex items-center gap-0.5">{right}</span>}
      </div>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted">{hint}</p>}
    </div>
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

/**
 * A number input. Drag the label sideways to scrub (Shift = x10), use the arrow keys
 * (Shift = x10), or type. `inherited` shows a greyed value that comes from another device.
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
}: {
  id?: string;
  value: number | undefined;
  inherited?: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  className?: string;
  suffix?: ReactNode;
  /** When given, the label itself scrubs. */
  label?: ReactNode;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value === undefined ? "" : String(value));
  }, [value, focused]);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) onChange(round(clamp(parsed), step));
  };
  const scrub = useRef<{ startX: number; start: number } | null>(null);
  const onScrubDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const start = value ?? inherited ?? 0;
    scrub.current = { startX: event.clientX, start };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    document.body.style.cursor = "ew-resize";
  };
  const onScrubMove = (event: React.PointerEvent) => {
    if (!scrub.current) return;
    const delta = (event.clientX - scrub.current.startX) * (event.shiftKey ? 10 : 1) * step * 0.5;
    onChange(round(clamp(scrub.current.start + delta), step));
  };
  const onScrubUp = () => {
    if (!scrub.current) return;
    scrub.current = null;
    document.body.style.cursor = "";
    onCommit?.();
  };
  return (
    <div className={clsx("flex items-center gap-1.5", className)}>
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
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder ?? (inherited !== undefined ? String(inherited) : undefined)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit(text);
          onCommit?.();
        }}
        onChange={(event) => {
          setText(event.target.value);
          if (event.target.value.trim() !== "" && Number.isFinite(Number.parseFloat(event.target.value))) commit(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            const base = value ?? inherited ?? 0;
            const next = round(clamp(base + (event.key === "ArrowUp" ? 1 : -1) * step * (event.shiftKey ? 10 : 1)), step);
            setText(String(next));
            onChange(next);
          }
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
        className={clsx(inputClass, "tabular-nums", value === undefined && inherited !== undefined && "text-muted")}
      />
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

/** A value with a unit. Typing "2rem" switches the unit; the label scrubs. */
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
  onChange: (value: Size | undefined) => void;
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
  const stepFor = (u: Unit) => (u === "em" || u === "rem" || u === "" ? 0.1 : 1);
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
          step={stepFor(unit)}
          onChange={(next) => onChange({ value: next, unit })}
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
export function ColorInput({ id, value, inherited, kit, onChange, onCommit, allowClear = true }: { id?: string; value: string | undefined; inherited?: string; kit: SiteKit; onChange: (value: string | undefined) => void; onCommit?: () => void; allowClear?: boolean }) {
  const shown = value ?? inherited;
  const ref = parseKitRef(shown);
  const literal = ref ? (resolveKitColor(kit, shown) ?? "#000000") : (shown ?? "");
  const { hex, alpha } = hexParts(isColorLiteral(literal) && literal.startsWith("#") ? literal : "#000000");
  const isTransparent = shown === "transparent";
  const swatches = [...KIT_COLORS, ...kit.colors.custom.map((color) => ({ key: color.id, label: color.label, ref: `kit:color.custom.${color.id}` }))];
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
        <label className="flex items-center gap-2 text-[11px] text-muted">
          Opacity
          <input type="range" min={0} max={100} value={Math.round(alpha * 100)} onChange={(event) => onChange(withAlpha(hex, Number(event.target.value) / 100))} onMouseUp={() => onCommit?.()} onKeyUp={() => onCommit?.()} className="h-1 flex-1 accent-[var(--accent)]" aria-label="Opacity" />
          <span className="w-8 text-right tabular-nums">{Math.round(alpha * 100)}%</span>
        </label>
      )}
    </div>
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
