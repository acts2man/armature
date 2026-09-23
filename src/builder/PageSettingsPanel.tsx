/**
 * Page settings in the left panel (opened from the top bar's page-name chevron or the
 * Page settings button): the current page's SEO title, description, sharing picture,
 * hide-from-search, hide title, full canvas and background. A Save button applies the
 * change as one undo step. Builder pages also edit their title and address.
 */
import { useState } from "react";
import { IconGrid } from "@/components/icons.tsx";
import { Button, Field, Input, Notice, Textarea, Toggle } from "@/components/ui.tsx";
import { isColorValue } from "@kit/values.ts";
import type { LayoutDoc, PageSeo, PageSettings } from "@shared/builder/index.ts";
import type { PageDefinition } from "@shared/schema.ts";
import { pathProblem, storedPath } from "./pageAddress.ts";

export function PageSettingsPanel({
  page,
  layout,
  isBuilderPage,
  taken,
  onClose,
  onSave,
  onDuplicate,
  onDelete,
}: {
  page: PageDefinition;
  layout: LayoutDoc | undefined;
  isBuilderPage: boolean;
  /** Every other page's address, so a builder page's new address can be checked. */
  taken: Map<string, string>;
  onClose: () => void;
  onSave: (patch: Partial<LayoutDoc>) => void;
  /** Builder pages can be duplicated and deleted (agency staff and the builder level). */
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const [label, setLabel] = useState(layout?.label ?? page.label);
  const [path, setPath] = useState(layout?.path ?? page.path);
  const [seo, setSeo] = useState<PageSeo>(layout?.seo ?? {});
  const [settings, setSettings] = useState<PageSettings>(layout?.pageSettings ?? {});
  const problem = isBuilderPage ? pathProblem(path, taken, page.label) : null;
  const backgroundProblem = settings.bodyBackground && !isColorValue(settings.bodyBackground) ? "Use a colour such as #f3efe6." : null;
  const clean = <T extends object>(value: T): T | undefined => {
    const entries = Object.entries(value).filter(([, inner]) => inner !== undefined && inner !== "" && inner !== false && inner !== null);
    return entries.length ? (Object.fromEntries(entries) as T) : undefined;
  };
  const disabled = !!problem || !!backgroundProblem || (isBuilderPage && !label.trim());

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="page-settings-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 pb-3 pt-3">
        <button type="button" onClick={onClose} aria-label="Back to Elements" title="Back to Elements" data-testid="page-settings-back" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-ground hover:text-text">
          <IconGrid size={18} />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-display text-[16px] font-semibold text-text">Page settings</h2>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {isBuilderPage ? (
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
        {isBuilderPage && (onDuplicate || onDelete) && (
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-[12px] font-bold uppercase tracking-wide text-muted">This page</p>
            {onDuplicate && (
              <Button variant="secondary" size="sm" onClick={onDuplicate} data-testid="page-duplicate">
                Duplicate this page
              </Button>
            )}
            {onDelete && (
              <Button variant="danger" size="sm" onClick={onDelete} data-testid="page-delete">
                Delete this page
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="border-t border-line p-3">
        <Button
          size="sm"
          className="w-full"
          disabled={disabled}
          data-testid="page-settings-save"
          onClick={() => onSave({ ...(isBuilderPage ? { label: label.trim(), path: storedPath(path) } : {}), seo: clean(seo), pageSettings: clean(settings) })}
        >
          Save settings
        </Button>
      </div>
    </div>
  );
}
