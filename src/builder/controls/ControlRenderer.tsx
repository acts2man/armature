/**
 * Renders a list of control specs against a target (an element or the site kit). Every
 * responsive control shows the device icon (click: switch the whole editor's device), a
 * dot when the current device overrides (click: reset it), and greys the value it
 * inherits from a larger device. Every change is one named command; continuous typing
 * and scrubbing on one control merge into one undo step.
 */
import { clsx } from "clsx";
import { useId, useState, type ReactNode } from "react";
import * as icons from "@/components/icons.tsx";
import { Toggle } from "@/components/ui.tsx";
import { hasOverride, own, resolve, setAt, type Background, type BackgroundOverlay, type Border, type Corners, type Device, type Gap, type IconValue, type Shadow, type Sides, type Size, type SiteKit, type Typography, type Unit } from "@shared/builder/index.ts";
import { isAllowedHref, isAllowedMediaSrc } from "@shared/builder/schema.ts";
import { resolveKitFont, sizeToCss } from "@kit/values.ts";
import { FontPicker } from "./FontPicker.tsx";
import { IconPicker } from "./IconPicker.tsx";
import { Choice, ColorInput, controlInputClass, DeviceButton, NumberInput, Row, SizeInput, UnitMenu } from "./inputs.tsx";
import { FONT_UNITS, LETTER_UNITS, LINE_HEIGHT_UNITS, PX_UNITS, SPACING_UNITS, type ControlSpec, type Path } from "./types.ts";

export type ControlTarget = {
  read: (path: Path) => unknown;
  /** `group` merges continuous changes into one undo step. */
  write: (path: Path, value: unknown, label: string, group?: string) => void;
  device: Device;
  onDevice: (device: Device) => void;
  kit: SiteKit;
  isStaff: boolean;
  /** Extra actions a control may need (the media library, editing on the page). */
  actions?: { pickImage?: (onPick: (src: string, alt: string) => void) => void; editOnPage?: () => void };
};

const key = (path: Path) => path.join(".");

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

function Responsive({ target, spec, children, hint, htmlFor }: { target: ControlTarget; spec: { label: string; path: Path; responsive?: boolean }; children: ReactNode; hint?: string; htmlFor?: string }) {
  const raw = target.read(spec.path);
  const overridden = spec.responsive ? hasOverride(raw as never, target.device) : false;
  return (
    <Row
      label={spec.label}
      htmlFor={htmlFor}
      hint={hint}
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
    <Row label={spec.label} htmlFor={id} hint={spec.hint}>
      {spec.multiline ? (
        <textarea id={id} value={value} maxLength={spec.max} placeholder={spec.placeholder} onChange={(event) => set(event.target.value)} className={clsx(controlInputClass, "min-h-20 py-1.5 leading-relaxed")} />
      ) : (
        <input id={id} type="text" value={value} maxLength={spec.max} placeholder={spec.placeholder} onChange={(event) => set(event.target.value)} className={controlInputClass} />
      )}
    </Row>
  );
}

function SelectControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "select" }> }) {
  const id = useId();
  const { value, inherited, set } = useValue<string | number>(target, spec.path, spec.responsive, spec.fallback);
  const parse = (raw: string): string | number | undefined => {
    if (raw === "") return undefined;
    if (spec.numeric && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  };
  return (
    <Responsive target={target} spec={spec} htmlFor={id} hint={spec.hint}>
      <select id={id} value={String(value ?? inherited ?? "")} onChange={(event) => {
        const next = parse(event.target.value);
        if (next === undefined && spec.clearPath) target.write(spec.clearPath, undefined, `Reset ${spec.label.toLowerCase()}`);
        else set(next, `Changed ${spec.label.toLowerCase()}`);
      }} className={clsx(controlInputClass, value === undefined && inherited !== undefined && "text-muted")}>
        {!spec.required && !spec.options.some((option) => option.value === "") && <option value="">Default</option>}
        {spec.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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
      <Choice label={spec.label} value={value ?? inherited} allowNone={spec.allowNone ?? true} options={spec.options.map((option) => ({ value: option.value, title: option.label, label: option.icon ? iconFor(option.icon) : option.label }))} onChange={(next) => set(next, `Changed ${spec.label.toLowerCase()}`)} />
    </Responsive>
  );
}

function ToggleControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "toggle" }> }) {
  const { value, inherited, set } = useValue<boolean>(target, spec.path, spec.responsive);
  const on = value ?? inherited ?? false;
  return (
    <Responsive target={target} spec={spec} hint={spec.hint}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-muted">{on ? "On" : "Off"}</span>
        <Toggle checked={on} onChange={(next) => set(next ? true : undefined, `${next ? "Turned on" : "Turned off"} ${spec.label.toLowerCase()}`)} label={spec.label} />
      </div>
    </Responsive>
  );
}

function NumberControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "number" }> }) {
  const id = useId();
  const { value, inherited, set } = useValue<number>(target, spec.path, spec.responsive);
  return (
    <Responsive target={target} spec={spec} htmlFor={id} hint={spec.hint}>
      <NumberInput id={id} value={value} inherited={inherited} min={spec.min} max={spec.max} step={spec.step ?? 1} onChange={(next) => set(next, `Changed ${spec.label.toLowerCase()}`, key(spec.path))} />
    </Responsive>
  );
}

function SizeControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "size" }> }) {
  const id = useId();
  const { value, inherited, set } = useValue<Size | "screen">(target, spec.path, spec.responsive, spec.fallback);
  const isScreen = value === "screen" || (value === undefined && inherited === "screen");
  return (
    <Responsive target={target} spec={spec} htmlFor={id} hint={spec.hint}>
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
    </Responsive>
  );
}

// --- sides, corners, gap ---------------------------------------------------------------------------------

const SIDES = ["top", "right", "bottom", "left"] as const;
const CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;

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
    <Responsive target={target} spec={spec}>
      <div className="grid grid-cols-4 gap-1">
        {keys.map((k) => (
          <NumberInput key={k} label={labels[k]} ariaLabel={`${spec.label} ${labels[k].toLowerCase()}`} value={shown[k]?.value} inherited={value === undefined ? inherited?.[k]?.value : undefined} step={unit === "em" || unit === "rem" ? 0.1 : 1} onChange={(next) => update(k, { value: next, unit })} className="flex-col items-stretch gap-0.5" />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <UnitMenu unit={unit} units={units} onChange={(next) => set(Object.fromEntries(keys.map((k) => [k, { value: shown[k]?.value ?? 0, unit: next }])) as Partial<Record<K, Size>>, `Changed ${spec.label.toLowerCase()} unit`)} />
        <button type="button" aria-pressed={linked} title={linked ? "Values are linked: edit one to set all" : "Values are unlinked"} onClick={() => setLinked((current) => !current)} className={clsx("inline-flex h-7 items-center gap-1 rounded-sm px-1.5 text-[11px] font-semibold", linked ? "bg-blue-soft text-accent" : "text-muted hover:bg-ground")} data-testid="link-sides">
          <icons.IconLink size={12} /> {linked ? "Linked" : "Unlinked"}
        </button>
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
    <Responsive target={target} spec={spec}>
      <div className="grid grid-cols-2 gap-2">
        <SizeInput label="Col" value={value?.column} inherited={value === undefined ? inherited?.column : shown.column} units={SPACING_UNITS} onChange={(next) => update("column", next)} />
        <SizeInput label="Row" value={value?.row} inherited={value === undefined ? inherited?.row : shown.row} units={SPACING_UNITS} onChange={(next) => update("row", next)} />
      </div>
    </Responsive>
  );
}

// --- colour, font, link, image, icon -----------------------------------------------------------------------

function ColorControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "color" }> }) {
  const { value, inherited, set } = useValue<string>(target, spec.path, spec.responsive);
  return (
    <Responsive target={target} spec={spec} hint={spec.hint}>
      <ColorInput value={value} inherited={inherited} kit={target.kit} siteColors={!spec.noKit} allowClear={!spec.required} onChange={(next) => (next === undefined && spec.required ? undefined : set(next, `Changed ${spec.label.toLowerCase()}`, key(spec.path)))} />
    </Responsive>
  );
}

function FontControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "font" }> }) {
  const value = target.read(spec.path) as string | undefined;
  return (
    <Row label={spec.label}>
      <FontPicker value={value} kit={target.kit} siteFonts={!spec.noKit} allowInherit={!spec.required} onChange={(next) => (next === undefined && spec.required ? undefined : target.write(spec.path, next, `Changed ${spec.label.toLowerCase()}`))} />
    </Row>
  );
}

function LinkControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "link" }> }) {
  const id = useId();
  const value = (target.read(spec.path) as { href?: string; newTab?: boolean } | undefined) ?? {};
  const href = value.href ?? "";
  const error = href && !isAllowedHref(href) ? "Must start with https://, http://, mailto:, tel:, / or #." : null;
  return (
    <Row label={spec.label} htmlFor={id} hint={error ?? spec.hint ?? "https://, mailto:, tel:, a page on this site (/contact/) or #anchor."}>
      <div className="flex flex-col gap-1.5">
        <input id={id} type="text" inputMode="url" value={href} onChange={(event) => target.write(spec.path, event.target.value === "" && !value.newTab ? undefined : { ...value, href: event.target.value }, `Changed ${spec.label.toLowerCase()}`, key(spec.path))} className={clsx(controlInputClass, error && "border-red")} aria-invalid={!!error} />
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
  return (
    <div className="flex flex-col gap-3">
      <Row label={spec.label} htmlFor={id} hint={error ?? "A path under /assets/ or an https:// address."}>
        <div className="flex items-center gap-2">
          <span className="flex h-14 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm border border-line bg-ground">{src && !error ? <img src={src} alt="" className="h-full w-full object-cover" /> : <icons.IconImage size={18} className="text-muted" />}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input id={id} type="text" value={src} onChange={(event) => target.write([...spec.path, "src"], event.target.value, "Changed picture", key(spec.path))} className={clsx(controlInputClass, "font-mono text-[12px]", error && "border-red")} placeholder="/assets/photo.webp" />
            {target.actions?.pickImage && (
              <button type="button" onClick={() => target.actions?.pickImage?.((nextSrc, nextAlt) => { target.write([...spec.path, "src"], nextSrc, "Chose a picture"); if (nextAlt && !alt) target.write([...spec.path, "alt"], nextAlt, "Chose a picture"); })} className="h-8 rounded-sm border border-line text-[12px] font-semibold text-text hover:bg-ground">
                Choose from the media library
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
    <Row label={spec.label}>
      <IconPicker value={value ?? null} onChange={(next) => target.write(spec.path, next ?? undefined, next ? "Chose an icon" : "Removed the icon")} />
    </Row>
  );
}

// --- shadows, backgrounds, typography, border ------------------------------------------------------------------

function ShadowControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "shadow" }> }) {
  const { value, inherited, set } = useValue<Shadow>(target, spec.path, spec.responsive);
  const shown = value ?? inherited;
  const update = (patch: Partial<Shadow>) => set({ x: 0, y: 4, blur: 12, spread: spec.text ? undefined : 0, color: "#00000033", ...(value ?? inherited ?? {}), ...patch }, `Changed ${spec.label.toLowerCase()}`, key(spec.path));
  return (
    <Responsive target={target} spec={spec}>
      {shown ? (
        <div className="flex flex-col gap-2">
          <div className={clsx("grid gap-1", spec.text ? "grid-cols-3" : "grid-cols-4")}>
            <NumberInput label="X" value={shown.x} step={1} onChange={(next) => update({ x: next })} className="flex-col items-stretch gap-0.5" />
            <NumberInput label="Y" value={shown.y} step={1} onChange={(next) => update({ y: next })} className="flex-col items-stretch gap-0.5" />
            <NumberInput label="Blur" value={shown.blur} min={0} step={1} onChange={(next) => update({ blur: next })} className="flex-col items-stretch gap-0.5" />
            {!spec.text && <NumberInput label="Spread" value={shown.spread ?? 0} step={1} onChange={(next) => update({ spread: next })} className="flex-col items-stretch gap-0.5" />}
          </div>
          <ColorInput value={shown.color} kit={target.kit} allowClear={false} onChange={(next) => update({ color: next ?? "#00000033" })} />
          <div className="flex items-center justify-between">
            {!spec.text ? (
              <label className="flex items-center gap-2 text-[12px] text-text">
                <input type="checkbox" checked={!!shown.inset} onChange={(event) => update({ inset: event.target.checked || undefined })} /> Inset
              </label>
            ) : (
              <span />
            )}
            <button type="button" onClick={() => set(undefined, `Removed ${spec.label.toLowerCase()}`)} className="text-[12px] font-semibold text-muted hover:text-text">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => update({})} className="h-8 rounded-sm border border-dashed border-line text-[12px] font-semibold text-muted hover:border-accent hover:text-accent">
          Add a {spec.label.toLowerCase()}
        </button>
      )}
    </Responsive>
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
      return <ColorInput value={background.color} kit={kit} allowClear={false} onChange={(next) => onChange({ kind: "color", color: next ?? "transparent" })} />;
    case "gradient": {
      const stops = background.stops;
      const setStop = (index: number, patch: Partial<{ color: string; position: number }>) => onChange({ ...background, stops: stops.map((stop, i) => (i === index ? { ...stop, ...patch } : stop)) });
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Choice label="Gradient type" value={background.type} options={[{ value: "linear", label: "Linear" }, { value: "radial", label: "Radial" }]} onChange={(next) => onChange({ ...background, type: next ?? "linear" })} />
            {background.type === "linear" && <NumberInput label="Angle" value={background.angle ?? 180} min={0} max={360} step={1} onChange={(next) => onChange({ ...background, angle: next })} className="w-28" />}
          </div>
          <div className="h-6 rounded-sm border border-line" style={{ background: `linear-gradient(90deg, ${stops.map((stop) => `${stop.color.startsWith("kit:") ? "#888" : stop.color} ${stop.position}%`).join(", ")})` }} aria-hidden="true" />
          {stops.map((stop, index) => (
            <div key={index} className="flex items-start gap-2">
              <div className="flex-1">
                <ColorInput value={stop.color} kit={kit} allowClear={false} onChange={(next) => setStop(index, { color: next ?? "#000000" })} />
              </div>
              <NumberInput label="%" value={stop.position} min={0} max={100} step={1} onChange={(next) => setStop(index, { position: next })} className="w-24" />
              <button type="button" aria-label="Remove stop" disabled={stops.length <= 2} onClick={() => onChange({ ...background, stops: stops.filter((_, i) => i !== index) })} className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text disabled:opacity-40">
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
          <input type="text" aria-label="Background image" value={background.src} placeholder="/assets/photo.webp" onChange={(event) => onChange({ ...background, src: event.target.value })} className={clsx(controlInputClass, "font-mono text-[12px]")} />
          <div className="grid grid-cols-2 gap-1.5">
            <select aria-label="Size" value={background.size ?? "cover"} onChange={(event) => onChange({ ...background, size: event.target.value as "auto" | "cover" | "contain" })} className={controlInputClass}>
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="auto">Auto</option>
            </select>
            <select aria-label="Repeat" value={background.repeat ?? "no-repeat"} onChange={(event) => onChange({ ...background, repeat: event.target.value as "no-repeat" | "repeat" | "repeat-x" | "repeat-y" })} className={controlInputClass}>
              <option value="no-repeat">No repeat</option>
              <option value="repeat">Repeat</option>
              <option value="repeat-x">Repeat across</option>
              <option value="repeat-y">Repeat down</option>
            </select>
            <select aria-label="Attachment" value={background.attachment ?? "scroll"} onChange={(event) => onChange({ ...background, attachment: event.target.value as "scroll" | "fixed" })} className={controlInputClass}>
              <option value="scroll">Scrolls with the page</option>
              <option value="fixed">Fixed (parallax)</option>
            </select>
            <select aria-label="Position" value={background.focal ? "focal" : (background.position ?? "center center")} onChange={(event) => (event.target.value === "focal" ? onChange({ ...background, focal: { x: 50, y: 50 }, position: undefined }) : onChange({ ...background, position: event.target.value, focal: undefined }))} className={controlInputClass}>
              {["center center", "top left", "top center", "top right", "center left", "center right", "bottom left", "bottom center", "bottom right"].map((position) => (
                <option key={position} value={position}>
                  {position}
                </option>
              ))}
              <option value="focal">Focal point…</option>
            </select>
          </div>
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
          <input type="text" aria-label="Video file" value={background.src} placeholder="/assets/loop.mp4 or https://…" onChange={(event) => onChange({ ...background, src: event.target.value })} className={clsx(controlInputClass, "font-mono text-[12px]")} />
          <input type="text" aria-label="Fallback picture" value={background.poster ?? ""} placeholder="Fallback picture, e.g. /assets/still.webp" onChange={(event) => onChange({ ...background, poster: event.target.value || undefined })} className={clsx(controlInputClass, "font-mono text-[12px]")} />
          <label className="flex items-center gap-2 text-[12px] text-text">
            <input type="checkbox" checked={background.loop !== false} onChange={(event) => onChange({ ...background, loop: event.target.checked })} /> Loop
          </label>
          <label className="flex items-center gap-2 text-[12px] text-text">
            <input type="checkbox" checked={!!background.playOnMobile} onChange={(event) => onChange({ ...background, playOnMobile: event.target.checked || undefined })} /> Play on phones (uses data; the fallback picture shows otherwise)
          </label>
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
    <Responsive target={target} spec={spec}>
      <div className="flex flex-col gap-2">
        <select aria-label={`${spec.label} type`} value={kind} onChange={(event) => set(event.target.value === "" ? undefined : defaultBackground(event.target.value as Background["kind"]), `Changed ${spec.label.toLowerCase()}`)} className={controlInputClass} data-testid="background-kind">
          <option value="">Default</option>
          {BACKGROUND_KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {shown && <BackgroundFields background={shown} kit={target.kit} onChange={(next) => set(next, `Changed ${spec.label.toLowerCase()}`, key(spec.path))} />}
      </div>
    </Responsive>
  );
}

function OverlayControl({ target, path }: { target: ControlTarget; path: Path }) {
  const { value, inherited, set } = useValue<BackgroundOverlay>(target, path, true);
  const shown = value ?? inherited;
  return (
    <Responsive target={target} spec={{ label: "Background overlay", path, responsive: true }}>
      {shown ? (
        <div className="flex flex-col gap-2">
          <select aria-label="Overlay type" value={shown.background.kind} onChange={(event) => set({ ...shown, background: defaultBackground(event.target.value as Background["kind"]) }, "Changed overlay")} className={controlInputClass}>
            {BACKGROUND_KINDS.filter((option) => option.value !== "none" && option.value !== "video").map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <BackgroundFields background={shown.background} kit={target.kit} onChange={(next) => set({ ...shown, background: next }, "Changed overlay", key(path))} />
          <label className="flex items-center gap-2 text-[11px] text-muted">
            Opacity
            <input type="range" min={0} max={100} value={Math.round(shown.opacity * 100)} onChange={(event) => set({ ...shown, opacity: Number(event.target.value) / 100 }, "Changed overlay opacity", key(path))} className="h-1 flex-1" aria-label="Overlay opacity" />
            <span className="w-8 text-right tabular-nums">{Math.round(shown.opacity * 100)}%</span>
          </label>
          <div className="flex items-center justify-between gap-2">
            <select aria-label="Blend mode" value={shown.blend ?? "normal"} onChange={(event) => set({ ...shown, blend: event.target.value === "normal" ? undefined : (event.target.value as BackgroundOverlay["blend"]) }, "Changed blend mode")} className={clsx(controlInputClass, "w-auto flex-1")}>
              {["normal", "multiply", "screen", "overlay", "darken", "lighten", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"].map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => set(undefined, "Removed the overlay")} className="text-[12px] font-semibold text-muted hover:text-text">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => set({ background: { kind: "color", color: "#00000080" }, opacity: 0.5 }, "Added an overlay")} className="h-8 rounded-sm border border-dashed border-line text-[12px] font-semibold text-muted hover:border-accent hover:text-accent">
          Add an overlay
        </button>
      )}
    </Responsive>
  );
}

const WEIGHTS = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];

function TypographyControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "typography" }> }) {
  const base = spec.path;
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
  return (
    <div className="flex flex-col gap-3">
      <Row label="Preset" hint="A site-wide text style. Values below override it for this element only.">
        <div className="flex items-center gap-1.5">
          <select aria-label="Typography preset" value={presetRef} onChange={(event) => target.write([...base, "preset"], event.target.value || undefined, "Changed the text preset")} className={clsx(controlInputClass, presetRef && "text-accent")} data-testid="typography-preset">
            <option value="">None (inherit from the site)</option>
            {presets.map((name) => (
              <option key={name} value={`kit:type.${name}`}>
                {name.toUpperCase().startsWith("H") ? `Heading ${name.slice(1)}` : name.charAt(0).toUpperCase() + name.slice(1)}
              </option>
            ))}
          </select>
          {presetRef && <icons.IconGlobe size={14} className="shrink-0 text-accent" aria-label="Linked to the site kit" />}
        </div>
      </Row>
      <Row label="Font family">
        <FontPicker value={family} kit={target.kit} placeholder={presetRef ? `From the preset (${resolveKitFont(target.kit, target.kit.typography[presetRef.replace("kit:type.", "") as keyof SiteKit["typography"]]?.fontFamily) ?? "site font"})` : "Inherit"} onChange={(next) => target.write([...base, "fontFamily"], next, "Changed the font")} />
      </Row>
      <ControlRenderer target={target} specs={[{ kind: "size", label: "Size", path: [...base, "fontSize"], units: FONT_UNITS, responsive: true, min: 0, fallback: fromPreset.fontSize }]} />
      <div className="grid grid-cols-2 gap-2">
        <ControlRenderer target={target} specs={[{ kind: "select", label: "Weight", path: [...base, "fontWeight"], responsive: true, numeric: true, fallback: fromPreset.fontWeight, options: WEIGHTS.map((weight) => ({ value: weight, label: weight === "400" ? "400 Regular" : weight === "700" ? "700 Bold" : weight })) }]} />
        <ControlRenderer target={target} specs={[{ kind: "select", label: "Transform", path: [...base, "textTransform"], responsive: true, fallback: fromPreset.textTransform, options: [{ value: "none", label: "None" }, { value: "uppercase", label: "UPPERCASE" }, { value: "lowercase", label: "lowercase" }, { value: "capitalize", label: "Capitalize" }] }]} />
        <ControlRenderer target={target} specs={[{ kind: "select", label: "Style", path: [...base, "fontStyle"], responsive: true, options: [{ value: "normal", label: "Normal" }, { value: "italic", label: "Italic" }] }]} />
        <ControlRenderer target={target} specs={[{ kind: "select", label: "Decoration", path: [...base, "textDecoration"], responsive: true, options: [{ value: "none", label: "None" }, { value: "underline", label: "Underline" }, { value: "line-through", label: "Strike" }, { value: "overline", label: "Overline" }] }]} />
      </div>
      <ControlRenderer
        target={target}
        specs={[
          { kind: "size", label: "Line height", path: [...base, "lineHeight"], units: LINE_HEIGHT_UNITS, responsive: true, min: 0, fallback: fromPreset.lineHeight },
          { kind: "size", label: "Letter spacing", path: [...base, "letterSpacing"], units: LETTER_UNITS, responsive: true, fallback: fromPreset.letterSpacing },
          { kind: "size", label: "Word spacing", path: [...base, "wordSpacing"], units: LETTER_UNITS, responsive: true },
          { kind: "choice", label: "Align", path: [...base, "textAlign"], responsive: true, options: [{ value: "left", label: "Left", icon: "AlignLeft" }, { value: "center", label: "Centre", icon: "AlignCenter" }, { value: "right", label: "Right", icon: "AlignRight" }, { value: "justify", label: "Justify", icon: "AlignJustify" }] },
        ]}
      />
    </div>
  );
}

function BorderControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "border" }> }) {
  const base = spec.path;
  void (target.read(base) as Border | undefined);
  return (
    <ControlRenderer
      target={target}
      specs={[
        { kind: "select", label: "Border style", path: [...base, "style"], responsive: true, options: [{ value: "none", label: "None" }, { value: "solid", label: "Solid" }, { value: "dashed", label: "Dashed" }, { value: "dotted", label: "Dotted" }, { value: "double", label: "Double" }] },
        { kind: "sides", label: "Border width", path: [...base, "width"], responsive: true, units: ["px", "em", "rem"] },
        { kind: "color", label: "Border colour", path: [...base, "color"], responsive: true },
        { kind: "corners", label: "Radius", path: [...base, "radius"], responsive: true, units: ["px", "%", "em", "rem"] },
      ]}
    />
  );
}

