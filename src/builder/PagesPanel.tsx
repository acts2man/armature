/**
 * The Pages tab for the page builder: the pages coded into the site, then the pages
 * built in the editor, each with its settings; builder pages can also be duplicated and
 * deleted. "New page" asks for a title and an address (checked against every other
 * page) and starts blank, from a starter page or from a saved page template.
 */
import { clsx } from "clsx";
import { useMemo, useState } from "react";
import { IconCopy, IconLayout, IconPage, IconPlus, IconSettings, IconTrash } from "@/components/icons.tsx";
import { Button, Field, Input, Modal, Notice, SrOnly, Textarea, Toggle } from "@/components/ui.tsx";
import type { Element, LayoutDoc, PageSeo, PageSettings } from "@shared/builder/index.ts";
import type { PageDefinition } from "@shared/schema.ts";
import { normalizePath } from "@/visual/pages.ts";
import { isColorValue } from "@kit/values.ts";
import { pathProblem, slugFromTitle, storedPath } from "./pageAddress.ts";
import { STARTER_PAGES, instantiate, type TemplateRow } from "./templates.ts";

type PageEntry = PageDefinition & { builder: boolean };

function PageRow({ entry, active, changed, onOpen, onSettings, onDuplicate, onDelete }: { entry: PageEntry; active: boolean; changed: number; onOpen: () => void; onSettings: () => void; onDuplicate?: () => void; onDelete?: () => void }) {
  return (
    <div className={clsx("group flex min-h-11 items-center gap-1 rounded-sm pr-1", active ? "bg-blue-soft text-blue" : "text-text hover:bg-ground")} data-testid={`page-${entry.slug}`}>
      <button type="button" aria-current={active ? "page" : undefined} onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left">
        {entry.builder ? <IconLayout size={16} className={active ? "text-blue" : "text-muted"} /> : <IconPage size={16} className={active ? "text-blue" : "text-muted"} />}
        <span className="min-w-0">
          <span className={clsx("block truncate text-[13px]", active ? "font-semibold" : "font-medium")}>{entry.label}</span>
          <span className="block truncate font-mono text-[11px] text-muted">{entry.path}</span>
        </span>
      </button>
      {changed > 0 && (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-accent-fg">
          {changed}
          <SrOnly> unpublished changes</SrOnly>
        </span>
      )}
      <button type="button" aria-label={`Settings for ${entry.label}`} onClick={onSettings} className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted opacity-70 hover:bg-panel hover:text-text group-hover:opacity-100" data-testid={`page-settings-${entry.slug}`}>
        <IconSettings size={14} />
      </button>
      {onDuplicate && (
        <button type="button" aria-label={`Duplicate ${entry.label}`} onClick={onDuplicate} className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted opacity-70 hover:bg-panel hover:text-text group-hover:opacity-100">
          <IconCopy size={14} />
        </button>
      )}
      {onDelete && (
        <button type="button" aria-label={`Delete ${entry.label}`} onClick={onDelete} className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted opacity-70 hover:bg-panel hover:text-red group-hover:opacity-100" data-testid={`page-delete-${entry.slug}`}>
          <IconTrash size={14} />
        </button>
      )}
    </div>
  );
}

export type PagesPanelActions = {
  onOpen: (slug: string) => void;
  onCreate: (layout: LayoutDoc) => void;
  onSettings: (slug: string, patch: Partial<LayoutDoc>) => void;
  onDuplicate: (slug: string) => void;
  onDelete: (slug: string) => void;
  onSaveTemplate?: (slug: string) => void;
};

