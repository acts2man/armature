/**
 * Site settings: the site kit (content/site-kit.json) edited with the same controls as
 * elements. Global colours and fonts, the text styles (H1 to H6, body, small, button),
 * the three button styles, links, form fields, the content width and breakpoints.
 * Everything linked to the kit (a "kit:color.primary" reference) follows these values.
 */
import { clsx } from "clsx";
import { useMemo, useState } from "react";
import { IconPlus, IconTrash } from "@/components/icons.tsx";
import type { Device, SiteKit } from "@shared/builder/index.ts";
import { ControlRenderer, type ControlTarget } from "./controls/ControlRenderer.tsx";
import { FontPicker } from "./controls/FontPicker.tsx";
import { controlInputClass } from "./controls/inputs.tsx";
import { readAt } from "./controls/path.ts";
import type { ControlSpec, Path } from "./controls/types.ts";
import { isGoogleFont, withKitFont } from "./fonts.ts";

type Write = (path: Path, value: unknown, label: string, group?: string) => void;

const TYPE_PRESETS = [
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" },
  { value: "h5", label: "Heading 5" },
  { value: "h6", label: "Heading 6" },
  { value: "body", label: "Body text" },
  { value: "small", label: "Small text" },
  { value: "button", label: "Buttons" },
] as const;

const BUTTON_PRESETS = [
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
  { value: "outline", label: "Outline" },
] as const;

const WEIGHTS = ["300", "400", "500", "600", "700", "800", "900"].map((weight) => ({ value: weight, label: weight }));

const presetSpecs = (name: string): ControlSpec[] => [
  { kind: "font", label: "Font", path: ["typography", name, "fontFamily"] },
  { kind: "size", label: "Size", path: ["typography", name, "fontSize"], responsive: true, units: ["px", "em", "rem"], min: 6, max: 200 },
  { kind: "select", label: "Weight", path: ["typography", name, "fontWeight"], numeric: true, custom: { min: 1, max: 1000 }, options: WEIGHTS },
  { kind: "size", label: "Line height", path: ["typography", name, "lineHeight"], units: ["", "px", "em"], min: 0 },
  { kind: "size", label: "Letter spacing", path: ["typography", name, "letterSpacing"], units: ["px", "em"] },
  { kind: "select", label: "Transform", path: ["typography", name, "textTransform"], options: [{ value: "none", label: "None" }, { value: "uppercase", label: "UPPERCASE" }, { value: "lowercase", label: "lowercase" }, { value: "capitalize", label: "Capitalize" }] },
];

const buttonSpecs = (name: string): ControlSpec[] => [
  { kind: "color", label: "Background", path: ["buttons", name, "background"], required: true },
  { kind: "color", label: "Text colour", path: ["buttons", name, "color"], required: true },
  { kind: "size", label: "Border width", path: ["buttons", name, "borderWidth"], units: ["px"], min: 0, max: 20 },
  { kind: "color", label: "Border colour", path: ["buttons", name, "borderColor"] },
  { kind: "size", label: "Corner radius", path: ["buttons", name, "radius"], units: ["px", "em", "rem"], min: 0, max: 200 },
  { kind: "sides", label: "Padding", path: ["buttons", name, "padding"], units: ["px"] },
  { kind: "note", text: "On hover" },
  { kind: "color", label: "Hover background", path: ["buttons", name, "hover", "background"] },
  { kind: "color", label: "Hover text colour", path: ["buttons", name, "hover", "color"] },
  { kind: "color", label: "Hover border colour", path: ["buttons", name, "hover", "borderColor"] },
];

const customId = (label: string, taken: string[]) => {
  let id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "colour";
  let n = 2;
  while (taken.includes(id)) id = `${id.replace(/-\d+$/, "")}-${n++}`;
  return id;
};

