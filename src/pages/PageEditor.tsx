/**
 * /sites/:siteId/pages/:slug — the page editor, styled after the visual editor's
 * layers panel and inspector: sections on the left, one inspector-style panel per
 * field on the right, a sticky publish bar on top.
 *
 * Nothing is saved anywhere until Publish: edits live in an overlay over the
 * content loaded from the repository, each changed field is marked, and one press
 * of Publish writes everything in one commit. The connection to GitHub is always in
 * exactly one of three states (connecting / connected / error), so the publish bar
 * can never fall silent.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useBlocker, useParams } from "react-router";
import { CheckList } from "@/components/CheckList.tsx";
import {
  IconAlert,
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconExternal,
  IconHeading,
  IconImage,
  IconLayers,
  IconLink,
  IconParagraph,
  IconPlus,
  IconStethoscope,
  IconTrash,
  IconUndo,
} from "@/components/icons.tsx";
import { siteQueryKey, useSite } from "@/components/SiteLayout.tsx";
import { Button, Field, IconButton, Input, LinkButton, Modal, Notice, PageHeader, Pill, Skeleton, SrOnly, Textarea, useToast } from "@/components/ui.tsx";
import { useSiteContent } from "@/hooks/useSiteContent.ts";
import { plural, shortSha } from "@/lib/format.ts";
import { callFunction, type Failure } from "@/lib/functions.ts";
import { fileToBase64, prepareImage, type PreparedImage } from "@/lib/resizeImage.ts";
import type { ContentValue, LinkValue } from "@shared/contentFile.ts";
import type { ConnectionReport, ContentGetResponse, DiagnoseResponse, FieldUpdate, ImageUpload, PublishRequest, PublishResponse } from "@shared/publishTypes.ts";
import { getPageDefinition, type ItemField, type PageField, type PageSection } from "@shared/schema.ts";

type FieldState = { text: string; href: string; list: Record<string, string>[] };
type PendingImage = PreparedImage;

const EMPTY: FieldState = { text: "", href: "", list: [] };

const DEFAULT_ITEM_FIELDS: ItemField[] = [{ key: "text", label: "Text", type: "text" }];

/** The editor is always in exactly one of these three connection states. */
type ConnectionState = { kind: "connecting" } | { kind: "connected"; branch: string; repo: string; commitSha: string } | { kind: "error"; message: string };

/**
 * Turn a rejected query into something worth reading. callFunction never throws,
 * so this only fires for failures that never reach a function at all.
 */
function describeQueryError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).trim();
  const base = raw.length > 0 ? raw : "The dashboard could not get a reply from the server.";
  return `${base} The server did not return a readable answer, so this is usually a sign-in or configuration problem rather than something you did. Use "Check connection" for the details.`;
}

const keyOf = (sectionKey: string, fieldKey: string) => `${sectionKey}.${fieldKey}`;

/** The page's address on the live site, or null when the site has no live URL yet. */
function liveHref(liveUrl: string | null, path: string): string | null {
  if (!liveUrl) return null;
  return `${liveUrl.replace(/\/+$/, "")}${path}`;
}

/** Read one field out of a content tree into the editor's per-field state. */
function stateFromValue(field: PageField, value: unknown): FieldState {
  if (field.type === "list") {
    return { text: "", href: "", list: Array.isArray(value) ? (value as Record<string, string>[]) : [] };
  }
  if (field.type === "link") {
    const link = (value ?? {}) as Partial<LinkValue>;
    return { text: link.label ?? "", href: link.href ?? "", list: [] };
  }
  return { text: typeof value === "string" ? value : "", href: "", list: [] };
}

/** Turn the editor's per-field state back into a content value. */
function valueFromState(field: PageField, state: FieldState): ContentValue {
  if (field.type === "list") return state.list;
  if (field.type === "link") return { label: state.text, href: state.href };
  return state.text;
}

const sameState = (a: FieldState | undefined, b: FieldState | undefined) => JSON.stringify(a ?? EMPTY) === JSON.stringify(b ?? EMPTY);

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}

