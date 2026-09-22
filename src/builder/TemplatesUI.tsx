/**
 * Saving and finding templates. "Save as template" names a section or a page and keeps
 * it for this site, or (agency staff) for every site of the agency. The library shows
 * each as a card (kind, how many elements, its first heading), searchable, to insert or
 * delete. Thumbnails are placeholder cards by design (docs/BUILDER_SPEC.md, section 5).
 */
import { clsx } from "clsx";
import { useState } from "react";
import { IconLayout, IconSearch, IconTemplate, IconTrash } from "@/components/icons.tsx";
import { Button, Field, Input, Modal } from "@/components/ui.tsx";
import type { TemplateKind, TemplateRow } from "./templates.ts";

export function SaveTemplateDialog({ open, kind, defaultName, isStaff, onClose, onSave }: { open: boolean; kind: TemplateKind; defaultName: string; isStaff: boolean; onClose: () => void; onSave: (name: string, scope: "site" | "agency") => Promise<string | null> }) {
  const [name, setName] = useState(defaultName);
  const [scope, setScope] = useState<"site" | "agency">("site");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const problem = await onSave(name.trim(), scope);
    setSaving(false);
    if (problem) setError(problem);
    else onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kind === "page" ? "Save this page as a template" : "Save as a template"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!name.trim()} data-testid="template-save">
            Save template
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}>
        <Field label="Name" htmlFor="template-name" error={error}>
          <Input id="template-name" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        {isStaff && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-semibold text-text">Available on</legend>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="radio" name="template-scope" checked={scope === "site"} onChange={() => setScope("site")} /> This site
            </label>
            <label className="flex items-center gap-2 text-[14px]">
              <input type="radio" name="template-scope" checked={scope === "agency"} onChange={() => setScope("agency")} /> Every site of the agency
            </label>
          </fieldset>
        )}
        <p className="text-[13px] text-muted">{kind === "page" ? "New pages can start from it." : "It appears under Saved templates in the Elements panel."}</p>
      </form>
    </Modal>
  );
}

export function TemplateLibrary({ open, templates, canDelete, onClose, onInsert, onDelete }: { open: boolean; templates: TemplateRow[]; canDelete: (row: TemplateRow) => boolean; onClose: () => void; onInsert: (row: TemplateRow) => void; onDelete: (row: TemplateRow) => void }) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = templates.filter((row) => row.kind === "section" && (!needle || row.name.toLowerCase().includes(needle) || (row.first_heading ?? "").toLowerCase().includes(needle)));
  return (
    <Modal open={open} onClose={onClose} title="Template library">
      <div className="flex flex-col gap-3" data-testid="template-library">
        <div className="relative">
          <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" aria-label="Search templates" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search templates" className="h-9 w-full rounded-control border border-line pl-8 pr-3 text-[13px]" />
        </div>
        {shown.length === 0 && <p className="py-6 text-center text-[13px] text-muted">{templates.length === 0 ? "No saved sections yet. Right-click a section on the page and choose Save as template." : `Nothing matches "${query}".`}</p>}
        <ul className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto">
          {shown.map((row) => (
            <li key={row.id} className="flex flex-col rounded-[10px] border border-line" data-testid="template-card">
              <div className={clsx("flex h-20 flex-col justify-center gap-1 rounded-t-[10px] bg-ground px-3")}>
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  {row.kind === "page" ? <IconLayout size={12} /> : <IconTemplate size={12} />} {row.kind === "page" ? "Page" : "Section"} · {row.element_count} elements
                </span>
                <span className="truncate font-display text-[15px] text-text">{row.first_heading ?? "No heading"}</span>
              </div>
              <div className="flex items-center justify-between gap-1 px-3 py-2">
                <span className="min-w-0 truncate text-[13px] font-semibold text-text">{row.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {canDelete(row) && (
                    <button type="button" aria-label={`Delete ${row.name}`} onClick={() => onDelete(row)} className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-red">
                      <IconTrash size={13} />
                    </button>
                  )}
                  <Button size="sm" onClick={() => onInsert(row)}>
                    Insert
                  </Button>
                </span>
              </div>
              {row.site_id === null && <span className="px-3 pb-2 text-[11px] text-muted">For every site</span>}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