function CustomColours({ kit, write }: { kit: SiteKit; write: Write }) {
  const colours = kit.colors.custom;
  const update = (next: SiteKit["colors"]["custom"], label: string, group?: string) => write(["colors", "custom"], next, label, group);
  return (
    <div className="flex flex-col gap-1.5" data-testid="custom-colours">
      <span className="text-[12px] font-semibold text-muted">Custom colours</span>
      {colours.map((colour, index) => (
        <div key={colour.id} className="flex items-center gap-1.5">
          <label className="relative h-8 w-8 shrink-0 cursor-pointer rounded-sm border border-line" style={{ background: colour.value }} title="Pick a colour">
            <input type="color" aria-label={`${colour.label} colour`} value={/^#[0-9a-f]{6}/i.test(colour.value) ? colour.value.slice(0, 7) : "#000000"} onChange={(event) => update(colours.map((c, i) => (i === index ? { ...c, value: event.target.value } : c)), `Changed ${colour.label}`, `custom-colour-${colour.id}`)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          </label>
          <input type="text" aria-label="Colour name" value={colour.label} maxLength={40} onChange={(event) => update(colours.map((c, i) => (i === index ? { ...c, label: event.target.value } : c)), "Renamed a site colour", `custom-colour-name-${colour.id}`)} className={clsx(controlInputClass, "min-w-0 flex-1")} />
          <button type="button" aria-label={`Remove ${colour.label}`} onClick={() => update(colours.filter((_, i) => i !== index), `Removed the colour ${colour.label}`)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text">
            <IconTrash size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={colours.length >= 30}
        onClick={() => {
          const label = `Colour ${colours.length + 1}`;
          update([...colours, { id: customId(label, colours.map((c) => c.id)), label, value: "#888888" }], "Added a site colour");
        }}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-sm border border-dashed border-line text-[12px] font-semibold text-muted hover:border-accent hover:text-accent disabled:opacity-40"
        data-testid="add-colour"
      >
        <IconPlus size={13} /> Add a colour
      </button>
      <p className="text-[11px] leading-relaxed text-muted">Elements that use a site colour change with it. Removing one leaves those elements with their theme default.</p>
    </div>
  );
}

function CustomFonts({ kit, write }: { kit: SiteKit; write: Write }) {
  const fonts = kit.fonts.custom;
  return (
    <div className="flex flex-col gap-1.5" data-testid="custom-fonts">
      <span className="text-[12px] font-semibold text-muted">Fonts the site loads</span>
      {fonts.length === 0 && <p className="text-[12px] text-muted">None yet. Choosing a Google font anywhere adds it here.</p>}
      {fonts.map((font, index) => (
        <div key={font.id} className="flex items-center justify-between gap-1.5 rounded-sm border border-line px-2 py-1.5">
          <span className="truncate text-[13px] text-text" style={{ fontFamily: `"${font.family}"` }}>
            {font.family}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{font.source === "google" ? "Google" : "System"}</span>
            <button type="button" aria-label={`Remove ${font.family}`} onClick={() => write(["fonts", "custom"], fonts.filter((_, i) => i !== index), `Removed the font ${font.family}`)} className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text">
              <IconTrash size={13} />
            </button>
          </span>
        </div>
      ))}
      <FontPicker value={undefined} kit={kit} siteFonts={false} allowInherit={false} placeholder="Add a font" onChange={(family) => {
          if (!family || fonts.some((font) => font.family === family) || fonts.length >= 20) return;
          const next = isGoogleFont(family) ? withKitFont(kit, family).fonts.custom : [...fonts, { id: customId(family, fonts.map((font) => font.id)), family, source: "system" as const }];
          write(["fonts", "custom"], next, `Added the font ${family}`);
        }} />
    </div>
  );
}

export function SiteSettingsPanel({ kit, write, device, onDevice, isStaff }: { kit: SiteKit; write: Write; device: Device; onDevice: (device: Device) => void; isStaff: boolean }) {
  const [preset, setPreset] = useState<string>("h1");
  const [button, setButton] = useState<string>("primary");
  const target = useMemo<ControlTarget>(() => ({ read: (path) => readAt(kit, path), write, device, onDevice, kit, isStaff }), [kit, write, device, onDevice, isStaff]);

  const specs: ControlSpec[] = [
    {
      kind: "group",
      label: "Global colours",
      controls: [
        { kind: "color", label: "Primary", path: ["colors", "primary"], noKit: true, required: true },
        { kind: "color", label: "Secondary", path: ["colors", "secondary"], noKit: true, required: true },
        { kind: "color", label: "Text", path: ["colors", "text"], noKit: true, required: true },
        { kind: "color", label: "Accent", path: ["colors", "accent"], noKit: true, required: true },
        { kind: "color", label: "Page background", path: ["pageBackground"], required: true },
      ],
    },
    {
      kind: "group",
      label: "Global fonts",
      controls: [
        { kind: "font", label: "Headings", path: ["fonts", "heading"], noKit: true, required: true },
        { kind: "font", label: "Body", path: ["fonts", "body"], noKit: true, required: true },
      ],
    },
  ];

  return (
    <div className="dense-controls min-h-0 flex-1 overflow-y-auto" data-testid="site-settings">
      <p className="px-5 pb-2 text-[12px] leading-relaxed text-muted">The site's colours, fonts and text styles. Changes show on every page and publish with the rest.</p>
      <ControlRenderer target={target} specs={specs.slice(0, 1)} />
      <div className="border-b border-line px-5 pb-4">
        <CustomColours kit={kit} write={write} />
      </div>
      <ControlRenderer target={target} specs={specs.slice(1)} />
      <div className="border-b border-line px-5 pb-4">
        <CustomFonts kit={kit} write={write} />
      </div>
      <ControlRenderer
        target={target}
        specs={[
          {
            kind: "group",
            label: "Text styles",
            open: false,
            controls: [
              {
                kind: "custom",
                id: "preset-picker",
                render: () => (
                  <select aria-label="Text style" value={preset} onChange={(event) => setPreset(event.target.value)} className={controlInputClass} data-testid="preset-picker">
                    {TYPE_PRESETS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ),
              },
              { kind: "if", id: `preset-${preset}`, when: () => true, controls: presetSpecs(preset) },
            ],
          },
          {
            kind: "group",
            label: "Buttons",
            open: false,
            controls: [
              {
                kind: "custom",
                id: "button-picker",
                render: () => (
                  <select aria-label="Button style" value={button} onChange={(event) => setButton(event.target.value)} className={controlInputClass} data-testid="button-picker">
                    {BUTTON_PRESETS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ),
              },
              { kind: "if", id: `button-${button}`, when: () => true, controls: buttonSpecs(button) },
            ],
          },
          {
            kind: "group",
            label: "Links",
            open: false,
            controls: [
              { kind: "color", label: "Link colour", path: ["links", "color"], required: true },
              { kind: "color", label: "Link hover colour", path: ["links", "hover"], required: true },
            ],
          },
          {
            kind: "group",
            label: "Form fields",
            open: false,
            controls: [
              { kind: "color", label: "Field background", path: ["forms", "fieldBackground"], required: true },
              { kind: "color", label: "Field border", path: ["forms", "fieldBorder"], required: true },
              { kind: "color", label: "Field text", path: ["forms", "fieldText"], required: true },
              { kind: "size", label: "Field radius", path: ["forms", "fieldRadius"], units: ["px", "em", "rem"], min: 0, max: 100 },
            ],
          },
          {
            kind: "group",
            label: "Layout",
            open: false,
            controls: [
              { kind: "size", label: "Content width", path: ["container", "contentWidth"], units: ["px", "%", "vw", "rem"], min: 300, max: 3000, hint: "How wide boxed containers are." },
              { kind: "sides", label: "Container padding", path: ["container", "padding"], units: ["px", "em", "rem"] },
              { kind: "size", label: "Gap between items", path: ["container", "gap"], units: ["px", "em", "rem"], min: 0, max: 200 },
              { kind: "size", label: "Picture corners", path: ["imageRadius"], units: ["px", "%", "em", "rem"], min: 0, max: 200 },
              { kind: "number", label: "Tablet from (px)", path: ["breakpoints", "tablet"], min: 600, max: 1600, hint: "Screens this wide or narrower use tablet values." },
              { kind: "number", label: "Mobile from (px)", path: ["breakpoints", "mobile"], min: 320, max: 1000, hint: "Screens this wide or narrower use mobile values." },
            ],
          },
        ]}
      />
    </div>
  );
}