function fieldIcon(type: PageField["type"]): ReactNode {
  switch (type) {
    case "textarea":
      return <IconParagraph size={16} />;
    case "image":
      return <IconImage size={16} />;
    case "link":
    case "url":
    case "video":
      return <IconLink size={16} />;
    case "list":
      return <IconLayers size={16} />;
    default:
      return <IconHeading size={16} />;
  }
}

// --- field controls -----------------------------------------------------------

function ListEditor({
  id,
  fieldLabel,
  itemFields,
  list,
  onChange,
}: {
  id: string;
  fieldLabel: string;
  itemFields: ItemField[];
  list: Record<string, string>[];
  onChange: (list: Record<string, string>[]) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {list.map((item, index) => (
        <div key={index} className="rounded-[10px] border border-line bg-ground p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-muted">Item {index + 1}</span>
            <div className="flex gap-0.5 rounded-control border border-line bg-panel p-0.5">
              <IconButton size="sm" label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => onChange(moveItem(list, index, index - 1))}>
                <IconArrowUp size={16} />
              </IconButton>
              <IconButton size="sm" label={`Move item ${index + 1} down`} disabled={index === list.length - 1} onClick={() => onChange(moveItem(list, index, index + 1))}>
                <IconArrowDown size={16} />
              </IconButton>
              <IconButton size="sm" label={`Remove item ${index + 1}`} className="hover:bg-red-soft hover:text-red" onClick={() => onChange(list.filter((_, i) => i !== index))}>
                <IconTrash size={16} />
              </IconButton>
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            {itemFields.map((itemField) => {
              const itemId = `${id}-${index}-${itemField.key}`;
              const set = (next: string) => onChange(list.map((entry, i) => (i === index ? { ...entry, [itemField.key]: next } : entry)));
              return (
                <Field
                  key={itemField.key}
                  htmlFor={itemId}
                  label={
                    <>
                      <SrOnly>
                        {fieldLabel}, item {index + 1},{" "}
                      </SrOnly>
                      {itemField.label}
                    </>
                  }
                >
                  {itemField.type === "textarea" ? (
                    <Textarea id={itemId} className="min-h-20" value={item[itemField.key] ?? ""} onChange={(event) => set(event.target.value)} />
                  ) : (
                    <Input
                      id={itemId}
                      inputMode={itemField.type === "url" ? "url" : undefined}
                      placeholder={itemField.type === "image" ? "/assets/example.webp" : undefined}
                      value={item[itemField.key] ?? ""}
                      onChange={(event) => set(event.target.value)}
                    />
                  )}
                </Field>
              );
            })}
          </div>
        </div>
      ))}
      <div>
        <Button variant="secondary" size="sm" onClick={() => onChange([...list, Object.fromEntries(itemFields.map((itemField) => [itemField.key, ""]))])}>
          <IconPlus size={16} /> Add item
        </Button>
      </div>
    </div>
  );
}

