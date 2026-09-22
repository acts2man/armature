/**
 * The centre of the visual editor: the live site in an iframe, scaled to the chosen
 * device width, with the "armature wire" selection and hover outlines drawn ABOVE the
 * frame from the rectangles the bridge reports, so the site's own CSS can never break
 * them. Also every connection state, none of them silent.
 */
import { clsx } from "clsx";
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { IconAlert, IconBranch, IconImage, IconLink, IconPencil, IconRefresh, IconUndo } from "@/components/icons.tsx";
import { Button, LinkButton } from "@/components/ui.tsx";
import type { SiteSchema } from "@shared/schema.ts";
import { fieldRoot, type FieldPath, type MappedField } from "@shared/visualProtocol.ts";
import { fieldMeta } from "./draftStore.ts";
import { useGeometry, type GeometryStore } from "./geometry.ts";
import type { Connection } from "./useBridge.ts";

const SHEET_TOP = 20;

export type ToolbarActions = {
  onEditInline: (path: FieldPath) => void;
  onReplaceImage: (path: FieldPath) => void;
  onEditLink: (path: FieldPath) => void;
  onRevert: (root: FieldPath) => void;
  onRequestChange: (path: FieldPath) => void;
};

function Handle({ className }: { className: string }) {
  return <span aria-hidden="true" className={clsx("absolute h-2 w-2 border-2 border-accent bg-white", className)} />;
}

