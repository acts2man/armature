/**
 * The media library: the site's pictures and videos, plus pictures added in this draft.
 * Searchable, each with where it is used and its default alt text (content/media.json).
 * The Media tab inserts a picture as an Image widget; the picker (opened from an image
 * control) hands one back. Uploads are resized in the browser to WebP, at most 2000px
 * and 3 MB, and travel inside the draft until the next publish commits them.
 */
import { clsx } from "clsx";
import { useId, useState } from "react";
import { IconImage, IconSearch, IconUpload, IconVideo } from "@/components/icons.tsx";
import { Button, Modal } from "@/components/ui.tsx";
import { formatBytes, thumbnailUrl, type MediaEntry } from "./media.ts";

type GridProps = {
  entries: MediaEntry[];
  usage: Map<string, string[]>;
  alts: Record<string, { alt: string }>;
  siteUrl: string | null;
  /** Default alt text is editable for the site's files (agency staff and clients alike). */
  onAlt?: (src: string, alt: string) => void;
  onChoose: (entry: MediaEntry) => void;
  chooseLabel: string;
  onUpload: (file: File) => Promise<void>;
  imagesOnly?: boolean;
};

function MediaGrid({ entries, usage, alts, siteUrl, onAlt, onChoose, chooseLabel, onUpload, imagesOnly }: GridProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const uploadId = useId();
  const needle = query.trim().toLowerCase();
  const shown = entries.filter((entry) => (!imagesOnly || entry.kind === "image") && (!needle || entry.name.toLowerCase().includes(needle) || (alts[entry.src]?.alt ?? "").toLowerCase().includes(needle)));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <IconSearch size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input type="search" aria-label="Search media" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or alt text" className="h-9 w-full rounded-control border border-line pl-8 pr-2 text-[13px]" />
        </div>
        <label htmlFor={uploadId} className={clsx("inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-control border border-line px-2.5 text-[13px] font-semibold text-text hover:border-accent hover:text-accent", busy && "pointer-events-none opacity-60")}>
          <IconUpload size={15} /> {busy ? "Preparing…" : "Upload"}
        </label>
        <input
          id={uploadId}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          data-testid="media-upload"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setBusy(true);
            void onUpload(file).finally(() => setBusy(false));
          }}
        />
      </div>
      {shown.length === 0 && <p className="py-6 text-center text-[13px] text-muted">{entries.length === 0 ? "No pictures yet. Upload one to start." : `Nothing matches "${query}".`}</p>}
      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pb-2" data-testid="media-list">
        {shown.map((entry) => {
          const thumb = entry.kind === "image" ? thumbnailUrl(entry.src, siteUrl) : null;
          const used = usage.get(entry.src) ?? [];
          return (
            <li key={entry.src} className="rounded-[10px] border border-line p-2" data-testid="media-item" data-src={entry.draft ? "draft" : entry.src}>
              <div className="flex gap-2.5">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-ground">
                  {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" /> : entry.kind === "video" ? <IconVideo size={20} className="text-muted" /> : <IconImage size={20} className="text-muted" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-text" title={entry.draft ? entry.name : entry.src}>
                    {entry.name}
                  </p>
                  <p className="text-[11px] text-muted">
                    {formatBytes(entry.bytes)}
                    {entry.draft && " · publishes with your changes"}
                  </p>
                  <p className="truncate text-[11px] text-muted" data-testid="media-used">
                    {used.length ? `Used on ${used.join(", ")}` : "Not used on any page"}
                  </p>
                </div>
              </div>
              {entry.kind === "image" && !entry.draft && onAlt && (
                <input
                  type="text"
                  aria-label={`Alt text for ${entry.name}`}
                  value={alts[entry.src]?.alt ?? ""}
                  maxLength={500}
                  onChange={(event) => onAlt(entry.src, event.target.value)}
                  placeholder="Describe the picture for screen readers"
                  className="mt-2 h-8 w-full rounded-sm border border-line px-2 text-[12px]"
                />
              )}
              {(entry.kind === "image" || !imagesOnly) && (
                <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => onChoose(entry)}>
                  {chooseLabel}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MediaPanel(props: Omit<GridProps, "chooseLabel" | "imagesOnly">) {
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-3" data-testid="media-panel">
      <MediaGrid {...props} imagesOnly chooseLabel="Insert on the page" />
    </div>
  );
}

export function MediaPicker({ open, onClose, ...props }: Omit<GridProps, "chooseLabel" | "imagesOnly" | "onAlt"> & { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Media library">
      <div className="flex h-[60vh] flex-col" data-testid="media-picker">
        <MediaGrid {...props} imagesOnly chooseLabel="Use this picture" />
      </div>
    </Modal>
  );
}
