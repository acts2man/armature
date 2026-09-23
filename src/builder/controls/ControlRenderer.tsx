/**
 * Renders a list of control specs against a target (an element or the site kit), one row
 * per control: the label on the left with the device icon right after it on a responsive
 * control (click: switch the whole editor's device; a dot means the current device
 * overrides, click: reset it), the control on the right. Typography, shadows, the text
 * stroke, the border and colours are one row each: a globe links to the site kit, a
 * pencil (or the swatch) opens a popover that edits live and closes on a click outside.
 * Every change is one named command; continuous typing and scrubbing on one control
 * merge into one undo step.
 */
import { clsx } from "clsx";
import { createContext, useContext, useId, useState, type ReactNode } from "react";
import * as icons from "@/components/icons.tsx";
import { Toggle } from "@/components/ui.tsx";
import { hasOverride, own, resolve, setAt, type Background, type BackgroundOverlay, type Border, type Corners, type Device, type Gap, type IconValue, type Shadow, type Sides, type Size, type SiteKit, type TextStroke, type Typography, type Unit } from "@shared/builder/index.ts";
import { isAllowedHref, isAllowedMediaSrc } from "@shared/builder/schema.ts";
import { parseKitRef, resolveKitFont, sizeToCss } from "@kit/values.ts";
import { FontPicker } from "./FontPicker.tsx";
import { IconPicker } from "./IconPicker.tsx";
import { Choice, ColorInput, ColorSwatch, controlInputClass, DeviceButton, GlobalColorList, GlobeButton, NumberInput, PencilButton, Popover, PopoverHost, Row, SizeInput, UnitMenu } from "./inputs.tsx";
import { FONT_UNITS, LETTER_UNITS, LINE_HEIGHT_UNITS, PX_UNITS, SPACING_UNITS, type ControlSpec, type Path } from "./types.ts";
import { thumbnailUrl } from "../media.ts";

export type ControlTarget = {
  read: (path: Path) => unknown;
  /** `group` merges continuous changes into one undo step. */
  write: (path: Path, value: unknown, label: string, group?: string) => void;
  device: Device;
  onDevice: (device: Device) => void;
  kit: SiteKit;
  isStaff: boolean;
  /** Extra actions a control may need (the media library, editing on the page, a structure preset). */
  actions?: { pickImage?: (onPick: (src: string, alt: string) => void) => void; editOnPage?: () => void; applyStructure?: (structureId: string) => void };
  /** The live site's address, so a picture path (/assets/...) can be previewed. */
  siteUrl?: string | null;
};

const key = (path: Path) => path.join(".");
const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** True inside a popover: colours render their full picker in place instead of another popover. */
const InPopover = createContext(false);

/** Reads and writes for one control, responsive or not. */
function useValue<T>(target: ControlTarget, path: Path, responsive: boolean | undefined, fallback?: T) {
  const raw = target.read(path) as T | { desktop: T; tablet?: T; mobile?: T } | undefined;
  if (!responsive) {
    return {
      value: raw as T | undefined,
      inherited: raw === undefined ? fallback : undefined,
      overridden: false,
      set: (next: T | undefined, name: string, group?: string) => target.write(path, next, name, group),
      reset: () => target.write(path, undefined, "Reset"),
    };
  }
  const value = own<T>(raw, target.device);
  const inherited = value === undefined ? (resolve<T>(raw, target.device) ?? fallback) : undefined;
  return {
    value,
    inherited,
    overridden: hasOverride<T>(raw, target.device),
    set: (next: T | undefined, name: string, group?: string) => target.write(path, setAt<T>(raw, target.device, next), name, group),
    reset: () => target.write(path, setAt<T>(raw, target.device, undefined), "Reset the override"),
  };
}

function Responsive({ target, spec, children, hint, htmlFor, stacked, end }: { target: ControlTarget; spec: { label: string; path: Path; responsive?: boolean }; children: ReactNode; hint?: string; htmlFor?: string; stacked?: boolean; end?: ReactNode }) {
  const raw = target.read(spec.path);
  const overridden = spec.responsive ? hasOverride(raw as never, target.device) : false;
  return (
    <Row
      label={spec.label}
      htmlFor={htmlFor}
      hint={hint}
      stacked={stacked}
      end={end}
      right={spec.responsive ? <DeviceButton device={target.device} overridden={overridden} onDevice={target.onDevice} onReset={() => target.write(spec.path, setAt(raw as never, target.device, undefined), "Reset the override")} /> : undefined}
    >
      {children}
    </Row>
  );
}

// --- simple controls -----------------------------------------------------------------------------------

function TextControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "text" }> }) {
  const id = useId();
  const value = (target.read(spec.path) as string | undefined) ?? "";
  const set = (next: string) => target.write(spec.path, next === "" ? undefined : next, `Changed ${spec.label.toLowerCase()}`, key(spec.path));
  return (
    <Row label={spec.label} htmlFor={id} hint={spec.hint} stacked={spec.multiline}>
      {spec.multiline ? (
        <textarea id={id} value={value} maxLength={spec.max} placeholder={spec.placeholder} onChange={(event) => set(event.target.value)} className={clsx(controlInputClass, "min-h-20 py-1.5 leading-relaxed")} />
      ) : (
        <input id={id} type={spec.inputType ?? "text"} value={spec.inputType === "datetime-local" ? value.slice(0, 16) : value} maxLength={spec.max} placeholder={spec.placeholder} onChange={(event) => set(event.target.value)} className={controlInputClass} />
      )}
    </Row>
  );
}

const CUSTOM_OPTION = "__custom__";

function SelectControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "select" }> }) {
  const id = useId();
  const { value, inherited, set } = useValue<string | number>(target, spec.path, spec.responsive, spec.fallback);
  const parse = (raw: string): string | number | undefined => {
    if (raw === "") return undefined;
    if (spec.numeric && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  };
  // A value outside the list (a variable font weight such as 650) shows in the custom entry.
  const shown = value ?? inherited;
  const listed = shown === undefined || spec.options.some((option) => option.value === String(shown));
  const [customOpen, setCustomOpen] = useState(false);
  const customMode = !!spec.custom && (customOpen || !listed);
  const [customText, setCustomText] = useState(() => (shown !== undefined && !listed ? String(shown) : ""));
  return (
    <Responsive target={target} spec={spec} htmlFor={id} hint={spec.hint}>
      <div className="flex w-full items-center gap-1">
        <select
          id={id}
          value={customMode ? CUSTOM_OPTION : String(shown ?? "")}
          onChange={(event) => {
            if (event.target.value === CUSTOM_OPTION) {
              setCustomOpen(true);
              setCustomText(shown !== undefined ? String(shown) : "");
              return;
            }
            setCustomOpen(false);
            const next = parse(event.target.value);
            if (next === undefined && spec.clearPath) target.write(spec.clearPath, undefined, `Reset ${spec.label.toLowerCase()}`);
            else set(next, `Changed ${spec.label.toLowerCase()}`);
          }}
          className={clsx(controlInputClass, customMode && "w-1/2", value === undefined && inherited !== undefined && "text-muted")}
        >
          {!spec.required && !spec.options.some((option) => option.value === "") && <option value="">Default</option>}
          {spec.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {spec.custom && <option value={CUSTOM_OPTION}>Custom…</option>}
        </select>
        {customMode && spec.custom && (
          <input
            type="number"
            aria-label={`Custom ${spec.label.toLowerCase()}`}
            data-testid={`custom-${spec.label.toLowerCase().replace(/\s+/g, "-")}`}
            min={spec.custom.min}
            max={spec.custom.max}
            step={spec.custom.step ?? 1}
            value={customText}
            placeholder={`${spec.custom.min}–${spec.custom.max}`}
            onChange={(event) => {
              setCustomText(event.target.value);
              const number = Number(event.target.value);
              if (event.target.value !== "" && Number.isFinite(number) && number >= spec.custom!.min && number <= spec.custom!.max) set(number, `Changed ${spec.label.toLowerCase()}`, `custom:${spec.path.join(".")}`);
            }}
            className={clsx(controlInputClass, "w-1/2")}
          />
        )}
      </div>
    </Responsive>
  );
}

function ChoiceControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "choice" }> }) {
  const { value, inherited, set } = useValue<string>(target, spec.path, spec.responsive);
  const iconFor = (name: string | undefined) => {
    if (!name) return null;
    const Component = (icons as unknown as Record<string, React.ComponentType<{ size?: number }> | undefined>)[`Icon${name}`];
    return Component ? <Component size={14} /> : null;
  };
  return (
    <Responsive target={target} spec={spec}>
      <div className="w-full">
        <Choice label={spec.label} value={value === undefined && inherited === undefined ? undefined : String(value ?? inherited)} allowNone={spec.allowNone ?? true} options={spec.options.map((option) => ({ value: option.value, title: option.label, label: option.icon ? iconFor(option.icon) : option.label }))} onChange={(next) => set(spec.numeric && next !== undefined ? (Number(next) as never) : next, `Changed ${spec.label.toLowerCase()}`)} />
      </div>
    </Responsive>
  );
}

function ToggleControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "toggle" }> }) {
  const { value, inherited, set } = useValue<boolean>(target, spec.path, spec.responsive);
  const on = value ?? inherited ?? false;
  return (
    <Responsive target={target} spec={spec} hint={spec.hint}>
      <Toggle checked={on} onChange={(next) => set(next ? true : undefined, `${next ? "Turned on" : "Turned off"} ${spec.label.toLowerCase()}`)} label={spec.label} />
    </Responsive>
  );
}

function NumberControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "number" }> }) {
  const id = useId();
  const { value, inherited, set } = useValue<number>(target, spec.path, spec.responsive);
  return (
    <Responsive target={target} spec={spec} htmlFor={id} hint={spec.hint}>
      <NumberInput id={id} value={value} inherited={inherited} min={spec.min} max={spec.max} step={spec.step ?? 1} onChange={(next) => set(next, `Changed ${spec.label.toLowerCase()}`, key(spec.path))} className="w-full" />
    </Responsive>
  );
}

function SizeControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "size" }> }) {
  const id = useId();
  const { value, inherited, set } = useValue<Size | "screen">(target, spec.path, spec.responsive, spec.fallback);
  const isScreen = value === "screen" || (value === undefined && inherited === "screen");
  return (
    <Responsive target={target} spec={spec} htmlFor={id} hint={spec.hint}>
      <div className="w-full">
        <SizeInput
          id={id}
          value={value === "screen" ? undefined : value}
          inherited={inherited === "screen" ? undefined : inherited}
          units={spec.units ?? PX_UNITS}
          min={spec.min}
          max={spec.max}
          allowAuto
          allowScreen={spec.allowScreen}
          screen={isScreen}
          onScreen={(on) => set(on ? "screen" : undefined, `Changed ${spec.label.toLowerCase()}`)}
          onChange={(next) => set(next, `Changed ${spec.label.toLowerCase()}`, key(spec.path))}
        />
      </div>
    </Responsive>
  );
}

// --- sides, corners, gap ---------------------------------------------------------------------------------

const SIDES = ["top", "right", "bottom", "left"] as const;
const CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

/** Four boxes (margin, padding, radius) with the unit menu and the link toggle on the label line. */
function LinkedSizes<K extends string>({ target, spec, keys, labels }: { target: ControlTarget; spec: { label: string; path: Path; responsive?: boolean; units?: Unit[] }; keys: readonly K[]; labels: Record<K, string> }) {
  const { value, inherited, set } = useValue<Partial<Record<K, Size>>>(target, spec.path, spec.responsive);
  const shown: Partial<Record<K, Size>> = value ?? inherited ?? {};
  const [linked, setLinked] = useState(() => {
    const sizes = keys.map((k) => shown[k]).filter(Boolean) as Size[];
    return sizes.length === 0 || sizes.every((size) => size.value === sizes[0]?.value && size.unit === sizes[0]?.unit);
  });
  const units = spec.units ?? SPACING_UNITS;
  const unit: Unit = keys.map((k) => shown[k]?.unit).find((u): u is Unit => !!u) ?? units[0] ?? "px";
  const update = (which: K, next: Size) => {
    const base = { ...(value ?? inherited ?? {}) } as Partial<Record<K, Size>>;
    if (linked) for (const k of keys) base[k] = next;
    else base[which] = next;
    set(base, `Changed ${spec.label.toLowerCase()}`, key(spec.path));
  };
  return (
    <Responsive
      target={target}
      spec={spec}
      stacked
      end={
        <>
          <UnitMenu unit={unit} units={units} onChange={(next) => set(Object.fromEntries(keys.map((k) => [k, { value: shown[k]?.value ?? 0, unit: next }])) as Partial<Record<K, Size>>, `Changed ${spec.label.toLowerCase()} unit`)} />
          <button type="button" aria-pressed={linked} aria-label={linked ? `${spec.label} values are linked` : `${spec.label} values are unlinked`} title={linked ? "Linked: edit one to set all four" : "Unlinked: each side on its own"} onClick={() => setLinked((current) => !current)} className={clsx("inline-flex h-7 w-7 items-center justify-center rounded-sm border", linked ? "border-accent bg-blue-soft text-accent" : "border-line text-muted hover:text-text")} data-testid="link-sides">
            {linked ? <icons.IconLink size={12} /> : <icons.IconUnlock size={12} />}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-4 gap-1">
        {keys.map((k) => (
          <NumberInput key={k} label={labels[k]} ariaLabel={`${spec.label} ${labels[k].toLowerCase()}`} value={shown[k]?.value} inherited={value === undefined ? inherited?.[k]?.value : undefined} step={unit === "em" || unit === "rem" ? 0.1 : 1} onChange={(next) => update(k, { value: next, unit })} className="flex-col-reverse items-stretch gap-0.5 text-center" />
        ))}
      </div>
    </Responsive>
  );
}

const SidesControl = ({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "sides" }> }) => <LinkedSizes target={target} spec={spec} keys={SIDES} labels={{ top: "Top", right: "Right", bottom: "Bottom", left: "Left" }} />;
const CornersControl = ({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "corners" }> }) => <LinkedSizes target={target} spec={spec} keys={CORNERS} labels={{ topLeft: "TL", topRight: "TR", bottomRight: "BR", bottomLeft: "BL" }} />;

function GapControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "gap" }> }) {
  const { value, inherited, set } = useValue<Gap>(target, spec.path, spec.responsive);
  const shown = value ?? inherited ?? {};
  const update = (which: "column" | "row", next: Size | undefined) => set({ ...(value ?? inherited ?? {}), [which]: next }, `Changed ${spec.label.toLowerCase()}`, key(spec.path));
  return (
    <Responsive target={target} spec={spec} stacked>
      <div className="grid grid-cols-2 gap-2">
        <SizeInput label="Col" value={value?.column} inherited={value === undefined ? inherited?.column : shown.column} units={SPACING_UNITS} onChange={(next) => update("column", next)} />
        <SizeInput label="Row" value={value?.row} inherited={value === undefined ? inherited?.row : shown.row} units={SPACING_UNITS} onChange={(next) => update("row", next)} />
      </div>
    </Responsive>
  );
}

// --- colour, font, link, image, icon -----------------------------------------------------------------------

/**
 * A colour row: the swatch opens the picker (site swatches, the browser's picker, a hex,
 * opacity); the globe lists the site's global colours. Inside a popover the picker shows
 * in place.
 */
function ColorField({ label, value, inherited, kit, onChange, onCommit, allowClear = true, siteColors = true, right, hint, testId = "color-swatch" }: { label: string; value: string | undefined; inherited?: string; kit: SiteKit; onChange: (value: string | undefined) => void; onCommit?: () => void; allowClear?: boolean; siteColors?: boolean; right?: ReactNode; hint?: string; testId?: string }) {
  const [open, setOpen] = useState<"picker" | "global" | null>(null);
  const inPopover = useContext(InPopover);
  const shown = value ?? inherited;
  const linked = !!parseKitRef(shown);
  const input = <ColorInput value={value} inherited={inherited} kit={kit} siteColors={siteColors} allowClear={allowClear} onChange={onChange} onCommit={onCommit} />;
  if (inPopover) {
    return (
      <Row label={label} right={right} hint={hint} stacked>
        {input}
      </Row>
    );
  }
  return (
    <PopoverHost>
      <Row label={label} right={right} hint={hint}>
        {siteColors && <GlobeButton label={`${label}: global colours`} linked={linked} open={open === "global"} onClick={() => setOpen((current) => (current === "global" ? null : "global"))} testId="color-global" />}
        <ColorSwatch label={label} value={shown} kit={kit} open={open === "picker"} onClick={() => setOpen((current) => (current === "picker" ? null : "picker"))} testId={testId} />
      </Row>
      <Popover open={open === "picker"} onClose={() => setOpen(null)} label={label} testId="color-popover">
        {input}
      </Popover>
      <Popover open={open === "global"} onClose={() => setOpen(null)} label="Global colours" testId="color-global-popover">
        <GlobalColorList
          value={shown}
          kit={kit}
          onPick={(ref) => {
            onChange(ref);
            onCommit?.();
            setOpen(null);
          }}
        />
      </Popover>
    </PopoverHost>
  );
}

function ColorControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "color" }> }) {
  const { value, inherited, set, overridden } = useValue<string>(target, spec.path, spec.responsive);
  const raw = target.read(spec.path);
  return (
    <ColorField
      label={spec.label}
      value={value}
      inherited={inherited}
      kit={target.kit}
      siteColors={!spec.noKit}
      allowClear={!spec.required}
      hint={spec.hint}
      right={spec.responsive ? <DeviceButton device={target.device} overridden={overridden} onDevice={target.onDevice} onReset={() => target.write(spec.path, setAt(raw as never, target.device, undefined), "Reset the override")} /> : undefined}
      onChange={(next) => (next === undefined && spec.required ? undefined : set(next, `Changed ${spec.label.toLowerCase()}`, key(spec.path)))}
    />
  );
}

function FontControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "font" }> }) {
  const value = target.read(spec.path) as string | undefined;
  return (
    <Row label={spec.label}>
      <div className="w-full">
        <FontPicker value={value} kit={target.kit} siteFonts={!spec.noKit} allowInherit={!spec.required} onChange={(next) => (next === undefined && spec.required ? undefined : target.write(spec.path, next, `Changed ${spec.label.toLowerCase()}`))} />
      </div>
    </Row>
  );
}

function LinkControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "link" }> }) {
  const id = useId();
  const value = (target.read(spec.path) as { href?: string; newTab?: boolean } | undefined) ?? {};
  const href = value.href ?? "";
  const error = href && !isAllowedHref(href) ? "Must start with https://, http://, mailto:, tel:, / or #." : null;
  return (
    <Row label={spec.label} htmlFor={id} hint={error ?? spec.hint ?? "https://, mailto:, tel:, a page on this site (/contact/) or #anchor."} stacked>
      <div className="flex flex-col gap-1.5">
        <input id={id} type="text" inputMode="url" value={href} placeholder="Paste URL or type" onChange={(event) => target.write(spec.path, event.target.value === "" && !value.newTab ? undefined : { ...value, href: event.target.value }, `Changed ${spec.label.toLowerCase()}`, key(spec.path))} className={clsx(controlInputClass, error && "border-red")} aria-invalid={!!error} />
        <label className="flex items-center gap-2 text-[12px] text-text">
          <input type="checkbox" checked={!!value.newTab} onChange={(event) => target.write(spec.path, { ...value, href, newTab: event.target.checked || undefined }, "Changed link target")} /> Open in a new tab
        </label>
      </div>
    </Row>
  );
}

function ImageControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "image" }> }) {
  const id = useId();
  const src = (target.read([...spec.path, "src"]) as string | undefined) ?? "";
  const alt = (target.read([...spec.path, "alt"]) as string | undefined) ?? "";
  const error = src && !isAllowedMediaSrc(src) ? "A picture must live on this site (/assets/...) or on https://." : null;
  const preview = !src || error ? null : src.startsWith("https://") ? src : thumbnailUrl(src, target.siteUrl ?? null);
  return (
    <div className="flex flex-col gap-3">
      <Row label={spec.label} htmlFor={id} hint={error ?? "A path under /assets/ or an https:// address."} stacked>
        <div className="flex items-center gap-2">
          <span className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-ground">{preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : <icons.IconImage size={18} className="text-muted" />}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input id={id} type="text" value={src} onChange={(event) => target.write([...spec.path, "src"], event.target.value, "Changed picture", key(spec.path))} className={clsx(controlInputClass, "font-mono text-[12px]", error && "border-red")} placeholder="/assets/photo.webp" />
            {target.actions?.pickImage && (
              <button type="button" onClick={() => target.actions?.pickImage?.((nextSrc, nextAlt) => { target.write([...spec.path, "src"], nextSrc, "Chose a picture"); if (nextAlt && !alt) target.write([...spec.path, "alt"], nextAlt, "Chose a picture"); })} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-line px-2 text-[12px] font-semibold text-text hover:bg-ground">
                <icons.IconGallery size={14} /> Media library
              </button>
            )}
          </div>
        </div>
      </Row>
      <Row label="Alt text" htmlFor={`${id}-alt`} hint="What the picture shows, for screen readers and search engines.">
        <input id={`${id}-alt`} type="text" value={alt} onChange={(event) => target.write([...spec.path, "alt"], event.target.value, "Changed alt text", `${key(spec.path)}.alt`)} className={controlInputClass} />
      </Row>
    </div>
  );
}

function IconControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "icon" }> }) {
  const value = target.read(spec.path) as IconValue | null | undefined;
  return (
    <Row label={spec.label} stacked>
      <IconPicker value={value ?? null} onChange={(next) => target.write(spec.path, next ?? undefined, next ? "Chose an icon" : "Removed the icon")} />
    </Row>
  );
}

// --- one-row controls with a popover: shadows, stroke, typography, border ----------------------------------

/** A row whose pencil opens a popover with the fields; `active` fills the pencil when a value is set. */
function PopoverRow({ target, spec, active, children, label, before }: { target: ControlTarget; spec: { label: string; path: Path; responsive?: boolean }; active: boolean; children: ReactNode; label?: string; /** Extra buttons before the pencil (the globe). */ before?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = slug(spec.label);
  return (
    <PopoverHost>
      <Responsive target={target} spec={spec}>
        {before}
        <PencilButton label={`Edit ${(label ?? spec.label).toLowerCase()}`} active={active} open={open} onClick={() => setOpen((current) => !current)} testId={`edit-${id}`} />
      </Responsive>
      <Popover open={open} onClose={() => setOpen(false)} label={label ?? spec.label} testId={`popover-${id}`}>
        <InPopover.Provider value>{children}</InPopover.Provider>
      </Popover>
    </PopoverHost>
  );
}

function ShadowControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "shadow" }> }) {
  const { value, inherited, set } = useValue<Shadow>(target, spec.path, spec.responsive);
  const shown = value ?? inherited;
  const defaults: Shadow = { x: 0, y: 4, blur: 12, spread: spec.text ? undefined : 0, color: "#00000033" };
  const draft = shown ?? defaults;
  const update = (patch: Partial<Shadow>) => set({ ...defaults, ...(value ?? inherited ?? {}), ...patch }, `Changed ${spec.label.toLowerCase()}`, key(spec.path));
  const number = (label: string, field: "x" | "y" | "blur" | "spread", min?: number) => (
    <Row label={label}>
      <NumberInput ariaLabel={`${spec.label} ${label.toLowerCase()}`} value={draft[field] ?? 0} min={min} step={1} onChange={(next) => update({ [field]: next })} className="w-full" />
    </Row>
  );
  return (
    <PopoverRow target={target} spec={spec} active={!!shown}>
      <ColorField label="Colour" value={draft.color} kit={target.kit} allowClear={false} onChange={(next) => update({ color: next ?? "#00000033" })} />
      {number("Horizontal", "x")}
      {number("Vertical", "y")}
      {number("Blur", "blur", 0)}
      {!spec.text && number("Spread", "spread")}
      {!spec.text && (
        <Row label="Position">
          <Choice label="Shadow position" value={draft.inset ? "inset" : "outline"} allowNone={false} options={[{ value: "outline", label: "Outline" }, { value: "inset", label: "Inset" }]} onChange={(next) => update({ inset: next === "inset" || undefined })} />
        </Row>
      )}
      {shown && (
        <button type="button" onClick={() => set(undefined, `Removed ${spec.label.toLowerCase()}`)} className="h-7 self-start rounded-sm border border-line px-2 text-[11px] font-semibold text-muted hover:text-text" data-testid={`remove-${slug(spec.label)}`}>
          Remove {spec.label.toLowerCase()}
        </button>
      )}
    </PopoverRow>
  );
}

function StrokeControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "stroke" }> }) {
  const { value, inherited, set } = useValue<TextStroke>(target, spec.path, spec.responsive);
  const shown = value ?? inherited;
  const draft: TextStroke = shown ?? { width: 1, color: "kit:color.text" };
  const update = (patch: Partial<TextStroke>) => set({ ...draft, ...patch }, `Changed ${spec.label.toLowerCase()}`, key(spec.path));
  return (
    <PopoverRow target={target} spec={spec} active={!!shown}>
      <Row label="Width (px)">
        <NumberInput ariaLabel={`${spec.label} width`} value={draft.width} min={0} max={50} step={0.5} onChange={(next) => update({ width: next })} className="w-full" />
      </Row>
      <ColorField label="Colour" value={draft.color} kit={target.kit} allowClear={false} onChange={(next) => update({ color: next ?? "kit:color.text" })} />
      {shown && (
        <button type="button" onClick={() => set(undefined, `Removed ${spec.label.toLowerCase()}`)} className="h-7 self-start rounded-sm border border-line px-2 text-[11px] font-semibold text-muted hover:text-text" data-testid={`remove-${slug(spec.label)}`}>
          Remove {spec.label.toLowerCase()}
        </button>
      )}
    </PopoverRow>
  );
}