export function PagesPanel({
  coded,
  builderPages,
  layouts,
  activeSlug,
  changedByPage,
  pageTemplates,
  canCreate,
  actions,
}: {
  coded: PageDefinition[];
  builderPages: PageDefinition[];
  layouts: Record<string, LayoutDoc>;
  activeSlug: string;
  changedByPage: Record<string, number>;
  pageTemplates: TemplateRow[];
  /** Clients below the builder level see the pages but cannot add or remove them. */
  canCreate: boolean;
  actions: PagesPanelActions;
}) {
  const [creating, setCreating] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const taken = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of [...coded, ...builderPages]) map.set(normalizePath(page.path), page.label);
    return map;
  }, [coded, builderPages]);
  const all: PageEntry[] = [...coded.filter((page) => page.slug !== "shared").map((page) => ({ ...page, builder: false })), ...builderPages.map((page) => ({ ...page, builder: true }))];
  const settingsPage = all.find((page) => page.slug === settingsFor);
  const deletingPage = all.find((page) => page.slug === deleting);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="pages-panel">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <p className="px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-wide text-muted">Pages in the site's code</p>
        {all
          .filter((page) => !page.builder)
          .map((page) => (
            <PageRow key={page.slug} entry={page} active={page.slug === activeSlug} changed={changedByPage[page.slug] ?? 0} onOpen={() => actions.onOpen(page.slug)} onSettings={() => setSettingsFor(page.slug)} />
          ))}
        <p className="px-2 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wide text-muted">Built here</p>
        {builderPages.length === 0 && <p className="px-2 py-1 text-[12px] text-muted">No pages yet.</p>}
        {all
          .filter((page) => page.builder)
          .map((page) => (
            <PageRow
              key={page.slug}
              entry={page}
              active={page.slug === activeSlug}
              changed={changedByPage[page.slug] ?? 0}
              onOpen={() => actions.onOpen(page.slug)}
              onSettings={() => setSettingsFor(page.slug)}
              onDuplicate={canCreate ? () => actions.onDuplicate(page.slug) : undefined}
              onDelete={canCreate ? () => setDeleting(page.slug) : undefined}
            />
          ))}
      </div>
      {canCreate && (
        <div className="border-t border-line p-3">
          <Button size="sm" className="w-full" onClick={() => setCreating(true)} data-testid="new-page">
            <IconPlus size={15} /> New page
          </Button>
        </div>
      )}
      <NewPageDialog open={creating} taken={taken} existingSlugs={new Set(all.map((page) => page.slug))} pageTemplates={pageTemplates} onClose={() => setCreating(false)} onCreate={(layout) => {
        setCreating(false);
        actions.onCreate(layout);
      }} />
      {settingsPage && (
        <PageSettingsDialog
          page={settingsPage}
          layout={layouts[settingsPage.slug]}
          taken={taken}
          onClose={() => setSettingsFor(null)}
          onSave={(patch) => {
            actions.onSettings(settingsPage.slug, patch);
            setSettingsFor(null);
          }}
          onSaveTemplate={actions.onSaveTemplate ? () => actions.onSaveTemplate?.(settingsPage.slug) : undefined}
        />
      )}
      <Modal
        open={!!deletingPage}
        onClose={() => setDeleting(null)}
        title={`Delete ${deletingPage?.label ?? "this page"}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => {
              if (deleting) actions.onDelete(deleting);
              setDeleting(null);
            }} data-testid="page-delete-confirm">
              Delete page
            </Button>
          </>
        }
      >
        <p className="text-[14px] leading-relaxed text-text">The page leaves the site when you publish. Until then you can undo it.</p>
      </Modal>
    </div>
  );
}

function NewPageDialog({ open, taken, existingSlugs, pageTemplates, onClose, onCreate }: { open: boolean; taken: Map<string, string>; existingSlugs: Set<string>; pageTemplates: TemplateRow[]; onClose: () => void; onCreate: (layout: LayoutDoc) => void }) {
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [pathTouched, setPathTouched] = useState(false);
  const [start, setStart] = useState("blank");
  const autoPath = title ? `/${slugFromTitle(title)}/` : "";
  const shownPath = pathTouched ? path : autoPath;
  const problem = !title.trim() ? null : pathProblem(shownPath, taken);
  const valid = title.trim().length > 0 && !!shownPath && !problem;
  const reset = () => {
    setTitle("");
    setPath("");
    setPathTouched(false);
    setStart("blank");
  };
  const create = () => {
    if (!valid) return;
    let slug = slugFromTitle(shownPath.replace(/\//g, "-")) || slugFromTitle(title) || "page";
    let n = 2;
    while (existingSlugs.has(slug)) slug = `${slugFromTitle(shownPath.replace(/\//g, "-"))}-${n++}`;
    const template = pageTemplates.find((row) => row.id === start);
    const starter = STARTER_PAGES.find((item) => item.id === start);
    const root: Element[] = template ? instantiate(template.content.root) : (starter ?? STARTER_PAGES[0]!).build();
    const normalized = storedPath(shownPath);
    onCreate({ version: 1, pageSlug: slug, path: normalized, label: title.trim().slice(0, 120), seo: template?.content.seo, pageSettings: template?.content.pageSettings, root });
    reset();
  };
  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New page"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!valid} data-testid="new-page-create">
            Create page
          </Button>
        </>
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(event) => {
        event.preventDefault();
        create();
      }}>
        <Field label="Title" htmlFor="new-page-title" hint="Shown in the browser tab and in the Pages list.">
          <Input id="new-page-title" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} autoFocus />
        </Field>
        <Field label="Address" htmlFor="new-page-path" error={problem} hint="Where the page lives on the site.">
          <Input id="new-page-path" value={shownPath} onChange={(event) => {
            setPathTouched(true);
            setPath(event.target.value);
          }} className="font-mono" placeholder="/about-us/" />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-semibold text-text">Start from</legend>
          {[...STARTER_PAGES.map((item) => ({ id: item.id, name: item.name, description: item.description })), ...pageTemplates.map((row) => ({ id: row.id, name: row.name, description: `Saved template · ${row.element_count} elements${row.first_heading ? ` · "${row.first_heading}"` : ""}` }))].map((option) => (
            <label key={option.id} className={clsx("flex cursor-pointer items-start gap-3 rounded-[10px] border px-3 py-2.5", start === option.id ? "border-accent bg-blue-soft" : "border-line hover:bg-ground")}>
              <input type="radio" name="new-page-start" checked={start === option.id} onChange={() => setStart(option.id)} className="mt-1" />
              <span>
                <span className="block text-[14px] font-semibold text-text">{option.name}</span>
                <span className="block text-[12px] text-muted">{option.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}

function PageSettingsDialog({ page, layout, taken, onClose, onSave, onSaveTemplate }: { page: PageEntry; layout: LayoutDoc | undefined; taken: Map<string, string>; onClose: () => void; onSave: (patch: Partial<LayoutDoc>) => void; onSaveTemplate?: () => void }) {
  const [label, setLabel] = useState(layout?.label ?? page.label);
  const [path, setPath] = useState(layout?.path ?? page.path);
  const [seo, setSeo] = useState<PageSeo>(layout?.seo ?? {});
  const [settings, setSettings] = useState<PageSettings>(layout?.pageSettings ?? {});
  const problem = page.builder ? pathProblem(path, taken, page.label) : null;
  const backgroundProblem = settings.bodyBackground && !isColorValue(settings.bodyBackground) ? "Use a colour such as #f3efe6." : null;
  const clean = <T extends object>(value: T): T | undefined => {
    const entries = Object.entries(value).filter(([, inner]) => inner !== undefined && inner !== "" && inner !== false && inner !== null);
    return entries.length ? (Object.fromEntries(entries) as T) : undefined;
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`${page.label}: page settings`}
      footer={
        <>
          {onSaveTemplate && (
            <Button variant="secondary" onClick={onSaveTemplate}>
              Save as template
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!problem || !!backgroundProblem || (page.builder && !label.trim())} onClick={() => onSave({ ...(page.builder ? { label: label.trim(), path: storedPath(path) } : {}), seo: clean(seo), pageSettings: clean(settings) })} data-testid="page-settings-save">
            Save settings
          </Button>
        </>
      }
    >
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        {page.builder ? (
          <>
            <Field label="Title" htmlFor="page-title">
              <Input id="page-title" value={label} maxLength={120} onChange={(event) => setLabel(event.target.value)} />
            </Field>
            <Field label="Address" htmlFor="page-path" error={problem}>
              <Input id="page-path" value={path} onChange={(event) => setPath(event.target.value)} className="font-mono" />
            </Field>
          </>
        ) : (
          <Notice kind="info" title="A page coded into the site">
            Its title and address come from the site's code. The settings below apply to it.
          </Notice>
        )}
        <p className="text-[12px] font-bold uppercase tracking-wide text-muted">Search and sharing</p>
        <Field label="Title in search results" htmlFor="page-seo-title" hint="Up to about 60 characters. Empty uses the page title.">
          <Input id="page-seo-title" value={seo.title ?? ""} maxLength={200} onChange={(event) => setSeo({ ...seo, title: event.target.value || undefined })} />
        </Field>
        <Field label="Description" htmlFor="page-seo-description" hint="One or two sentences, up to about 160 characters.">
          <Textarea id="page-seo-description" value={seo.description ?? ""} maxLength={500} onChange={(event) => setSeo({ ...seo, description: event.target.value || undefined })} className="min-h-20" />
        </Field>
        <Field label="Sharing picture" htmlFor="page-seo-image" hint="A picture on this site (/assets/...) or an https:// address, shown when the page is shared.">
          <Input id="page-seo-image" value={seo.ogImage ?? ""} onChange={(event) => setSeo({ ...seo, ogImage: event.target.value || undefined })} className="font-mono" />
        </Field>
        <label className="flex items-center justify-between gap-3 text-[14px] text-text">
          Hide from search engines
          <Toggle checked={!!seo.noindex} onChange={(next) => setSeo({ ...seo, noindex: next || undefined })} label="Hide from search engines" />
        </label>
        <p className="text-[12px] font-bold uppercase tracking-wide text-muted">Layout</p>
        <label className="flex items-center justify-between gap-3 text-[14px] text-text">
          Full canvas (hide the site's header and footer)
          <Toggle checked={!!settings.fullCanvas} onChange={(next) => setSettings({ ...settings, fullCanvas: next || undefined })} label="Full canvas" />
        </label>
        <label className="flex items-center justify-between gap-3 text-[14px] text-text">
          Hide the page title
          <Toggle checked={!!settings.hideTitle} onChange={(next) => setSettings({ ...settings, hideTitle: next || undefined })} label="Hide the page title" />
        </label>
        <Field label="Page background" htmlFor="page-background" error={backgroundProblem} hint="A colour such as #f3efe6. Empty uses the site's page background.">
          <Input id="page-background" value={settings.bodyBackground ?? ""} onChange={(event) => setSettings({ ...settings, bodyBackground: event.target.value || undefined })} className="font-mono" />
        </Field>
      </div>
    </Modal>
  );
}