function ImageControl({
  id,
  fieldLabel,
  value,
  pending,
  preparing,
  imageError,
  liveUrl,
  onChange,
  onAttach,
}: {
  id: string;
  fieldLabel: string;
  value: string;
  pending: PendingImage | undefined;
  preparing: boolean;
  imageError: string | undefined;
  liveUrl: string | null;
  onChange: (text: string) => void;
  onAttach: (file: File) => void;
}) {
  const existingPreview = !pending && value.startsWith("/assets/") ? liveHref(liveUrl, value) : null;
  const [broken, setBroken] = useState<string | null>(null);

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
      <div className="flex flex-col gap-3">
        <Field
          htmlFor={id}
          label={
            <>
              <SrOnly>{fieldLabel}: </SrOnly>Image path
            </>
          }
          hint={pending ? "The path is chosen for you when the new image is published." : undefined}
        >
          <Input id={id} placeholder="/assets/example.webp" value={pending ? "" : value} disabled={Boolean(pending)} onChange={(event) => onChange(event.target.value)} className="font-mono text-[13px]" />
        </Field>
        <Field
          htmlFor={`${id}-file`}
          label={
            <>
              <SrOnly>{fieldLabel}: </SrOnly>Upload a new image
            </>
          }
          hint="PNG, JPEG or WebP. It is resized in your browser before it is published."
          error={imageError ?? null}
        >
          <input
            id={`${id}-file`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={preparing}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onAttach(file);
              event.target.value = "";
            }}
            className="block w-full rounded-control border border-line bg-panel px-3 py-2 text-[13px] text-text file:mr-3 file:h-7 file:rounded-sm file:border-0 file:bg-ground file:px-3 file:text-[13px] file:font-semibold file:text-text disabled:bg-ground disabled:text-muted"
          />
        </Field>
        {preparing && <p className="text-[13px] text-muted">Preparing the image…</p>}
        {pending && (
          <p className="text-[13px] font-medium text-accent">
            New image ready to publish: {pending.file.name} ({Math.round(pending.bytes / 1024)} KB, {pending.width}×{pending.height})
          </p>
        )}
      </div>
      <div className="flex h-36 items-center justify-center overflow-hidden rounded-[10px] border border-line bg-ground">
        {pending ? (
          <img src={pending.previewUrl} alt="" className="h-full w-full object-cover" />
        ) : existingPreview && broken !== existingPreview ? (
          <img src={existingPreview} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setBroken(existingPreview)} />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[12px] text-muted">
            <IconImage size={20} />
            {value ? "No preview" : "No image yet"}
          </span>
        )}
      </div>
    </div>
  );
}

function FieldCard({
  section,
  field,
  value,
  pending,
  preparing,
  imageError,
  isChanged,
  busy,
  liveUrl,
  onChange,
  onRevert,
  onAttach,
}: {
  section: PageSection;
  field: PageField;
  value: FieldState;
  pending: PendingImage | undefined;
  preparing: boolean;
  imageError: string | undefined;
  isChanged: boolean;
  busy: boolean;
  liveUrl: string | null;
  onChange: (patch: Partial<FieldState>) => void;
  onRevert: () => void;
  onAttach: (file: File) => void;
}) {
  const id = `${section.key}-${field.key}`;
  const hiddenLabel = <SrOnly>{field.label}</SrOnly>;

  let control: ReactNode;
  switch (field.type) {
    case "textarea":
      control = (
        <Field label={hiddenLabel} htmlFor={id}>
          <Textarea id={id} className="min-h-32" value={value.text} onChange={(event) => onChange({ text: event.target.value })} />
        </Field>
      );
      break;
    case "text":
    case "url":
      control = (
        <Field label={hiddenLabel} htmlFor={id}>
          <Input id={id} inputMode={field.type === "url" ? "url" : undefined} value={value.text} onChange={(event) => onChange({ text: event.target.value })} />
        </Field>
      );
      break;
    case "video":
      control = (
        <Field label={hiddenLabel} htmlFor={id}>
          <Input id={id} inputMode="url" placeholder="Paste a URL" value={value.text} onChange={(event) => onChange({ text: event.target.value })} />
        </Field>
      );
      break;
    case "link":
      control = (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            htmlFor={`${id}-label`}
            label={
              <>
                <SrOnly>{field.label}: </SrOnly>Button label
              </>
            }
          >
            <Input id={`${id}-label`} value={value.text} onChange={(event) => onChange({ text: event.target.value })} />
          </Field>
          <Field
            htmlFor={`${id}-href`}
            label={
              <>
                <SrOnly>{field.label}: </SrOnly>Destination
              </>
            }
          >
            <Input id={`${id}-href`} inputMode="url" value={value.href} onChange={(event) => onChange({ href: event.target.value })} />
          </Field>
        </div>
      );
      break;
    case "image":
      control = (
        <ImageControl
          id={id}
          fieldLabel={field.label}
          value={value.text}
          pending={pending}
          preparing={preparing}
          imageError={imageError}
          liveUrl={liveUrl}
          onChange={(text) => onChange({ text })}
          onAttach={onAttach}
        />
      );
      break;
    case "list":
      control = <ListEditor id={id} fieldLabel={field.label} itemFields={field.itemFields ?? DEFAULT_ITEM_FIELDS} list={value.list} onChange={(list) => onChange({ list })} />;
      break;
  }

  return (
    <section aria-labelledby={`${id}-heading`} className={clsx("rounded-card border border-line bg-panel", isChanged && "wire")}>
      {isChanged && <span className="wire-handles" aria-hidden="true" />}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className="text-muted">{fieldIcon(field.type)}</span>
          <h3 id={`${id}-heading`} className="font-sans text-[14px] font-bold tracking-normal text-text">
            {field.label}
          </h3>
          <span className="rounded-sm bg-ground px-2 py-1 font-mono text-[11px] text-muted">
            {section.key}.{field.key}
          </span>
          {isChanged && <Pill tone="blue">Changed</Pill>}
        </div>
        <Button variant="ghost" size="sm" disabled={!isChanged || busy} onClick={onRevert}>
          <IconUndo size={16} /> Revert
          <SrOnly> {field.label}</SrOnly>
        </Button>
      </div>
      <div className="px-4 py-4 sm:px-5">
        {field.help && <p className="mb-3 text-[12px] leading-relaxed text-muted">{field.help}</p>}
        {control}
      </div>
    </section>
  );
}