// --- attributes and CSS (agency) -----------------------------------------------------------------------------------

function AttributesControl({ target, spec }: { target: ControlTarget; spec: Extract<ControlSpec, { kind: "attributes" }> }) {
  const rows = (target.read(spec.path) as { name: string; value: string }[] | undefined) ?? [];
  const update = (next: { name: string; value: string }[]) => target.write(spec.path, next.length ? next : undefined, "Changed attributes", key(spec.path));
  return (
    <Row label={spec.label} hint="Names use letters, digits and dashes; event handlers, href, src, style, class and id are never allowed.">
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
    <Row label={spec.label} htmlFor={id} hint='Write "selector" for this element: selector { color: red } selector:hover { … }. @import, javascript: and off-site url() are removed.'>
      <textarea id={id} value={value} spellCheck={false} onChange={(event) => target.write(spec.path, event.target.value || undefined, "Changed custom CSS", key(spec.path))} className={clsx(controlInputClass, "min-h-28 py-1.5 font-mono text-[12px] leading-relaxed")} />
    </Row>
  );
}

// --- groups and the renderer ---------------------------------------------------------------------------------------

function Group({ label, open = true, children }: { label: string; open?: boolean; children: ReactNode }) {
  const [isOpen, setOpen] = useState(open);
  return (
    <section className="border-b border-line" data-testid={`group-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
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
            return <div key={spec.id}>{spec.render({ read: target.read, write: target.write, editOnPage: target.actions?.editOnPage })}</div>;
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
          case "background":
            return <BackgroundControl key={key(spec.path)} target={target} spec={spec} />;
          case "typography":
            return <TypographyControl key={key(spec.path)} target={target} spec={spec} />;
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
