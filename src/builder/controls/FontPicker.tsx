/**
 * The font picker: the site's kit fonts, a curated Google Fonts list and the system
 * stacks, searchable, each option previewed in its own face. Choosing a Google font
 * loads its stylesheet in the editor for the preview; the kit loads it on the site.
 */
import { clsx } from "clsx";
import { useEffect, useId, useMemo, useState } from "react";
import { IconChevronDown, IconGlobe } from "@/components/icons.tsx";
import type { SiteKit } from "@shared/builder/index.ts";
import { resolveKitFont } from "@kit/values.ts";
import { GOOGLE_FONTS, isGoogleFont, SYSTEM_FONTS } from "../fonts.ts";
import { controlInputClass } from "./inputs.tsx";

const loaded = new Set<string>();
/** Load a Google font in the editor (preview only). Never runs inside the site. */
export function loadGoogleFont(family: string): void {
  if (loaded.has(family) || typeof document === "undefined") return;
  loaded.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;600;700&display=swap`;
  document.head.appendChild(link);
}

export function FontPicker({ value, kit, onChange, placeholder, siteFonts = true, allowInherit = true }: { value: string | undefined; kit: SiteKit; onChange: (next: string | undefined) => void; placeholder?: string; /** Offer the kit's own fonts (not when editing the kit's heading and body fonts). */ siteFonts?: boolean; allowInherit?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const id = useId();
  const shownName = value?.startsWith("kit:") ? `${(resolveKitFont(kit, value) ?? "site font")} (site ${value.replace("kit:font.", "")} font)` : (value ?? "");
  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const kitFonts = !siteFonts ? [] : [
      { value: "kit:font.heading", label: `Site heading font (${kit.fonts.heading})`, family: kit.fonts.heading, group: "Site" },
      { value: "kit:font.body", label: `Site body font (${kit.fonts.body})`, family: kit.fonts.body, group: "Site" },
      ...kit.fonts.custom.map((font) => ({ value: `kit:font.custom.${font.id}`, label: `${font.family} (site)`, family: font.family, group: "Site" })),
    ];
    const google = GOOGLE_FONTS.map((family) => ({ value: family, label: family, family, group: "Google Fonts" }));
    const system = SYSTEM_FONTS.map((family) => ({ value: family, label: family, family, group: "System" }));
    return [...kitFonts, ...google, ...system].filter((option) => !needle || option.label.toLowerCase().includes(needle));
  }, [kit, query, siteFonts]);
  useEffect(() => {
    if (!open) return;
    for (const option of options) if (option.group === "Google Fonts") loadGoogleFont(option.family);
  }, [open, options]);
  useEffect(() => {
    if (value && isGoogleFont(value)) loadGoogleFont(value);
  }, [value]);
  return (
    <div className="relative" data-testid="font-picker">
      <button type="button" id={id} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} className={clsx(controlInputClass, "flex items-center justify-between gap-2 text-left")} style={{ fontFamily: value && !value.startsWith("kit:") ? `"${value}"` : undefined }}>
        <span className={clsx("truncate", !value && "text-muted", value?.startsWith("kit:") && "text-accent")}>{shownName || placeholder || "Inherit"}</span>
        <span className="flex shrink-0 items-center gap-1 text-muted">
          {value?.startsWith("kit:") && <IconGlobe size={12} className="text-accent" />}
          <IconChevronDown size={14} />
        </span>
      </button>
      {open && (
        <div className="toast-in absolute left-0 right-0 top-9 z-30 flex max-h-72 flex-col rounded-[10px] border border-line bg-panel shadow-pop">
          <input type="search" autoFocus aria-label="Search fonts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search fonts" className="m-1.5 h-8 rounded-sm border border-line px-2 text-[12px]" onKeyDown={(event) => event.key === "Escape" && setOpen(false)} />
          <ul role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
            {allowInherit && <li>
              <button type="button" role="option" aria-selected={!value} onClick={() => { onChange(undefined); setOpen(false); }} className="flex h-8 w-full items-center rounded-sm px-2 text-left text-[12px] text-muted hover:bg-ground">
                Inherit
              </button>
            </li>}
            {options.map((option) => (
              <li key={option.value}>
                <button type="button" role="option" aria-selected={option.value === value} onClick={() => { onChange(option.value); setOpen(false); }} className={clsx("flex h-8 w-full items-center justify-between rounded-sm px-2 text-left text-[13px] hover:bg-ground", option.value === value && "bg-blue-soft text-accent")} style={{ fontFamily: `"${option.family}"` }}>
                  <span className="truncate">{option.label}</span>
                  <span className="ml-2 shrink-0 font-sans text-[10px] uppercase tracking-wide text-muted">{option.group}</span>
                </button>
              </li>
            ))}
            {options.length === 0 && <li className="px-2 py-3 text-[12px] text-muted">No font matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