/** The outlines, the label chip and the floating toolbar, at 60fps from the geometry store. */
function Overlays({
  store,
  scale,
  schema,
  selectedPath,
  changed,
  editing,
  actions,
}: {
  store: GeometryStore;
  scale: number;
  schema: SiteSchema;
  selectedPath: FieldPath | null;
  changed: Set<FieldPath>;
  editing: boolean;
  actions: ToolbarActions;
}) {
  const geometry = useGeometry(store);
  const hover = geometry.hover && geometry.hover.path !== selectedPath ? geometry.hover : null;
  const selected = selectedPath && geometry.selected && geometry.selected.path === selectedPath ? geometry.selected : null;
  const box = (field: MappedField, pad: number) => ({
    left: field.rect.x * scale - pad,
    top: field.rect.y * scale - pad,
    width: field.rect.width * scale + pad * 2,
    height: field.rect.height * scale + pad * 2,
  });
  const meta = selected ? fieldMeta(schema, selected.path) : null;
  const hoverMeta = hover ? fieldMeta(schema, hover.path) : null;
  const root = selected ? fieldRoot(selected.path) : null;

  const toolbarTop = selected ? selected.rect.y * scale - 60 : 0;
  const toolbarBelow = toolbarTop < 4;

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden={selected ? undefined : true}>
      {hover && (
        <div className="absolute rounded-[2px] outline-dashed outline-1 outline-accent/70 transition-[left,top,width,height] duration-75" style={box(hover, 2)}>
          <span className="absolute -top-[22px] left-0 flex h-[22px] max-w-64 items-center truncate bg-accent/85 px-2 text-[11px] font-semibold text-accent-fg">
            {hoverMeta?.label ?? hover.path}
          </span>
        </div>
      )}
      {selected && (
        <div data-testid="selection-outline" className="absolute outline outline-[1.5px] outline-accent" style={box(selected, 6)}>
          <Handle className="-left-[5px] -top-[5px]" />
          <Handle className="-right-[5px] -top-[5px]" />
          <Handle className="-bottom-[5px] -left-[5px]" />
          <Handle className="-bottom-[5px] -right-[5px]" />
        </div>
      )}
      {selected && meta && !editing && (
        <div
          role="toolbar"
          aria-label={`${meta.label} tools`}
          data-testid="selection-toolbar"
          className="toast-in pointer-events-auto absolute flex h-11 items-center gap-0.5 rounded-[10px] bg-ink px-1.5 text-white shadow-dark"
          style={{
            left: Math.max(4, Math.min(selected.rect.x * scale - 4, Math.max(4, (store.get().viewport.width || 0) * scale - 360))),
            top: toolbarBelow ? (selected.rect.y + selected.rect.height) * scale + 14 : toolbarTop,
          }}
        >
          <span className="flex h-9 items-center gap-1.5 rounded-sm bg-ink-2 px-2.5 text-[13px] font-semibold">
            <span className="max-w-40 truncate">{meta.label}</span>
            <span className="text-[11px] font-medium text-ink-text">{meta.section.label}</span>
          </span>
          <span className="mx-1 h-5 w-px bg-ink-line" />
          {selected.kind !== "image" && (
            <button type="button" title={selected.inline ? "Edit text on the page (Enter)" : "Edit text"} aria-label="Edit text" onClick={() => actions.onEditInline(selected.path)} className="inline-flex h-9 min-w-9 items-center justify-center rounded-sm px-1.5 hover:bg-ink-2">
              <IconPencil size={16} />
            </button>
          )}
          {(selected.kind === "image" || meta.field.type === "image" || meta.itemField?.type === "image") && (
            <button type="button" title="Replace image" aria-label="Replace image" onClick={() => actions.onReplaceImage(selected.path)} className="inline-flex h-9 min-w-9 items-center justify-center rounded-sm px-1.5 hover:bg-ink-2">
              <IconImage size={16} />
            </button>
          )}
          {(selected.kind === "link" || meta.field.type === "link" || meta.field.type === "url" || meta.itemField?.type === "url") && (
            <button type="button" title="Edit link" aria-label="Edit link" onClick={() => actions.onEditLink(selected.path)} className="inline-flex h-9 min-w-9 items-center justify-center rounded-sm px-1.5 hover:bg-ink-2">
              <IconLink size={16} />
            </button>
          )}
          <button
            type="button"
            title="Revert to published"
            aria-label="Revert to published"
            disabled={!root || !changed.has(root)}
            onClick={() => root && actions.onRevert(root)}
            className="inline-flex h-9 min-w-9 items-center justify-center rounded-sm px-1.5 hover:bg-ink-2 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <IconUndo size={16} />
          </button>
          <span className="mx-1 h-5 w-px bg-ink-line" />
          <button type="button" onClick={() => actions.onRequestChange(selected.path)} className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2.5 text-[13px] font-semibold hover:bg-ink-2">
            <IconBranch size={15} /> Request a change
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Transparent targets over every picture on the page: a click selects it, a file
 * dropped on it replaces it. They sit above the frame because a cross-origin frame
 * never hands the editor its drag events.
 */
function ImageTargets({ store, scale, onSelect, onDrop }: { store: GeometryStore; scale: number; onSelect: (path: FieldPath) => void; onDrop: (path: FieldPath, file: File) => void }) {
  const geometry = useGeometry(store);
  const [over, setOver] = useState<FieldPath | null>(null);
  const images = geometry.fields.filter((field) => field.kind === "image");
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const enter = (event: globalThis.DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      depth += 1;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const end = () => {
      depth = 0;
      setDragging(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", end);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", end);
      window.removeEventListener("dragend", end);
    };
  }, []);
  const accept = (event: DragEvent) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };
  return (
    <>
      {images.map((field) => (
        <div
          key={field.path}
          data-testid={`image-target-${field.path}`}
          role="button"
          tabIndex={-1}
          aria-label={`Picture ${field.path}: click to select, drop an image to replace`}
          onClick={() => onSelect(field.path)}
          onDragOver={(event) => {
            accept(event);
            setOver(field.path);
          }}
          onDragEnter={accept}
          onDragLeave={() => setOver((current) => (current === field.path ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            setOver(null);
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) onDrop(field.path, file);
          }}
          className={clsx(
            "absolute rounded-[2px] transition-opacity duration-150",
            dragging ? "pointer-events-auto" : "pointer-events-auto",
            over === field.path ? "bg-accent/15 outline outline-2 outline-dashed outline-accent" : dragging ? "outline outline-1 outline-dashed outline-accent/60" : "",
          )}
          style={{ left: field.rect.x * scale, top: field.rect.y * scale, width: field.rect.width * scale, height: field.rect.height * scale }}
        >
          {over === field.path && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="rounded-control bg-ink px-3 py-1.5 text-[12px] font-semibold text-white shadow-dark">Drop to replace</span>
            </span>
          )}
        </div>
      ))}
    </>
  );
}

