/**
 * /sites/:siteId/media — the Media Library, WordPress style: every picture and video on
 * the site as a grid or a list, upload by button or by dropping files anywhere on the
 * screen (the same rules as a picture added in the editor), search, a filter by type,
 * and a details panel (preview, file name, size, dimensions, editable description, the
 * pages that use it, copy link, delete). A deletion of a picture that pages still use is
 * allowed only after a clear warning naming those pages. Every change is one publish.
 */
import { clsx } from "clsx";
import { useEffect, useId, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { IconCheck, IconCopy, IconGrid, IconImage, IconListBullet, IconSearch, IconTrash, IconUpload, IconVideo, IconX } from "@/components/icons.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { SiteStoragePanel } from "@/components/SiteStoragePanel.tsx";
import { Button, Drawer, EmptyState, Field, IconButton, Input, Modal, Notice, PageHeader, Pill, Segmented, Select, Skeleton, SrOnly, Textarea, useToast } from "@/components/ui.tsx";
import { formatBytes, mediaEntries, mediaUsage, thumbnailUrl, type MediaEntry } from "@/builder/media.ts";
import { useMediaActions } from "@/hooks/useMediaActions.ts";
import { useSiteContent } from "@/hooks/useSiteContent.ts";
import { useWide } from "@/hooks/useWide.ts";
import { isHostingOnly } from "@/lib/services.ts";
import { isAcceptedImageType } from "@/lib/resizeImage.ts";
import type { ContentGetResponse } from "@shared/publishTypes.ts";

const VIEW_KEY = "armature:media:view";
type View = "grid" | "list";
type Kind = "all" | "image" | "video";

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

/** The picture's natural size, once the browser has it. */
function useDimensions(url: string | null): { width: number; height: number } | null {
  const [measured, setMeasured] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (alive) setMeasured({ url, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return measured && measured.url === url ? { width: measured.width, height: measured.height } : null;
}

function Thumb({ entry, siteUrl, className }: { entry: MediaEntry; siteUrl: string | null; className?: string }) {
  const thumb = entry.kind === "image" ? thumbnailUrl(entry.src, siteUrl) : null;
  return (
    <div className={clsx("flex items-center justify-center overflow-hidden bg-ground", className)}>
      {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : entry.kind === "video" ? <IconVideo size={22} className="text-muted" /> : <IconImage size={22} className="text-muted" />}
    </div>
  );
}

function Details({
  entry,
  siteUrl,
  siteId,
  usedOn,
  pageSlugs,
  alt,
  canEditAlt,
  canDelete,
  busy,
  onAlt,
  onDelete,
  onClose,
}: {
  entry: MediaEntry;
  siteUrl: string | null;
  siteId: string;
  usedOn: string[];
  pageSlugs: Map<string, string>;
  alt: string;
  canEditAlt: boolean;
  canDelete: boolean;
  busy: boolean;
  onAlt: (alt: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const toast = useToast();
  // The parent keys this panel on the file and its saved description, so a fresh draft each time.
  const [draft, setDraft] = useState(alt);
  const url = thumbnailUrl(entry.src, siteUrl);
  const size = useDimensions(entry.kind === "image" ? url : null);
  const link = siteUrl ? `${siteUrl.replace(/\/+$/, "")}${entry.src}` : entry.src;
  const altId = useId();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.show("Link copied.");
    } catch {
      toast.show("The link could not be copied; select it and copy it yourself.", "danger");
    }
  };
  return (
    <div className="flex flex-col gap-4" data-testid="media-details">
      <div className="flex items-start justify-between gap-3">
        <h2 className="min-w-0 break-all font-sans text-[15px] font-bold tracking-normal text-text" data-testid="media-details-name">
          {entry.name}
        </h2>
        <IconButton label="Close details" size="sm" onClick={onClose} className="shell:hidden">
          <IconX size={18} />
        </IconButton>
      </div>
      <Thumb entry={entry} siteUrl={siteUrl} className="aspect-[4/3] w-full rounded-card border border-line" />
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-muted">File name</dt>
        <dd className="break-all">{entry.name}</dd>
        <dt className="text-muted">Type</dt>
        <dd>{entry.kind === "video" ? "Video" : "Picture"}</dd>
        <dt className="text-muted">Size</dt>
        <dd>{formatBytes(entry.bytes)}</dd>
        {entry.kind === "image" && (
          <>
            <dt className="text-muted">Dimensions</dt>
            <dd data-testid="media-dimensions">{size ? `${size.width} × ${size.height} pixels` : url ? "Measuring…" : "Unknown"}</dd>
          </>
        )}
        <dt className="text-muted">Address</dt>
        <dd className="break-all font-mono text-[12px]">{entry.src}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void copy()} data-testid="media-copy-link">
          <IconCopy size={15} /> Copy link
        </Button>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line bg-panel px-3 text-[13px] font-semibold text-text hover:bg-ground">
            Open
            <SrOnly>(opens in a new tab)</SrOnly>
          </a>
        )}
      </div>
      {entry.kind === "image" && (
        <Field label="Description (alt text)" htmlFor={altId} hint={canEditAlt ? "Read aloud by screen readers and shown if the picture cannot load. Used wherever this picture is placed." : "Your agency sets the description."}>
          <Textarea id={altId} value={draft} maxLength={500} rows={3} disabled={!canEditAlt} onChange={(event) => setDraft(event.target.value)} data-testid="media-alt" />
          {canEditAlt && (
            <div className="mt-2">
              <Button size="sm" disabled={draft.trim() === alt.trim() || busy} loading={busy} onClick={() => onAlt(draft)} data-testid="media-alt-save">
                <IconCheck size={15} /> Save description
              </Button>
            </div>
          )}
        </Field>
      )}
      <div>
        <div className="mb-1 text-[13px] font-semibold text-text">Used on</div>
        {usedOn.length === 0 ? (
          <p className="text-[13px] text-muted" data-testid="media-used-on">
            Not used on any page.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5" data-testid="media-used-on">
            {usedOn.map((label) => {
              const slug = pageSlugs.get(label);
              return (
                <li key={label}>
                  {slug ? (
                    <Link to={`/sites/${siteId}/visual?page=${encodeURIComponent(slug)}`} className="inline-flex h-7 items-center rounded-pill bg-grey-soft px-2.5 text-[12px] font-semibold text-text hover:underline">
                      {label}
                    </Link>
                  ) : (
                    <Pill tone="grey">{label}</Pill>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {canDelete && (
        <div className="border-t border-line pt-4">
          <Button variant="danger" size="sm" onClick={onDelete} disabled={busy} data-testid="media-delete">
            <IconTrash size={15} /> Delete permanently
          </Button>
        </div>
      )}
    </div>
  );
}

export function SiteMedia() {
  const { site, isStaff } = useSite();
  const [params] = useSearchParams();
  const content = useSiteContent(site.id);
  const loaded: ContentGetResponse | null = content.data && content.data.ok ? content.data : null;
  const actions = useMediaActions(site.id, loaded?.commitSha, loaded?.media ?? []);
  const [view, setView] = useState<View>(readView);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [selected, setSelected] = useState<string | null>(() => params.get("file"));
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<MediaEntry | null>(null);
  const uploadId = useId();
  const wide = useWide();

  const entries = useMemo(() => (loaded ? mediaEntries(loaded.media ?? [], {}) : []), [loaded]);
  const pageLabel = (slug: string) => loaded?.schema.pages.find((page) => page.slug === slug)?.label ?? loaded?.layouts?.[slug]?.label ?? slug;
  const usage = useMemo(() => (loaded ? mediaUsage(loaded.content, loaded.layouts ?? {}, pageLabel) : new Map<string, string[]>()), [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const pageSlugs = useMemo(() => {
    const map = new Map<string, string>();
    for (const page of loaded?.schema.pages ?? []) map.set(page.label, page.slug);
    for (const layout of Object.values(loaded?.layouts ?? {})) map.set(layout.label ?? layout.pageSlug, layout.pageSlug);
    return map;
  }, [loaded]);
  const alts = useMemo(() => Object.fromEntries((loaded?.media ?? []).map((file) => [file.path, file.alt])), [loaded]);

  const needle = query.trim().toLowerCase();
  const shown = entries.filter((entry) => (kind === "all" || entry.kind === kind) && (!needle || entry.name.toLowerCase().includes(needle) || (alts[entry.src] ?? "").toLowerCase().includes(needle)));
  const current = entries.find((entry) => entry.src === selected) ?? null;
  const canEditAlt = isStaff || loaded?.editingLevel !== "content";
  const canDelete = isStaff || loaded?.editingLevel === "builder";

  const chooseView = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Per-browser convenience only.
    }
  };
  const upload = (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []).filter((file) => isAcceptedImageType(file.type));
    const skipped = Array.from(list ?? []).length - files.length;
    if (skipped > 0 && files.length === 0) {
      actions.reset();
      setUploadNote("Only PNG, JPEG and WebP pictures can be uploaded.");
      return;
    }
    setUploadNote(skipped > 0 ? `${skipped} ${skipped === 1 ? "file was" : "files were"} skipped: only PNG, JPEG and WebP pictures can be uploaded.` : null);
    if (files.length > 0) actions.mutate({ kind: "upload", files });
  };
  const [uploadNote, setUploadNote] = useState<string | null>(null);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    upload(event.dataTransfer.files);
  };

  if (isHostingOnly(site)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Media" meta={<Pill tone="grey">Hosting only</Pill>} />
        <EmptyState title="No pictures to manage yet" icon={<IconImage size={18} />}>
          {isStaff ? "Connect the site's repository and its pictures appear here." : `${site.name} is looked after by the agency and is not edited here yet.`}
        </EmptyState>
      </div>
    );
  }

  let body: ReactNode;
  if (content.isPending) {
    body = (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="status" aria-label="Loading media">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
          <Skeleton key={index} className="aspect-square rounded-card" />
        ))}
      </div>
    );
  } else if (content.isError || !loaded) {
    body = (
      <Notice kind="danger" title="The site's pictures could not be loaded" action={<Button variant="secondary" size="sm" loading={content.isFetching} onClick={() => void content.refetch()}>Retry</Button>}>
        {content.isError ? content.error.message : content.data && !content.data.ok ? content.data.message : "The site's content could not be read."}
      </Notice>
    );
  } else if (entries.length === 0) {
    body = (
      <EmptyState title="No pictures yet" icon={<IconImage size={18} />} action={<label htmlFor={uploadId} className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-control bg-accent px-4 text-[14px] font-semibold text-accent-fg hover:opacity-90">Upload a picture</label>}>
        Upload a picture, or drop one anywhere on this screen. It is published to the site as one commit.
      </EmptyState>
    );
  } else if (shown.length === 0) {
    body = (
      <EmptyState title="Nothing matches" icon={<IconSearch size={18} />}>
        Try another word, or show every type.
      </EmptyState>
    );
  } else if (view === "grid") {
    body = (
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="media-grid">
        {shown.map((entry) => (
          <li key={entry.src}>
            <button
              type="button"
              onClick={() => setSelected(entry.src)}
              aria-pressed={selected === entry.src}
              data-testid={`media-item-${entry.name}`}
              className={clsx("group flex w-full flex-col overflow-hidden rounded-card border bg-panel text-left hover:border-ink-line focus-visible:outline-2 focus-visible:outline-accent", selected === entry.src ? "border-accent ring-2 ring-accent/30" : "border-line")}
            >
              <Thumb entry={entry} siteUrl={site.live_url} className="aspect-square w-full" />
              <span className="flex min-w-0 flex-col gap-0.5 px-2.5 py-2">
                <span className="truncate text-[13px] font-semibold text-text">{entry.name}</span>
                <span className="truncate text-[11px] text-muted">{(usage.get(entry.src) ?? []).length > 0 ? `Used on ${(usage.get(entry.src) ?? []).join(", ")}` : "Not used"}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    );
  } else {
    body = (
      <div className="rounded-card border border-line bg-panel" data-testid="media-list">
        <div role="table" aria-label="Media">
          <div role="row" className="grid h-10 grid-cols-[48px_minmax(0,2fr)_80px_90px_minmax(0,1.5fr)] items-center gap-3 border-b border-line px-4 text-[12px] font-semibold text-muted">
            <div role="columnheader">
              <SrOnly>Preview</SrOnly>
            </div>
            <div role="columnheader">File</div>
            <div role="columnheader">Type</div>
            <div role="columnheader">Size</div>
            <div role="columnheader">Used on</div>
          </div>
          {shown.map((entry) => (
            <div
              key={entry.src}
              role="row"
              tabIndex={0}
              aria-selected={selected === entry.src}
              onClick={() => setSelected(entry.src)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelected(entry.src);
                }
              }}
              data-testid={`media-item-${entry.name}`}
              className={clsx("grid min-h-[56px] cursor-pointer grid-cols-[48px_minmax(0,2fr)_80px_90px_minmax(0,1.5fr)] items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-b-0", selected === entry.src ? "bg-blue-soft" : "hover:bg-ground")}
            >
              <Thumb entry={entry} siteUrl={site.live_url} className="h-10 w-10 rounded-sm" />
              <div role="cell" className="min-w-0">
                <div className="truncate font-semibold text-text">{entry.name}</div>
                <div className="truncate text-[11px] text-muted">{alts[entry.src] || "No description"}</div>
              </div>
              <div role="cell">
                <Pill tone="grey">{entry.kind === "video" ? "Video" : "Picture"}</Pill>
              </div>
              <div role="cell" className="text-muted">
                {formatBytes(entry.bytes)}
              </div>
              <div role="cell" className="truncate text-muted">
                {(usage.get(entry.src) ?? []).join(", ") || "Not used"}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const details = current && loaded && (
    <Details
      key={`${current.src}:${alts[current.src] ?? ""}`}
      entry={current}
      siteUrl={site.live_url}
      siteId={site.id}
      usedOn={usage.get(current.src) ?? []}
      pageSlugs={pageSlugs}
      alt={alts[current.src] ?? ""}
      canEditAlt={canEditAlt}
      canDelete={canDelete}
      busy={actions.isPending}
      onAlt={(alt) => actions.mutate({ kind: "alt", path: current.src, alt })}
      onDelete={() => setConfirmDelete(current)}
      onClose={() => setSelected(null)}
    />
  );
  const uses = confirmDelete ? (usage.get(confirmDelete.src) ?? []) : [];

  return (
    <div
      className={clsx("relative flex flex-col gap-5", dragging && "outline-2 outline-dashed outline-accent outline-offset-8 rounded-card")}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      data-testid="media-screen"
    >
      <PageHeader
        title="Media"
        description="Every picture and video on the site. Drop files anywhere here to upload them."
        action={
          loaded ? (
            <label htmlFor={uploadId} className={clsx("inline-flex h-11 cursor-pointer items-center gap-2 rounded-control bg-accent px-4 text-[14px] font-semibold text-accent-fg hover:opacity-90", actions.isPending && "pointer-events-none opacity-60")} data-testid="media-upload-button">
              <IconUpload size={16} /> {actions.isPending && actions.variables?.kind === "upload" ? "Uploading…" : "Upload"}
            </label>
          ) : undefined
        }
      />
      <input
        id={uploadId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="sr-only"
        data-testid="media-upload"
        onChange={(event) => {
          upload(event.target.files);
          event.target.value = "";
        }}
      />
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-card bg-panel/80 text-[15px] font-semibold text-text" aria-hidden="true">
          Drop to upload
        </div>
      )}
      {actions.isError && (
        <Notice kind="danger" title="That could not be done">
          {actions.error.message}
        </Notice>
      )}
      {uploadNote && <Notice kind="warning">{uploadNote}</Notice>}

      {loaded && entries.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Show as"
              value={view}
              onChange={chooseView}
              options={[
                { value: "grid", label: <span className="inline-flex items-center gap-1.5"><IconGrid size={14} /> Grid</span> },
                { value: "list", label: <span className="inline-flex items-center gap-1.5"><IconListBullet size={14} /> List</span> },
              ]}
            />
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <span>Type</span>
              <Select value={kind} onChange={(event) => setKind(event.target.value as Kind)} className="h-10 w-36" data-testid="media-kind">
                <option value="all">All</option>
                <option value="image">Pictures</option>
                <option value="video">Videos</option>
              </Select>
            </label>
            <span className="text-[13px] text-muted" data-testid="media-count">
              {shown.length} {shown.length === 1 ? "file" : "files"}
            </span>
          </div>
          <label className="relative">
            <span className="sr-only">Search media</span>
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or description" className="h-10 w-64 pl-9" data-testid="media-search" />
          </label>
        </div>
      )}

      <div className={clsx("grid items-start gap-5", current && wide && "grid-cols-[minmax(0,1fr)_320px]")}>
        <div className="min-w-0">{body}</div>
        {details && wide && <aside className="sticky top-6 rounded-card border border-line bg-panel p-5">{details}</aside>}
      </div>

      <SiteStoragePanel agencyId={site.agency_id} siteId={site.id} canWrite={isStaff || loaded?.editingLevel === "style" || loaded?.editingLevel === "builder"} />
      {!wide && (
        <Drawer open={!!details} onClose={() => setSelected(null)} title="Details">
          <div className="p-4">{details}</div>
        </Drawer>
      )}

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={uses.length > 0 ? "This picture is still in use" : "Delete this picture?"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={actions.isPending}
              data-testid="media-delete-confirm"
              onClick={() => {
                if (!confirmDelete) return;
                const path = confirmDelete.src;
                actions.mutate({ kind: "delete", path }, { onSuccess: () => setSelected(null), onSettled: () => setConfirmDelete(null) });
              }}
            >
              {uses.length > 0 ? "Delete anyway" : "Delete permanently"}
            </Button>
          </>
        }
      >
        {uses.length > 0 ? (
          <div className="text-[14px] leading-relaxed text-text" data-testid="media-delete-warning">
            <p>
              "{confirmDelete?.name}" is used on {uses.length === 1 ? "this page" : "these pages"}: <strong>{uses.join(", ")}</strong>. Deleting it leaves a missing picture there until you replace it.
            </p>
            <p className="mt-2 text-muted">Better: open the page in the editor and swap the picture first.</p>
          </div>
        ) : (
          <p className="text-[14px] leading-relaxed text-text">"{confirmDelete?.name}" is removed from the site as one commit. This cannot be undone.</p>
        )}
      </Modal>
    </div>
  );
}