// --- the editor ---------------------------------------------------------------

export function PageEditor() {
  const { slug = "" } = useParams();
  // Keyed by slug so moving between pages starts a fresh draft and releases previews.
  return <Editor key={slug} slug={slug} />;
}

function Editor({ slug }: { slug: string }) {
  const { site } = useSite();
  const queryClient = useQueryClient();
  const toast = useToast();
  const published = useSiteContent(site.id);

  const loaded = published.data?.ok === true ? published.data : undefined;
  const loadFailure = published.data && published.data.ok === false ? published.data : undefined;

  // Keep the last good load so the fields stay readable if a later reload fails.
  // Publishing still requires a fresh, connected load (see `connection`).
  const [lastGood, setLastGood] = useState<ContentGetResponse | undefined>(undefined);
  if (loaded && loaded !== lastGood) setLastGood(loaded);
  const source = loaded ?? lastGood;

  const page = useMemo(() => (source ? getPageDefinition(source.schema.pages, slug) : undefined), [source, slug]);

  const [activeSection, setActiveSection] = useState("");

  /** Only the fields the editor has touched. Everything else reads through to the baseline. */
  const [overlay, setOverlay] = useState<Record<string, FieldState>>({});
  const [pendingImages, setPendingImages] = useState<Record<string, PendingImage>>({});
  const [preparing, setPreparing] = useState<Record<string, true>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<Failure | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [lastPublish, setLastPublish] = useState<{ commitUrl: string; commitSha: string } | null>(null);

  const [report, setReport] = useState<ConnectionReport | null>(null);
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);

  // A request that never settles used to leave the bar on "Loading..." forever.
  useEffect(() => {
    if (!published.isFetching) return;
    const timer = setTimeout(() => setWaitedTooLong(true), 15_000);
    return () => {
      clearTimeout(timer);
      setWaitedTooLong(false);
    };
  }, [published.isFetching]);

  /** Exactly one of three states, always. */
  const connection: ConnectionState = useMemo(() => {
    if (loaded && loaded.commitSha) return { kind: "connected", branch: loaded.branch, repo: loaded.repo, commitSha: loaded.commitSha };
    if (loaded) return { kind: "error", message: `GitHub did not report a current commit for ${loaded.branch}, so there is nothing safe to publish against.` };
    if (loadFailure) return { kind: "error", message: loadFailure.message };
    if (published.isError) return { kind: "error", message: describeQueryError(published.error) };
    if (waitedTooLong) {
      return {
        kind: "error",
        message: "The dashboard has been waiting more than 15 seconds for the server to reply. It may still arrive, but something is probably wrong. Try Check connection, or Retry.",
      };
    }
    return { kind: "connecting" };
  }, [loaded, loadFailure, published.isError, published.error, waitedTooLong]);

  /** What the branch currently has, per field. */
  const baseline = useMemo(() => {
    const next: Record<string, FieldState> = {};
    if (!page || !source) return next;
    for (const section of page.sections) {
      for (const field of section.fields) {
        next[keyOf(section.key, field.key)] = stateFromValue(field, source.content[slug]?.[section.key]?.[field.key]);
      }
    }
    return next;
  }, [page, source, slug]);

  const changed = useMemo(() => {
    const keys = new Set<string>();
    for (const [key, state] of Object.entries(overlay)) {
      if (!sameState(state, baseline[key])) keys.add(key);
    }
    for (const key of Object.keys(pendingImages)) keys.add(key);
    return keys;
  }, [overlay, baseline, pendingImages]);

  const isDirty = changed.size > 0;
  const canPublish = connection.kind === "connected" && isDirty;

  // Warn before leaving: in-app navigation here, browser close/reload below.
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }: { currentLocation: { pathname: string; search: string }; nextLocation: { pathname: string; search: string } }) =>
        isDirty && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
      [isDirty],
    ),
  );

  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Release the object URLs the image previews hold.
  const previewUrls = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current = [];
    };
  }, []);

  const valueFor = useCallback((key: string): FieldState => overlay[key] ?? baseline[key] ?? EMPTY, [overlay, baseline]);

  const setField = (key: string, patch: Partial<FieldState>) =>
    setOverlay((current) => ({ ...current, [key]: { ...(current[key] ?? baseline[key] ?? EMPTY), ...patch } }));

  const dropPendingImage = (key: string) => {
    const pending = pendingImages[key];
    if (pending) URL.revokeObjectURL(pending.previewUrl);
    setPendingImages((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setImageErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const revertField = (key: string) => {
    setOverlay((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    dropPendingImage(key);
  };

  const discardAll = () => {
    for (const pending of Object.values(pendingImages)) URL.revokeObjectURL(pending.previewUrl);
    setOverlay({});
    setPendingImages({});
    setImageErrors({});
    setConflict(null);
    setFailure(null);
  };

  async function attachImage(key: string, file: File) {
    setPreparing((current) => ({ ...current, [key]: true }));
    setImageErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      const prepared = await prepareImage(file);
      previewUrls.current.push(prepared.previewUrl);
      const existing = pendingImages[key];
      if (existing) URL.revokeObjectURL(existing.previewUrl);
      setPendingImages((current) => ({ ...current, [key]: prepared }));
    } catch (error) {
      setImageErrors((current) => ({ ...current, [key]: error instanceof Error ? error.message : String(error) }));
    } finally {
      setPreparing((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  }

  const diagnose = useMutation({
    mutationFn: () => callFunction<DiagnoseResponse>("site-diagnose", { site_id: site.id }),
    onSuccess: (result) => {
      if (result.ok) {
        setReport({ allPassed: result.allPassed, checks: result.checks });
        return;
      }
      setReport({
        allPassed: false,
        checks: [
          {
            id: "diagnostic",
            label: "The connection check could not run",
            status: "fail",
            detail: result.message,
            fix: "Reload the page and try again. If it keeps failing, the dashboard's server functions are not deployed or not answering. Ask the agency to check the deployment (docs/SETUP.md, part C).",
          },
        ],
      });
    },
    onError: (error: Error) => {
      setReport({
        allPassed: false,
        checks: [
          {
            id: "diagnostic",
            label: "The connection check could not reach the server",
            status: "fail",
            detail: error.message,
            fix: "The dashboard's server functions are not answering at all. Check your internet connection, then ask the agency to check the deployment.",
          },
        ],
      });
    },
  });

  const publish = useMutation({
    mutationFn: async (): Promise<PublishResponse | Failure> => {
      if (!loaded) throw new Error("The published content has not loaded yet.");
      if (!page) throw new Error("Unknown page.");

      const fieldByKey = new Map<string, { section: PageSection; field: PageField }>();
      for (const section of page.sections) {
        for (const field of section.fields) fieldByKey.set(keyOf(section.key, field.key), { section, field });
      }

      const fields: FieldUpdate[] = [];
      for (const key of changed) {
        // A pending upload decides its own field's value on the server.
        if (pendingImages[key]) continue;
        const entry = fieldByKey.get(key);
        if (!entry) continue;
        fields.push({ section: entry.section.key, field: entry.field.key, value: valueFromState(entry.field, valueFor(key)) });
      }

      const images: ImageUpload[] = [];
      for (const [key, pending] of Object.entries(pendingImages)) {
        const entry = fieldByKey.get(key);
        if (!entry) continue;
        images.push({
          section: entry.section.key,
          field: entry.field.key,
          filename: pending.file.name,
          contentType: pending.file.type,
          dataBase64: await fileToBase64(pending.file),
        });
      }

      const request: PublishRequest = { site_id: site.id, slug, baseCommitSha: loaded.commitSha, fields, images };
      return callFunction<PublishResponse>("content-publish", request);
    },
    onMutate: () => {
      setConflict(null);
      setFailure(null);
    },
    onSuccess: async (result) => {
      if (result.ok) {
        for (const pending of Object.values(pendingImages)) URL.revokeObjectURL(pending.previewUrl);
        setOverlay({});
        setPendingImages({});
        setImageErrors({});
        setLastPublish({ commitUrl: result.commitUrl, commitSha: result.commitSha });
        toast.show("Published. Live in about 2 minutes.");
        await published.refetch();
        void queryClient.invalidateQueries({ queryKey: ["publishes"] });
        void queryClient.invalidateQueries({ queryKey: ["site-publishes"] });
        void queryClient.invalidateQueries({ queryKey: siteQueryKey(site.id) });
        return;
      }
      if (result.code === "conflict") {
        setConflict(result);
        return;
      }
      setFailure(result);
    },
    onError: (error: Error) => {
      setFailure({ ok: false, code: "github_error", message: error.message, fields: [] });
    },
  });

  /** Why Publish is off, when there are changes waiting. Null means it is enabled. */
  const publishBlockedReason =
    !isDirty || publish.isPending || canPublish
      ? null
      : connection.kind === "connecting"
        ? "Publish is off until the dashboard finishes connecting to GitHub."
        : 'Publish is off because the dashboard is not connected to GitHub. Use "Check connection" to see which step is failing.';

  const pagesPath = `/sites/${site.id}/pages`;
  const backLink = (
    <Link to={pagesPath} className="inline-flex h-11 items-center gap-2 text-[13px] font-medium text-muted hover:text-text">
      <IconArrowLeft size={16} /> All pages
    </Link>
  );

  if (source && !page) {
    return (
      <div className="flex flex-col gap-5">
        {backLink}
        <Notice
          kind="warning"
          title="Page not found"
          action={
            <LinkButton to={pagesPath} variant="secondary" size="sm">
              Back to pages
            </LinkButton>
          }
        >
          This page is not in the content registry.
        </Notice>
      </div>
    );
  }

  const section = page?.sections.find((item) => item.key === activeSection) ?? page?.sections[0];
  const changedInSection = (item: PageSection) => item.fields.filter((field) => changed.has(keyOf(item.key, field.key))).length;
  const live = page ? liveHref(site.live_url, page.path) : null;
  const warnings = source?.warnings ?? [];

  const checkConnectionButton = (variant: "primary" | "secondary" | "ghost", size: "sm" | "bar" = "bar") => (
    <Button variant={variant} size={size} loading={diagnose.isPending} onClick={() => diagnose.mutate()}>
      {!diagnose.isPending && <IconStethoscope size={16} />}
      {diagnose.isPending ? "Checking…" : "Check connection"}
    </Button>
  );

  const sectionList = page ? (
    <nav aria-label="Sections" className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
      {page.sections.map((item) => {
        const count = changedInSection(item);
        const active = item.key === section?.key;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={active}
            onClick={() => setActiveSection(item.key)}
            className={clsx(
              "flex h-11 shrink-0 items-center justify-between gap-2 rounded-sm px-2.5 text-[13px] lg:h-9 lg:w-full",
              active ? "bg-blue-soft font-semibold text-blue" : "font-medium text-text hover:bg-ground",
            )}
          >
            <span className="flex items-center gap-2">
              <IconLayers size={15} className={active ? "text-blue" : "text-muted"} />
              <span className="whitespace-nowrap">{item.label}</span>
            </span>
            {count > 0 && (
              <Pill tone="blue">
                {count}
                <SrOnly> changed</SrOnly>
              </Pill>
            )}
          </button>
        );
      })}
    </nav>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {backLink}

      <PageHeader
        title={page?.label ?? slug}
        description={page?.description}
        meta={
          page ? (
            <>
              <span className="font-mono text-[13px]">{page.path}</span>
              {live && (
                <a href={live} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-text underline-offset-2 hover:underline">
                  View live page <IconExternal size={13} />
                  <SrOnly>(opens in a new tab)</SrOnly>
                </a>
              )}
            </>
          ) : undefined
        }
      />

      {/* Publish bar: exactly one connection state always renders. */}
      <div className="sticky top-14 z-20 -mx-4 border-y border-line bg-panel px-4 py-2.5 sm:-mx-6 sm:px-6 shell:top-0 shell:-mx-8 shell:px-8">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className={clsx("font-semibold", isDirty ? "text-accent" : "text-muted")}>
              {isDirty ? `${changed.size} unpublished ${changed.size === 1 ? "change" : "changes"}` : "No unpublished changes"}
            </span>
            <span className="hidden h-6 w-px bg-line sm:block" aria-hidden="true" />
            {connection.kind === "connecting" && (
              <span className="inline-flex items-center gap-2 text-muted" role="status">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber" /> Connecting to GitHub…
              </span>
            )}
            {connection.kind === "connected" && (
              <span className="inline-flex items-center gap-2 text-muted">
                <span className="h-2 w-2 rounded-full bg-green" />
                editing {connection.branch} @ <span className="font-mono">{shortSha(connection.commitSha)}</span>
              </span>
            )}
            {connection.kind === "error" && (
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber">
                <IconAlert size={16} /> Not connected to GitHub
              </span>
            )}
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <div className="hidden sm:block">{checkConnectionButton("ghost")}</div>
            <IconButton label={diagnose.isPending ? "Checking the connection" : "Check connection"} size="md" className="sm:hidden" onClick={() => diagnose.mutate()} disabled={diagnose.isPending}>
              <IconStethoscope size={18} />
            </IconButton>
            <Button variant="secondary" size="bar" disabled={!isDirty || publish.isPending} onClick={discardAll}>
              <IconUndo size={16} /> Discard all
            </Button>
            <Button size="bar" className="flex-1 sm:flex-none" disabled={!canPublish} loading={publish.isPending} onClick={() => publish.mutate()}>
              {publish.isPending ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
        {publishBlockedReason && <p className="mx-auto mt-2 max-w-[1180px] text-[13px] text-amber">{publishBlockedReason}</p>}
        {publish.isPending && (
          <p className="mx-auto mt-2 max-w-[1180px] text-[13px] text-muted" role="status">
            Committing your changes to the site repository. This triggers a rebuild; keep this tab open until it finishes.
          </p>
        )}
        {isDirty && !publish.isPending && !publishBlockedReason && (
          <p className="mx-auto mt-2 max-w-[1180px] text-[13px] text-muted">Nothing is live until you press Publish. Your changes are only in this browser.</p>
        )}
      </div>

      {/* Publishing not available: shown for EVERY way the connection can fail */}
      {connection.kind === "error" && (
        <Notice
          kind="warning"
          title="Publishing is unavailable"
          action={
            <>
              {checkConnectionButton("primary", "sm")}
              <Button
                variant="secondary"
                size="sm"
                disabled={published.isFetching}
                onClick={() => {
                  setWaitedTooLong(false);
                  void published.refetch();
                }}
              >
                <IconUndo size={16} /> Retry
              </Button>
            </>
          }
        >
          <p>{connection.message}</p>
          <p className="mt-2">
            {page
              ? "The fields below show the content from the current build so you can read it, but they cannot be published until this is fixed."
              : "The page's fields will appear here once the site's content can be read."}
          </p>
        </Notice>
      )}

      {report && <CheckList report={report} onHide={() => setReport(null)} />}

      {lastPublish && !isDirty && (
        <Notice kind="success" title="Published. Your changes will be live in about 2 minutes.">
          <a href={lastPublish.commitUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center gap-1.5 font-mono underline underline-offset-2">
            View the commit ({shortSha(lastPublish.commitSha)})
            <IconExternal size={13} />
            <SrOnly>(opens in a new tab)</SrOnly>
          </a>
        </Notice>
      )}

      {conflict && (
        <Notice
          kind="danger"
          title="Nothing was published"
          action={
            <>
              <Button
                size="sm"
                onClick={() => {
                  setConflict(null);
                  void published.refetch();
                }}
              >
                Reload and keep my changes
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  discardAll();
                  void published.refetch();
                }}
              >
                Discard my changes and reload
              </Button>
            </>
          }
        >
          <p>{conflict.message}</p>
          {(conflict.fields ?? []).length > 0 && (
            <ul className="mt-2 list-inside list-disc">
              {(conflict.fields ?? []).map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {failure && (
        <Notice kind="danger" title="Nothing was published">
          {failure.message}
        </Notice>
      )}

      <Modal
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        title="You have unpublished changes"
        footer={
          <>
            <Button variant="secondary" onClick={() => blocker.reset?.()}>
              Stay on this page
            </Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              Leave and discard
            </Button>
          </>
        }
      >
        <p className="text-[14px] leading-relaxed text-text">
          Leaving this page will discard {plural(changed.size, "change")} that {changed.size === 1 ? "has" : "have"} not been published.
        </p>
      </Modal>

      {warnings.length > 0 && (
        <Notice
          kind="warning"
          title="Notes about this site's content"
          action={
            <Button variant="secondary" size="sm" aria-expanded={showWarnings} onClick={() => setShowWarnings((current) => !current)}>
              {showWarnings ? "Hide notes" : `Show ${plural(warnings.length, "note")}`}
            </Button>
          }
        >
          {showWarnings && (
            <ul className="list-disc space-y-1 pl-5">
              {warnings.map((warning, index) => (
                <li key={`${index}-${warning}`}>{warning}</li>
              ))}
            </ul>
          )}
        </Notice>
      )}

      {page && section ? (
        <div className="grid items-start gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
          <aside className="rounded-card border border-line bg-panel p-2 lg:sticky lg:top-[68px]">
            <div className="mb-1 hidden px-2.5 pt-1 text-[12px] font-semibold text-muted lg:block">Sections</div>
            {sectionList}
          </aside>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
              <h2 className="font-display text-[18px] font-semibold text-text">{section.label}</h2>
              <span className="text-[12px] text-muted">{plural(section.fields.length, "field")}</span>
            </div>
            {section.fields.length === 0 && <Notice title="Nothing to edit in this section">This section has no editable fields.</Notice>}
            {section.fields.map((field) => {
              const key = keyOf(section.key, field.key);
              return (
                <FieldCard
                  key={key}
                  section={section}
                  field={field}
                  value={valueFor(key)}
                  pending={pendingImages[key]}
                  preparing={Boolean(preparing[key])}
                  imageError={imageErrors[key]}
                  isChanged={changed.has(key)}
                  busy={publish.isPending}
                  liveUrl={site.live_url}
                  onChange={(patch) => setField(key, patch)}
                  onRevert={() => revertField(key)}
                  onAttach={(file) => void attachImage(key, file)}
                />
              );
            })}
          </div>
        </div>
      ) : page ? (
        <Notice title="Nothing to edit on this page">This page has no editable sections.</Notice>
      ) : connection.kind === "connecting" ? (
        <div className="grid items-start gap-4 lg:grid-cols-[264px_minmax(0,1fr)]" role="status" aria-label="Loading content">
          <div className="space-y-2 rounded-card border border-line bg-panel p-3">
            <Skeleton className="w-24" />
            <Skeleton className="w-32" />
            <Skeleton className="w-20" />
          </div>
          <div className="space-y-4">
            <div className="space-y-3 rounded-card border border-line bg-panel p-5">
              <Skeleton className="w-40" />
              <Skeleton className="h-11" />
            </div>
            <div className="space-y-3 rounded-card border border-line bg-panel p-5">
              <Skeleton className="w-32" />
              <Skeleton className="h-28" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