function StateCard({ icon, title, children, actions, tone = "info" }: { icon: ReactNode; title: string; children?: ReactNode; actions?: ReactNode; tone?: "info" | "warning" }) {
  return (
    <div role={tone === "warning" ? "alert" : "status"} className="toast-in flex w-[min(520px,90%)] flex-col gap-3 rounded-card border border-line bg-panel p-6 shadow-sheet">
      <div className="flex items-center gap-3">
        <span className={clsx("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control", tone === "warning" ? "bg-amber-soft text-amber" : "bg-ground text-text")}>{icon}</span>
        <h2 className="font-display text-[18px] font-semibold text-text">{title}</h2>
      </div>
      {children && <div className="text-[14px] leading-relaxed text-muted">{children}</div>}
      {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6 p-9">
      <div className="flex items-center justify-between">
        <span className="skeleton h-6 w-32" />
        <span className="flex gap-4">
          <span className="skeleton h-4 w-14" />
          <span className="skeleton h-4 w-14" />
          <span className="skeleton h-9 w-36 rounded-sm" />
        </span>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-8">
        <div className="flex flex-col gap-4">
          <span className="skeleton h-10 w-4/5" />
          <span className="skeleton h-10 w-3/5" />
          <span className="skeleton h-4 w-full" />
          <span className="skeleton h-4 w-5/6" />
          <span className="skeleton mt-2 h-11 w-40 rounded-sm" />
        </div>
        <span className="skeleton h-64 rounded-control" />
      </div>
      <div className="grid grid-cols-3 gap-6">
        <span className="skeleton h-24" />
        <span className="skeleton h-24" />
        <span className="skeleton h-24" />
      </div>
    </div>
  );
}

export function Canvas({
  iframeRef,
  src,
  attempt,
  onLoad,
  connection,
  onRetry,
  deviceWidth,
  store,
  schema,
  selectedPath,
  changed,
  editing,
  preview,
  actions,
  onSelectImage,
  onDropImage,
  formEditorHref,
  siteName,
  hint,
}: {
  iframeRef: React.RefObject<HTMLIFrameElement>;
  src: string | null;
  attempt: number;
  onLoad: () => void;
  connection: Connection;
  onRetry: () => void;
  deviceWidth: number;
  store: GeometryStore;
  schema: SiteSchema;
  selectedPath: FieldPath | null;
  changed: Set<FieldPath>;
  editing: boolean;
  preview: boolean;
  actions: ToolbarActions;
  onSelectImage: (path: FieldPath) => void;
  onDropImage: (path: FieldPath, file: File) => void;
  formEditorHref: string;
  siteName: string;
  hint: string | null;
}) {
  const main = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  useLayoutEffect(() => {
    const element = main.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = Math.min(1, Math.max(0.1, (size.width - 40) / deviceWidth));
  const sheetWidth = Math.round(deviceWidth * scale);
  const sheetHeight = Math.max(200, size.height - SHEET_TOP);
  const ready = connection.status === "ready";
  const showFrame = src !== null && connection.status !== "error";

  return (
    <main ref={main} className="relative flex min-w-0 flex-1 justify-center overflow-hidden" style={{ paddingTop: SHEET_TOP }} data-testid="canvas" data-device-width={deviceWidth} data-scale={scale.toFixed(3)}>
      <div
        className="relative overflow-hidden rounded-t-[10px] bg-panel shadow-sheet transition-[width] duration-200 ease-[var(--ease-standard)]"
        style={{ width: sheetWidth, height: sheetHeight }}
        data-testid="sheet"
      >
        {showFrame && (
          <iframe
            key={attempt}
            ref={iframeRef}
            src={src}
            title={`${siteName}, live site`}
            onLoad={onLoad}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="strict-origin-when-cross-origin"
            className={clsx("block origin-top-left border-0 bg-white transition-opacity duration-200", ready ? "opacity-100" : "opacity-0")}
            style={{ width: deviceWidth, height: Math.ceil(sheetHeight / scale), transform: `scale(${scale})` }}
          />
        )}
        {!ready && connection.status !== "error" && (
          <div className="absolute inset-0 bg-panel" role="status" aria-live="polite">
            <Skeleton />
            <p className="absolute inset-x-0 bottom-8 text-center text-[13px] font-medium text-muted">
              {connection.status === "loading" ? "Loading your site…" : "Connecting the editor…"}
            </p>
          </div>
        )}
        {ready && !preview && (
          <>
            <ImageTargets store={store} scale={scale} onSelect={onSelectImage} onDrop={onDropImage} />
            <Overlays store={store} scale={scale} schema={schema} selectedPath={selectedPath} changed={changed} editing={editing} actions={actions} />
          </>
        )}
        {ready && preview && (
          <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink/85 px-3 py-1.5 text-[12px] font-semibold text-white">Preview: links work normally</span>
        )}
      </div>

      {connection.status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-ground/70 p-6">
          <StateCard
            tone="warning"
            icon={<IconAlert size={20} />}
            title={connection.title}
            actions={
              <>
                <LinkButton to={formEditorHref} size="sm">
                  Use the page editor
                </LinkButton>
                {connection.kind !== "no_live_url" && connection.kind !== "bad_url" && (
                  <Button variant="secondary" size="sm" onClick={onRetry}>
                    <IconRefresh size={16} /> Try again
                  </Button>
                )}
              </>
            }
          >
            <p>{connection.message}</p>
            {connection.fix && <p className="mt-2 text-text">{connection.fix}</p>}
            {connection.snippet && <pre className="mt-2 whitespace-pre-wrap break-all rounded-control bg-ground p-3 font-mono text-[12px] text-text">{connection.snippet}</pre>}
            {connection.kind === "timeout" && (
              <p className="mt-2 text-[13px]">
                Everything you change here is still published the same way: the <Link to={formEditorHref} className="font-semibold text-text underline underline-offset-2">page editor</Link> edits the same fields.
              </p>
            )}
          </StateCard>
        </div>
      )}

      {hint && (
        <div role="status" className="toast-in pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-control bg-ink px-4 py-2.5 text-[13px] font-medium text-white shadow-dark">
          {hint}
        </div>
      )}
    </main>
  );
}
