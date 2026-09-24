/**
 * The Supabase Storage files a site has: upload, list, delete, copy the public URL.
 * Rendered under the repo-based Media Library on the Media screen (so the two
 * coexist; nothing about the repo library changes). Each site's storage lives at
 * <agency_id>/<site_id>/<folder>/<file> in the shared "site-files" bucket, with
 * RLS enforcing that only agency staff and members of the site can write there.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useState, type ChangeEvent } from "react";
import { IconCopy, IconTrash, IconUpload } from "@/components/icons.tsx";
import { Button, Notice, Skeleton } from "@/components/ui.tsx";
import { formatBytes } from "@/builder/media.ts";
import { deleteSiteFile, listSiteFiles, readStorageTotals, uploadSiteFile } from "@/lib/siteStorage.ts";

type Props = {
  agencyId: string;
  siteId: string;
  canWrite: boolean;
};

export function SiteStoragePanel({ agencyId, siteId, canWrite }: Props) {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["site-files", siteId], queryFn: () => listSiteFiles(agencyId, siteId) });
  const totals = useQuery({ queryKey: ["site-files-totals", siteId], queryFn: () => readStorageTotals(siteId) });
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const result = await uploadSiteFile({ agencyId, siteId, file });
      if (!result.ok) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ["site-files", siteId] });
      void client.invalidateQueries({ queryKey: ["site-files-totals", siteId] });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  const remove = useMutation({
    mutationFn: async (path: string) => {
      const result = await deleteSiteFile(path);
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ["site-files", siteId] });
      void client.invalidateQueries({ queryKey: ["site-files-totals", siteId] });
    },
    onError: (cause: Error) => setError(cause.message),
  });

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) upload.mutate(file);
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      window.setTimeout(() => setCopied((current) => (current === url ? null : current)), 1500);
    } catch {
      /* noop */
    }
  }

  return (
    <section className="rounded-card border border-line bg-panel p-5" data-testid="site-storage-panel">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-[18px] font-semibold text-text">Storage files</h2>
          <p className="text-[13px] text-muted">
            Files uploaded to your site's Supabase Storage folder (pictures and documents, up to 20 MB each). The URL is public so any page can link to it.{" "}
            {totals.data && `${totals.data.files} file${totals.data.files === 1 ? "" : "s"}, ${formatBytes(totals.data.bytes)} used.`}
          </p>
          <p className="mt-1 text-[12px] text-muted">Video files are not stored here — upload to YouTube, Vimeo or Wistia and use the Video widget.</p>
        </div>
        {canWrite && (
          <label className={clsx("inline-flex h-10 cursor-pointer items-center gap-2 rounded-control border border-line px-3 text-[13px] font-semibold hover:border-accent hover:text-accent", upload.isPending && "pointer-events-none opacity-60")}>
            <IconUpload size={14} /> {upload.isPending ? "Uploading…" : "Upload"}
            <input type="file" accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain" className="sr-only" onChange={onFile} data-testid="storage-upload" />
          </label>
        )}
      </header>
      {error && <Notice kind="danger" title="Upload or delete failed" className="mt-3">{error}</Notice>}
      {list.isPending ? (
        <div className="mt-4"><Skeleton lines={3} /></div>
      ) : list.data && list.data.length === 0 ? (
        <p className="mt-4 text-[13px] text-muted">No files yet. Upload one to start.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2" data-testid="storage-list">
          {(list.data ?? []).map((file) => (
            <li key={file.path} className="flex items-center gap-3 rounded-control border border-line px-3 py-2">
              {file.contentType.startsWith("image/") ? (
                <img src={file.url} alt="" className="h-12 w-12 shrink-0 rounded-sm object-cover" loading="lazy" />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-sm bg-ground text-[10px] font-semibold uppercase text-muted">{(file.contentType.split("/")[1] ?? "file").slice(0, 4)}</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-text">{file.path.split("/").pop()}</p>
                <p className="truncate text-[11px] text-muted">{formatBytes(file.size)} · {new Date(file.updatedAt).toLocaleDateString()}</p>
              </div>
              <button type="button" onClick={() => void copy(file.url)} className="inline-flex h-8 items-center gap-1 rounded-sm border border-line px-2 text-[12px] font-semibold text-text hover:border-accent hover:text-accent" aria-label={`Copy link to ${file.path}`}>
                <IconCopy size={12} /> {copied === file.url ? "Copied" : "Copy URL"}
              </button>
              {canWrite && (
                <Button size="sm" variant="danger" onClick={() => { if (confirm(`Delete ${file.path.split("/").pop()}?`)) remove.mutate(file.path); }} data-testid={`storage-delete-${file.path.split("/").pop()}`}>
                  <IconTrash size={13} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