const BACKGROUND_KINDS = [
  { value: "none", label: "None" },
  { value: "color", label: "Colour" },
  { value: "gradient", label: "Gradient" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
];

function BackgroundFields({ background, kit, onChange }: { background: Background; kit: SiteKit; onChange: (next: Background) => void }) {
  switch (background.kind) {
    case "none":
      return null;
    case "color":
      return <ColorField label="Colour" value={background.color} kit={kit} allowClear={false} onChange={(next) => onChange({ kind: "color", color: next ?? "transparent" })} />;
    case "gradient": {
      const stops = background.stops;
      const setStop = (index: number, patch: Partial<{ color: string; position: number }>) => onChange({ ...background, stops: stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)) });
      return (
        <div className="flex flex-col gap-2">
          <Row label="Type">
            <Choice label="Gradient type" value={background.type} options={[{ value: "linear", label: "Linear" }, { value: "radial", label: "Radial" }]} onChange={(next) => onChange({ ...background, type: next ?? "linear" })} />
          </Row>
          {background.type === "linear" && (
            <Row label="Angle">
              <NumberInput ariaLabel="Gradient angle" value={background.angle ?? 180} min={0} max={360} step={1} onChange={(next) => onChange({ ...background, angle: next })} className="w-full" />
            </Row>
          )}
          <div className="h-6 rounded-sm border border-line" style={{ background: `linear-gradient(90deg, ${stops.map((stop) => `${stop.color.startsWith("kit:") ? "#888" : stop.color} ${stop.position}%`).join(", ")})` }} aria-hidden="true" />
          {stops.map((stop, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <ColorField label={`Stop ${index + 1}`} value={stop.color} kit={kit} allowClear={false} onChange={(next) => setStop(index, { color: next ?? "#000000" })} />
              </div>
              <NumberInput ariaLabel={`Stop ${index + 1} position`} value={stop.position} min={0} max={100} step={1} onChange={(next) => setStop(index, { position: next })} className="w-16" suffix={<span className="text-[11px] text-muted">%</span>} />
              <button type="button" aria-label="Remove stop" disabled={stops.length <= 2} onClick={() => onChange({ ...background, stops: stops.filter((_, i) => i !== index) })} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text disabled:opacity-40">
                <icons.IconX size={14} />
              </button>
            </div>
          ))}
          <button type="button" disabled={stops.length >= 10} onClick={() => onChange({ ...background, stops: [...stops, { color: "#ffffff", position: 100 }] })} className="h-7 self-start rounded-sm border border-line px-2 text-[11px] font-semibold text-muted hover:text-text disabled:opacity-40">
            Add a stop
          </button>
        </div>
      );
    }
    case "image":
      return (
        <div className="flex flex-col gap-2">
          <Row label="Image" stacked>
            <input type="text" aria-label="Background image" value={background.src} placeholder="/assets/photo.webp" onChange={(event) => onChange({ ...background, src: event.target.value })} className={clsx(controlInputClass, "font-mono text-[12px]")} />
          </Row>
          <Row label="Size">
            <select aria-label="Size" value={background.size ?? "cover"} onChange={(event) => onChange({ ...background, size: event.target.value as "auto" | "cover" | "contain" })} className={controlInputClass}>
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="auto">Auto</option>
            </select>
          </Row>
          <Row label="Repeat">
            <select aria-label="Repeat" value={background.repeat ?? "no-repeat"} onChange={(event) => onChange({ ...background, repeat: event.target.value as "no-repeat" | "repeat" | "repeat-x" | "repeat-y" })} className={controlInputClass}>
              <option value="no-repeat">No repeat</option>
              <option value="repeat">Repeat</option>
              <option value="repeat-x">Repeat across</option>
              <option value="repeat-y">Repeat down</option>
            </select>
          </Row>
          <Row label="Attachment">
            <select aria-label="Attachment" value={background.attachment ?? "scroll"} onChange={(event) => onChange({ ...background, attachment: event.target.value as "scroll" | "fixed" })} className={controlInputClass}>
              <option value="scroll">Scrolls with the page</option>
              <option value="fixed">Fixed (parallax)</option>
            </select>
          </Row>
          <Row label="Position">
            <select aria-label="Position" value={background.focal ? "focal" : (background.position ?? "center center")} onChange={(event) => (event.target.value === "focal" ? onChange({ ...background, focal: { x: 50, y: 50 }, position: undefined }) : onChange({ ...background, position: event.target.value, focal: undefined }))} className={controlInputClass}>
              {["center center", "top left", "top center", "top right", "center left", "center right", "bottom left", "bottom center", "bottom right"].map((position) => (
                <option key={position} value={position}>
                  {position}
                </option>
              ))}
              <option value="focal">Focal point…</option>
            </select>
          </Row>
          {background.focal && (
            <div className="grid grid-cols-2 gap-1.5">
              <NumberInput label="X %" value={background.focal.x} min={0} max={100} step={1} onChange={(next) => onChange({ ...background, focal: { x: next, y: background.focal?.y ?? 50 } })} />
              <NumberInput label="Y %" value={background.focal.y} min={0} max={100} step={1} onChange={(next) => onChange({ ...background, focal: { x: background.focal?.x ?? 50, y: next } })} />
            </div>
          )}
        </div>
      );
    case "video":
      return (
        <div className="flex flex-col gap-2">
          <Row label="Video" stacked>
            <input type="text" aria-label="Video file" value={background.src} placeholder="/assets/loop.mp4 or https://…" onChange={(event) => onChange({ ...background, src: event.target.value })} className={clsx(controlInputClass, "font-mono text-[12px]")} />
          </Row>
          <Row label="Fallback picture" stacked>
            <input type="text" aria-label="Fallback picture" value={background.poster ?? ""} placeholder="/assets/still.webp" onChange={(event) => onChange({ ...background, poster: event.target.value || undefined })} className={clsx(controlInputClass, "font-mono text-[12px]")} />
          </Row>
          <Row label="Loop">
            <Toggle checked={background.loop !== false} onChange={(next) => onChange({ ...background, loop: next })} label="Loop" />
          </Row>
          <Row label="Play on phones" hint="Uses data; the fallback picture shows otherwise.">
            <Toggle checked={!!background.playOnMobile} onChange={(next) => onChange({ ...background, playOnMobile: next || undefined })} label="Play on phones" />
          </Row>
        </div>
      );
  }
}

const defaultBackground = (kind: Background["kind"]): Background => {
  switch (kind) {
    case "color":
      return { kind, color: "kit:color.primary" };
    case "gradient":
      return { kind, type: "linear", angle: 180, stops: [{ color: "kit:color.primary", position: 0 }, { color: "kit:color.secondary", position: 100 }] };
    case "image":
      return { kind, src: "", size: "cover", repeat: "no-repeat", position: "center center" };
    case "video":
      return { kind, src: "", loop: true };
    default:
      return { kind: "none" };
  }
};

function BackgroundControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "background" }> }) {
  const { value, inherited, set } = useValue<Background>(target, spec.path, spec.responsive);
  const shown = value ?? inherited;
  const kind = shown?.kind ?? "";
  return (
    <div className="flex flex-col gap-3">
      <Responsive target={target} spec={{ ...spec, label: `${spec.label} type` }}>
        <select aria-label={`${spec.label} type`} value={kind} onChange={(event) => set(event.target.value === "" ? undefined : defaultBackground(event.target.value as Background["kind"]), `Changed ${spec.label.toLowerCase()}`)} className={controlInputClass} data-testid="background-kind">
          <option value="">Default</option>
          {BACKGROUND_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Responsive>
      {shown && <BackgroundFields background={shown} kit={target.kit} onChange={(next) => set(next, `Changed ${spec.label.toLowerCase()}`, key(spec.path))} />}
    </div>
  );
}

function OverlayControl({ target, path }: { target: ControlTarget; path: Path }) {
  const { value, inherited, set } = useValue<BackgroundOverlay>(target, path, true);
  const shown = value ?? inherited;
  return (
    <div className="flex flex-col gap-3">
      <Responsive target={target} spec={{ label: "Overlay", path, responsive: true }}>
        <select aria-label="Overlay type" value={shown ? shown.background.kind : ""} onChange={(event) => (event.target.value === "" ? set(undefined, "Removed the overlay") : set({ background: event.target.value === "color" && !shown ? { kind: "color", color: "#00000080" } : defaultBackground(event.target.value as Background["kind"]), opacity: shown?.opacity ?? 0.5, blend: shown?.blend }, shown ? "Changed overlay" : "Added an overlay"))} className={controlInputClass} data-testid="overlay-kind">
          <option value="">None</option>
          {BACKGROUND_KINDS.filter((option) => option.value !== "none" && option.value !== "video").map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Responsive>
      {shown && (
        <>
          <BackgroundFields background={shown.background} kit={target.kit} onChange={(next) => set({ ...shown, background: next }, "Changed overlay", key(path))} />
          <Row label="Opacity">
            <div className="flex w-full items-center gap-2 text-[11px] text-muted">
              <input type="range" min={0} max={100} value={Math.round(shown.opacity * 100)} onChange={(event) => set({ ...shown, opacity: Number(event.target.value) / 100 }, "Changed overlay opacity", key(path))} className="h-1 min-w-0 flex-1" aria-label="Overlay opacity" />
              <span className="w-8 text-right tabular-nums">{Math.round(shown.opacity * 100)}%</span>
            </div>
          </Row>
          <Row label="Blend mode">
            <select aria-label="Overlay blend mode" value={shown.blend ?? "normal"} onChange={(event) => set({ ...shown, blend: event.target.value === "normal" ? undefined : (event.target.value as BackgroundOverlay["blend"]) }, "Changed blend mode")} className={controlInputClass}>
              {BLEND_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </Row>
        </>
      )}
    </div>
  );
}

const BLEND_MODES = ["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"];
const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];

const presetLabel = (name: string) => (name.toUpperCase().startsWith("H") && /^h[1-6]$/i.test(name) ? `Heading ${name.slice(1)}` : name.charAt(0).toUpperCase() + name.slice(1));

/**
 * Typography as one row: the globe picks a site text style (H1…H6, body, small, button),
 * the pencil opens the font, size, weight, transform, style, decoration and spacing.
 */
function TypographyControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "typography" }> }) {
  const base = spec.path;
  const label = spec.label ?? "Typography";
  const typography = (target.read(base) as Typography | undefined) ?? {};
  const presets = Object.keys(target.kit.typography);
  const presetRef = typography.preset ?? "";
  const family = typography.fontFamily;
  const preset = presetRef ? target.kit.typography[presetRef.replace("kit:type.", "") as keyof SiteKit["typography"]] : undefined;
  const fromPreset = {
    fontSize: preset ? resolve<Size>(preset.fontSize, target.device) : undefined,
    fontWeight: preset?.fontWeight,
    lineHeight: preset?.lineHeight,
    letterSpacing: preset?.letterSpacing,
    textTransform: preset?.textTransform,
  };
  const set = Object.keys(typography).some((field) => field !== "textAlign" && typography[field as keyof Typography] !== undefined);
  const [globalOpen, setGlobalOpen] = useState(false);
  return (
    <PopoverRow
      target={target}
      spec={{ label, path: base }}
      active={set}
      before={
        <PopoverHost className="flex">
          <GlobeButton label={`${label}: site text styles`} linked={!!presetRef} open={globalOpen} onClick={() => setGlobalOpen((current) => !current)} testId="typography-global" />
          <Popover open={globalOpen} onClose={() => setGlobalOpen(false)} label="Site text styles" testId="popover-typography-global" className="right-auto left-0 w-[260px]">
            <ul role="listbox" aria-label="Site text styles" className="flex flex-col gap-0.5" data-testid="global-typography">
              <li>
                <button type="button" role="option" aria-selected={!presetRef} onClick={() => { target.write([...base, "preset"], undefined, "Changed the text preset"); setGlobalOpen(false); }} className={clsx("flex h-8 w-full items-center rounded-sm px-1.5 text-left text-[12px] text-muted hover:bg-ground", !presetRef && "bg-blue-soft text-accent")}>
                  None (inherit from the site)
                </button>
              </li>
              {presets.map((name) => {
                const ref = `kit:type.${name}`;
                const style = target.kit.typography[name as keyof SiteKit["typography"]];
                return (
                  <li key={name}>
                    <button type="button" role="option" aria-selected={presetRef === ref} data-testid={`global-type-${name}`} onClick={() => { target.write([...base, "preset"], ref, "Changed the text preset"); setGlobalOpen(false); }} className={clsx("flex h-8 w-full items-center justify-between rounded-sm px-1.5 text-left text-[12px] hover:bg-ground", presetRef === ref && "bg-blue-soft text-accent")}>
                      <span>{presetLabel(name)}</span>
                      <span className="font-mono text-[11px] text-muted">{sizeToCss(resolve<Size>(style?.fontSize, "desktop")) ?? ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Popover>
        </PopoverHost>
      }
    >
      {presetRef && (
        <p className="text-[11px] leading-relaxed text-muted" data-testid="typography-preset">
          Linked to the site style <span className="font-semibold text-accent">{presetLabel(presetRef.replace("kit:type.", ""))}</span>. Values here override it for this element only.
        </p>
      )}
      <Row label="Family">
        <div className="w-full">
          <FontPicker value={family} kit={target.kit} placeholder={presetRef ? `From the preset (${resolveKitFont(target.kit, target.kit.typography[presetRef.replace("kit:type.", "") as keyof SiteKit["typography"]]?.fontFamily) ?? "site font"})` : "Inherit"} onChange={(next) => target.write([...base, "fontFamily"], next, "Changed the font")} />
        </div>
      </Row>
      <ControlRenderer
        target={target}
        specs={[
          { kind: "size", label: "Size", path: [...base, "fontSize"], units: FONT_UNITS, responsive: true, min: 0, fallback: fromPreset.fontSize },
          { kind: "select", label: "Weight", path: [...base, "fontWeight"], responsive: true, numeric: true, fallback: fromPreset.fontWeight, custom: { min: 1, max: 1000 }, options: WEIGHTS.map((weight) => ({ value: weight, label: weight === "400" ? "400 Regular" : weight === "700" ? "700 Bold" : weight })) },
          { kind: "select", label: "Transform", path: [...base, "textTransform"], responsive: true, fallback: fromPreset.textTransform, options: [{ value: "none", label: "None" }, { value: "uppercase", label: "UPPERCASE" }, { value: "lowercase", label: "lowercase" }, { value: "capitalize", label: "Capitalize" }] },
          { kind: "select", label: "Style", path: [...base, "fontStyle"], responsive: true, options: [{ value: "normal", label: "Normal" }, { value: "italic", label: "Italic" }] },
          { kind: "select", label: "Decoration", path: [...base, "textDecoration"], responsive: true, options: [{ value: "none", label: "None" }, { value: "underline", label: "Underline" }, { value: "line-through", label: "Strike" }, { value: "overline", label: "Overline" }] },
          { kind: "size", label: "Line height", path: [...base, "lineHeight"], units: LINE_HEIGHT_UNITS, responsive: true, min: 0, fallback: fromPreset.lineHeight },
          { kind: "size", label: "Letter spacing", path: [...base, "letterSpacing"], units: LETTER_UNITS, responsive: true, fallback: fromPreset.letterSpacing },
          { kind: "size", label: "Word spacing", path: [...base, "wordSpacing"], units: LETTER_UNITS, responsive: true },
        ]}
      />
    </PopoverRow>
  );
}

function BorderControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "border" }> }) {
  const base = spec.path;
  const border = target.read(base) as Border | undefined;
  const set = !!border && Object.values(border).some((value) => value !== undefined);
  return (
    <PopoverRow target={target} spec={{ label: spec.label ?? "Border", path: base }} active={set}>
      <ControlRenderer
        target={target}
        specs={[
          { kind: "select", label: "Type", path: [...base, "style"], responsive: true, options: [{ value: "none", label: "None" }, { value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }, { value: "double", label: "Double" }] },
          { kind: "sides", label: "Width", path: [...base, "width"], responsive: true, units: ["px", "em", "rem"] },
          { kind: "color", label: "Colour", path: [...base, "color"], responsive: true },
          { kind: "corners", label: "Radius", path: [...base, "radius"], responsive: true, units: ["px", "%", "em", "rem"] },
        ]}
      />
    </PopoverRow>
  );
}

// --- attributes and CSS (agency) -----------------------------------------------------------------------------------

function AttributesControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "attributes" }> }) {
  const rows = (target.read(spec.path) as { name: string; value: string }[] | undefined) ?? [];
  const update = (next: { name: string; value: string }[]) => target.write(spec.path, next.length ? next : undefined, "Changed attributes", key(spec.path));
  return (
    <Row label={spec.label} hint="Names use letters, digits and dashes; event handlers, href, src, style, class and id are never allowed." stacked>
      <div className="flex flex-col gap-1.5">
        {rows.map((row, index) => (
          <div key={index} className="flex items-center gap-1">
            <input type="text" aria-label="Attribute name" value={row.name} placeholder="data-track" onChange={(event) => update(rows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))} className={clsx(controlInputClass, "font-mono text-[12px]")} />
            <input type="text" aria-label="Attribute value" value={row.value} placeholder="value" onChange={(event) => update(rows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))} className={clsx(controlInputClass, "font-mono text-[12px]")} />
            <button type="button" aria-label="Remove attribute" onClick={() => update(rows.filter((_, i) => i !== index))} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text">
              <icons.IconX size={14} />
            </button>
          </div>
        ))}
        <button type="button" disabled={rows.length >= 20} onClick={() => update([...rows, { name: "", value: "" }])} className="h-7 self-start rounded-sm border border-line px-2 text-[11px] font-semibold text-muted hover:text-text disabled:opacity-40">
          Add an attribute
        </button>
      </div>
    </Row>
  );
}

function CssControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "css" }> }) {
  const id = useId();
  const value = (target.read(spec.path) as string | undefined) ?? "";
  return (
    <Row label={spec.label} htmlFor={id} hint='Write "selector" for this element: selector { color: red } selector:hover { … }. @import, javascript: and off-site url() are removed.' stacked>
      <textarea id={id} value={value} spellCheck={false} onChange={(event) => target.write(spec.path, event.target.value || undefined, "Changed custom CSS", key(spec.path))} className={clsx(controlInputClass, "min-h-28 py-1.5 font-mono text-[12px] leading-relaxed")} />
    </Row>
  );
}

// --- rows and lines ---------------------------------------------------------------------------------------

const rowId = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");

/** A target over one row: reads and writes inside it, stored by rewriting the whole list. */
function rowTarget(target: ControlTarget, path: Path, rows: Record<string, unknown>[], index: number): ControlTarget {
  const row = rows[index] ?? {};
  return {
    ...target,
    read: (sub) => sub.reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), row),
    write: (sub, value, label, group) => {
      const next = rows.map((current, i) => (i === index ? writeInto(current, sub, value) : current));
      target.write(path, next, label, group ? `${key(path)}.${index}.${group}` : undefined);
    },
  };
}

function writeInto(object: Record<string, unknown>, path: Path, value: unknown): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return object;
  const copy = { ...object };
  if (rest.length === 0) {
    if (value === undefined) delete copy[head];
    else copy[head] = value;
    return copy;
  }
  const child = copy[head] && typeof copy[head] === "object" && !Array.isArray(copy[head]) ? (copy[head] as Record<string, unknown>) : {};
  copy[head] = writeInto(child, rest, value);
  return copy;
}

function ItemsControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "items" }> }) {
  const rows = (target.read(spec.path) as Record<string, unknown>[] | undefined) ?? [];
  const [open, setOpen] = useState<string | null>(null);
  const max = spec.max ?? 50;
  const min = spec.min ?? 0;
  const save = (next: Record<string, unknown>[], label: string) => target.write(spec.path, next, label);
  const move = (index: number, delta: number) => {
    const next = [...rows];
    const [row] = next.splice(index, 1);
    if (!row) return;
    next.splice(index + delta, 0, row);
    save(next, `Moved ${spec.itemLabel.toLowerCase()}`);
  };
  return (
    <div className="flex flex-col gap-1.5" data-testid={`items-${key(spec.path)}`}>
      <span className="text-[12px] font-medium text-muted">{spec.label}</span>
      {rows.map((row, index) => {
        const id = typeof row["id"] === "string" ? row["id"] : String(index);
        const expanded = open === id;
        const title = String(row[spec.titleKey] ?? "") || `${spec.itemLabel} ${index + 1}`;
        return (
          <div key={id} className="rounded-sm border border-line" data-testid="item-row">
            <div className="flex items-center gap-0.5 pr-1">
              <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : id)} className="flex h-8 min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[12px] font-semibold text-text hover:bg-ground">
                {expanded ? <icons.IconChevronDown size={13} className="text-muted" /> : <icons.IconChevronRight size={13} className="text-muted" />}
                <span className="truncate">{title}</span>
              </button>
              <button type="button" aria-label={`Move ${title} up`} disabled={index === 0} onClick={() => move(index, -1)} className="inline-flex h-7 w-6 items-center justify-center rounded-sm text-muted hover:bg-ground disabled:opacity-30">
                <icons.IconArrowUp size={12} />
              </button>
              <button type="button" aria-label={`Move ${title} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)} className="inline-flex h-7 w-6 items-center justify-center rounded-sm text-muted hover:bg-ground disabled:opacity-30">
                <icons.IconArrowDown size={12} />
              </button>
              <button type="button" aria-label={`Duplicate ${title}`} disabled={rows.length >= max} onClick={() => save([...rows.slice(0, index + 1), { ...row, id: rowId() }, ...rows.slice(index + 1)], `Duplicated ${spec.itemLabel.toLowerCase()}`)} className="inline-flex h-7 w-6 items-center justify-center rounded-sm text-muted hover:bg-ground disabled:opacity-30">
                <icons.IconCopy size={12} />
              </button>
              <button type="button" aria-label={`Remove ${title}`} disabled={rows.length <= min} onClick={() => save(rows.filter((_, i) => i !== index), `Removed ${spec.itemLabel.toLowerCase()}`)} className="inline-flex h-7 w-6 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-red disabled:opacity-30">
                <icons.IconTrash size={12} />
              </button>
            </div>
            {expanded && (
              <div className="flex flex-col gap-3 border-t border-line p-2.5">
                <ControlRenderer target={rowTarget(target, spec.path, rows, index)} specs={spec.fields} />
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        disabled={rows.length >= max}
        onClick={() => {
          const row = { id: rowId(), ...spec.create() };
          save([...rows, row], `Added ${spec.itemLabel.toLowerCase()}`);
          setOpen(String(row.id));
        }}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-dashed border-line text-[12px] font-semibold text-muted hover:border-accent hover:text-accent disabled:opacity-40"
        data-testid="add-item"
      >
        <icons.IconPlus size={13} /> Add {spec.itemLabel.toLowerCase()}
      </button>
    </div>
  );
}

function LinesControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "lines" }> }) {
  const id = useId();
  const lines = (target.read(spec.path) as string[] | undefined) ?? [];
  return (
    <Row label={spec.label} htmlFor={id} hint={spec.hint ?? "One per line."} stacked>
      <textarea
        id={id}
        value={lines.join("\n")}
        onChange={(event) => {
          const next = event.target.value.split("\n").slice(0, spec.max ?? 50);
          target.write(spec.path, next.some((line) => line.trim()) ? next : undefined, `Changed ${spec.label.toLowerCase()}`, key(spec.path));
        }}
        className={clsx(controlInputClass, "min-h-24 py-1.5 leading-relaxed")}
      />
    </Row>
  );
}

// --- groups and the renderer ---------------------------------------------------------------------------------------

function Group({ label, open = true, children }: { label: string; open?: boolean; children: ReactNode }) {
  const [isOpen, setOpen] = useState(open);
  return (
    <section className="border-b border-line" data-testid={`group-${slug(label)}`}>
      <button type="button" aria-expanded={isOpen} onClick={() => setOpen((current) => !current)} className="flex h-10 w-full items-center justify-between px-5 text-[13px] font-bold text-text hover:bg-ground/60">
        {label}
        {isOpen ? <icons.IconChevronDown size={14} className="text-muted" /> : <icons.IconChevronRight size={14} className="text-muted" />}
      </button>
      {isOpen && <div className="flex flex-col gap-3 px-5 pb-4">{children}</div>}
    </section>
  );
}

/**
 * `inset` is for the top level of a panel: controls outside a group get the panel's side
 * padding (groups carry their own).
 */
export function ControlRenderer({ target, specs, inset }: { target: ControlTarget; specs: ControlSpec[]; inset?: boolean }) {
  if (inset) {
    return (
      <>
        {specs.map((spec, index) =>
          spec.kind === "group" ? (
            <ControlRenderer key={`g-${spec.label}`} target={target} specs={[spec]} />
          ) : (
            <div key={`c-${index}`} className="px-5 pt-3">
              <ControlRenderer target={target} specs={[spec]} />
            </div>
          ),
        )}
      </>
    );
  }
  return (
    <>
      {specs.map((spec, index) => {
        switch (spec.kind) {
          case "group":
            if (spec.agencyOnly && !target.isStaff) return null;
            return (
              <Group key={spec.label} label={spec.label} open={spec.open}>
                <ControlRenderer target={target} specs={spec.controls} />
              </Group>
            );
          case "if":
            return spec.when(target.read) ? <ControlRenderer key={spec.id} target={target} specs={spec.controls} /> : null;
          case "custom":
            return <div key={spec.id}>{spec.render({ read: target.read, write: target.write, editOnPage: target.actions?.editOnPage, kit: target.kit, applyStructure: target.actions?.applyStructure })}</div>;
          case "note":
            return (
              <p key={index} className="text-[12px] leading-relaxed text-muted">
                {spec.text}
              </p>
            );
          case "text":
            return <TextControl key={key(spec.path)} target={target} spec={spec} />;
          case "select":
            return <SelectControl key={key(spec.path)} target={target} spec={spec} />;
          case "choice":
            return <ChoiceControl key={key(spec.path)} target={target} spec={spec} />;
          case "toggle":
            return <ToggleControl key={key(spec.path)} target={target} spec={spec} />;
          case "number":
            return <NumberControl key={key(spec.path)} target={target} spec={spec} />;
          case "size":
            return <SizeControl key={key(spec.path)} target={target} spec={spec} />;
          case "sides":
            return <SidesControl key={key(spec.path)} target={target} spec={spec} />;
          case "corners":
            return <CornersControl key={key(spec.path)} target={target} spec={spec} />;
          case "gap":
            return <GapControl key={key(spec.path)} target={target} spec={spec} />;
          case "color":
            return <ColorControl key={key(spec.path)} target={target} spec={spec} />;
          case "font":
            return <FontControl key={key(spec.path)} target={target} spec={spec} />;
          case "link":
            return <LinkControl key={key(spec.path)} target={target} spec={spec} />;
          case "image":
            return <ImageControl key={key(spec.path)} target={target} spec={spec} />;
          case "icon":
            return <IconControl key={key(spec.path)} target={target} spec={spec} />;
          case "shadow":
            return <ShadowControl key={key(spec.path)} target={target} spec={spec} />;
          case "stroke":
            return <StrokeControl key={key(spec.path)} target={target} spec={spec} />;
          case "background":
            return <BackgroundControl key={key(spec.path)} target={target} spec={spec} />;
          case "typography":
            return <TypographyControl key={key(spec.path)} target={target} spec={spec} />;
          case "items":
            return <ItemsControl key={key(spec.path)} target={target} spec={spec} />;
          case "lines":
            return <LinesControl key={key(spec.path)} target={target} spec={spec} />;
          case "overlay":
            return <OverlayControl key={key(spec.path)} target={target} path={spec.path} />;
          case "border":
            return <BorderControl key={key(spec.path)} target={target} spec={spec} />;
          case "attributes":
            return <AttributesControl key={key(spec.path)} target={target} spec={spec} />;
          case "css":
            return <CssControl key={key(spec.path)} target={target} spec={spec} />;
          default:
            return null;
        }
      })}
    </>
  );
}

export { sizeToCss as sizeLabel, type Corners, type Sides };
