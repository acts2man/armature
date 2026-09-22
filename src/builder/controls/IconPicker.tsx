/**
 * The icon picker: every lucide icon (MIT), searchable by name, previewed inline. The
 * chosen icon's SVG nodes are saved into the element, so the site needs no icon library.
 * The icon set loads on first open, so it never weighs on the editor's first paint.
 */
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import { IconX } from "@/components/icons.tsx";
import type { IconValue } from "@shared/builder/index.ts";
import { Icon } from "@kit/icon.tsx";
import { controlInputClass } from "./inputs.tsx";

type LucideNode = [string, Record<string, string | number>];
type IconSet = Record<string, LucideNode[]>;

let iconSet: Promise<IconSet> | null = null;
/** The lucide icon set, fetched once. */
export const loadIcons = (): Promise<IconSet> => (iconSet ??= import("lucide").then((module) => module.icons as unknown as IconSet));

export function toIconValue(name: string, nodes: LucideNode[] | undefined): IconValue | null {
  if (!nodes) return null;
  return { name, nodes: nodes.map(([tag, attributes]) => [tag, Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k, String(v)]))]) };
}

export function IconPicker({ value, onChange }: { value: IconValue | null; onChange: (next: IconValue | null) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [icons, setIcons] = useState<IconSet | null>(null);
  useEffect(() => {
    if (!open || icons) return;
    let live = true;
    void loadIcons().then((set) => live && setIcons(set));
    return () => {
      live = false;
    };
  }, [open, icons]);
  const names = useMemo(() => (icons ? Object.keys(icons) : []), [icons]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/[\s_-]+/g, "");
    const list = needle ? names.filter((name) => name.toLowerCase().includes(needle)) : names;
    return list.slice(0, 120);
  }, [query, names]);
  return (
    <div className="flex flex-col gap-2" data-testid="icon-picker">
      <div className="flex items-center gap-2">
        <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)} className={clsx(controlInputClass, "flex items-center gap-2 text-left")}>
          <span className="inline-flex h-5 w-5 items-center justify-center text-text">{value ? <Icon icon={value} size={18} /> : <span className="h-4 w-4 rounded-sm border border-dashed border-line" />}</span>
          <span className={clsx("truncate", !value && "text-muted")}>{value ? value.name : "Choose an icon"}</span>
        </button>
        {value && (
          <button type="button" aria-label="Remove the icon" onClick={() => onChange(null)} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text">
            <IconX size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-panel p-2 shadow-pop">
          <input type="search" autoFocus aria-label="Search icons" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={icons ? `Search ${names.length} icons` : "Loading icons…"} className="h-8 rounded-sm border border-line px-2 text-[12px]" onKeyDown={(event) => event.key === "Escape" && setOpen(false)} />
          <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto" role="listbox" aria-label="Icons" aria-busy={!icons}>
            {icons &&
              matches.map((name) => {
                const candidate = toIconValue(name, icons[name]);
                if (!candidate) return null;
                return (
                  <button key={name} type="button" role="option" aria-selected={value?.name === name} title={name} onClick={() => { onChange(candidate); setOpen(false); }} className={clsx("inline-flex h-9 items-center justify-center rounded-sm text-text hover:bg-ground", value?.name === name && "bg-blue-soft text-accent")}>
                    <Icon icon={candidate} size={18} />
                  </button>
                );
              })}
          </div>
          <p className="text-[11px] text-muted">Icons by lucide (MIT). {matches.length >= 120 ? "Type to narrow the list." : ""}</p>
        </div>
      )}
    </div>
  );
}
