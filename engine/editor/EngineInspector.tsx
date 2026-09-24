/**
 * The Edit mode of the engine's left panel for the selected element: the header (back to
 * Elements, "Edit <label>", breadcrumbs of the parent chain) and the Content / Style /
 * Advanced tabs. Content edits the words, picture or link the server found in the code,
 * with plain notes when something comes from live data or is controlled by code. Style
 * reads the element's computed style and writes CSS declarations for the current device.
 * Advanced edits the className and shows where the element lives in the code.
 */
import { clsx } from "clsx";
import { useMemo, useState, type ReactNode } from "react";
import type { SiteKit } from "../../shared/builder/index.ts";
import type { ElementRect } from "../../shared/visualProtocol.ts";
import { ControlRenderer, type ControlTarget } from "../../src/builder/controls/ControlRenderer.tsx";
import type { Path } from "../../src/builder/controls/types.ts";
import { IconChevronRight, IconCode, IconGauge, IconGrid, IconImage, IconInfo, IconLayers, IconPencil, IconSettings, IconSparkle } from "../../src/components/icons.tsx";
import { Button, LinkButton } from "../../src/components/ui.tsx";
import { modelDevice, type Device } from "../../src/visual/pages.ts";
import type { Declarations, EditOp, NodeRef, Reason, ResolvedNode } from "../shared/types.ts";
import { STYLE_SPECS, readStyle, toDeclarations } from "./styleTarget.tsx";
import { refOf } from "./nodes.ts";
import type { EngineNodeInfo } from "./useEngineBridge.ts";

export type InspectorTab = "content" | "style" | "advanced";

export type EngineInspectorActions = {
  onSelect: (id: string) => void;
  onBackToElements: () => void;
  onApply: (op: EditOp, label: string) => void;
  /** Style declarations for the current device, merged per group and sent after a short pause. */
  onStyle: (target: NodeRef, declarations: Declarations, group: string) => void;
  onEditOnPage: (id: string) => void;
};

const inputClass = "h-9 w-full rounded-control border border-line bg-panel px-2.5 text-[13px] text-text focus:border-accent";

/** Enter commits a single-line field the same way leaving it does. */
const blurOnEnter = (event: React.KeyboardEvent<HTMLInputElement>) => {
  if (event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.blur();
  }
};

function Note({ kind, title, children, icon }: { kind: "live-data" | "code" | "shared" | "info" | "prop" | "unsupported"; title?: string; children: ReactNode; icon?: ReactNode }) {
  const tone = kind === "live-data" ? "border-blue/30 bg-blue-soft text-blue" : kind === "shared" ? "border-amber/30 bg-amber-soft text-amber" : "border-line bg-ground/60 text-muted";
  const defaultIcon = kind === "live-data" ? <IconSparkle size={14} /> : kind === "shared" ? <IconLayers size={14} /> : kind === "code" || kind === "prop" || kind === "unsupported" ? <IconCode size={14} /> : <IconInfo size={14} />;
  return (
    <div className={clsx("mx-5 mt-3 rounded-control border p-3 text-[12px] leading-relaxed", tone)} data-testid="engine-note" data-kind={kind} role="note">
      {title && (
        <p className="flex items-center gap-1.5 font-semibold">
          {icon ?? defaultIcon} {title}
        </p>
      )}
      <div className={clsx(title && "mt-1")}>{children}</div>
    </div>
  );
}

const reasonTitle = (reason: Reason): string => (reason.kind === "live-data" ? "This comes from live data" : reason.kind === "prop" ? "This is passed in from another component" : reason.kind === "unsupported" ? "This cannot be edited here yet" : "This is controlled by code");
const reasonKind = (reason: Reason) => (reason.kind === "live-data" ? "live-data" : reason.kind === "code" ? "code" : reason.kind);

function Crumbs({ chain, label, onSelect }: { chain: { id: string; label: string }[]; label: string; onSelect: (id: string) => void }) {
  return (
    <nav aria-label="Parents" className="flex flex-wrap items-center gap-0.5 text-[12px] text-muted" data-testid="breadcrumbs">
      {chain.map((crumb) => (
        <span key={crumb.id} className="flex items-center gap-0.5">
          <button type="button" onClick={() => onSelect(crumb.id)} className="rounded-sm px-1 hover:bg-ground hover:text-text">
            {crumb.label}
          </button>
          <IconChevronRight size={12} />
        </span>
      ))}
      <span className="font-semibold text-text">{label}</span>
    </nav>
  );
}

function Row({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 pt-3">
      <label htmlFor={htmlFor} className="text-[12px] font-semibold text-text">
        {label}
      </label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

const readFile = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.onload = () => resolve(String(reader.result ?? "").replace(/^data:[^,]*,/, ""));
    reader.readAsDataURL(file);
  });

function ContentTab({ id, node, target, previewUrl, actions }: { id: string; node: ResolvedNode; target: NodeRef; previewUrl: string; actions: EngineInspectorActions }) {
  const text = node.text;
  const image = node.image;
  const link = node.link;
  const [draft, setDraft] = useState(text?.value ?? "");
  const [alt, setAlt] = useState(image?.alt ?? "");
  const [src, setSrc] = useState(image?.src ?? "");
  const [href, setHref] = useState(link?.href ?? "");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const commitText = () => {
    if (!text || !text.editable || draft === text.value) return;
    actions.onApply({ op: "text", target, value: draft }, "Changed the words");
  };
  const preview = (() => {
    const current = image?.src;
    if (!current) return null;
    try {
      return new URL(current, previewUrl).toString();
    } catch {
      return current;
    }
  })();
  const nothing = !text && !image && !link && !node.childrenNote;
  return (
    <>
      {node.shared && (
        <Note kind="shared" title={`Part of ${node.shared.component}`}>
          This is part of {node.shared.component}, which appears on {node.shared.usedIn.length === 1 ? "1 page" : `${node.shared.usedIn.length} pages`} ({node.shared.usedIn.join(", ")}); a change here applies everywhere it is used.
        </Note>
      )}
      {text && !text.editable && (
        <Note kind={reasonKind(text.reason)} title={reasonTitle(text.reason)}>
          {text.reason.message}
        </Note>
      )}
      {node.childrenNote && (
        <Note kind={reasonKind(node.childrenNote)} title={reasonTitle(node.childrenNote)}>
          {node.childrenNote.message}
        </Note>
      )}
      {text && text.editable && (
        <>
          <Row label={node.kind === "heading" ? "Title" : node.kind === "button" ? "Label" : "Text"} htmlFor="engine-text-input" hint={[text.inData ? `Part of ${text.inData}.` : null, text.dbNote ?? null].filter(Boolean).join(" ") || undefined}>
            <textarea
              id="engine-text-input"
              data-testid="engine-text-input"
              value={draft}
              rows={node.kind === "heading" || node.kind === "button" ? 2 : 5}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitText}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  commitText();
                }
              }}
              className={clsx(inputClass, "min-h-16 py-2 leading-relaxed")}
            />
          </Row>
          <div className="px-5 pt-2">
            <Button variant="secondary" size="sm" onClick={() => actions.onEditOnPage(id)} data-testid="engine-edit-on-page">
              <IconPencil size={14} /> Edit on page
            </Button>
          </div>
        </>
      )}
      {image && (
        <>
          {!image.editable && (
            <Note kind={reasonKind(image.reason)} title={reasonTitle(image.reason)}>
              {image.reason.message}
            </Note>
          )}
          {preview && (
            <div className="mx-5 mt-3 overflow-hidden rounded-control border border-line bg-ground">
              <img src={preview} alt={image.alt ?? ""} className="max-h-40 w-full object-contain" data-testid="engine-picture-preview" />
            </div>
          )}
          {image.editable && (
            <>
              <Row label="Alt text" htmlFor="engine-alt-input" hint={image.altEditable ? "Describes the picture for screen readers and search engines." : "The alt text is set by code."}>
                <input id="engine-alt-input" data-testid="engine-alt-input" value={alt} disabled={!image.altEditable} onChange={(event) => setAlt(event.target.value)} onKeyDown={blurOnEnter} onBlur={() => alt !== (image.alt ?? "") && actions.onApply({ op: "image", target, alt }, "Changed the alt text")} className={inputClass} />
              </Row>
              <Row label="Replace picture" htmlFor="engine-replace-picture" hint={image.dbNote ?? (image.pattern === "import" ? "The new file replaces the imported asset." : "The new file is saved under public/.")}>
                <input
                  id="engine-replace-picture"
                  data-testid="engine-replace-picture"
                  type="file"
                  accept="image/*"
                  className="text-[12px] text-muted file:mr-2 file:h-8 file:rounded-control file:border file:border-line file:bg-panel file:px-3 file:text-[12px] file:font-semibold file:text-text"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    setUploadError(null);
                    try {
                      const base64 = await readFile(file);
                      actions.onApply({ op: "image", target, upload: { name: file.name, base64 } }, "Replaced the picture");
                    } catch (error) {
                      setUploadError(error instanceof Error ? error.message : "The file could not be read.");
                    }
                    event.target.value = "";
                  }}
                />
                {uploadError && <p className="text-[11px] text-red">{uploadError}</p>}
              </Row>
              <Row label="Picture address" htmlFor="engine-src-input">
                <input id="engine-src-input" data-testid="engine-src-input" value={src} onChange={(event) => setSrc(event.target.value)} onKeyDown={blurOnEnter} onBlur={() => src.trim() && src !== image.src && actions.onApply({ op: "image", target, src: src.trim() }, "Changed the picture")} className={clsx(inputClass, "font-mono text-[12px]")} />
              </Row>
            </>
          )}
        </>
      )}
      {link && (
        <>
          {!link.editable && (
            <Note kind={reasonKind(link.reason)} title={reasonTitle(link.reason)}>
              {link.reason.message}
            </Note>
          )}
          {link.editable && (
            <Row label="Link" htmlFor="engine-href-input" hint="A page (/contact), https://, mailto: or tel:.">
              <input id="engine-href-input" data-testid="engine-href-input" value={href} onChange={(event) => setHref(event.target.value)} onKeyDown={blurOnEnter} onBlur={() => href.trim() && href !== link.href && actions.onApply({ op: "link", target, href: href.trim() }, "Changed the link")} className={clsx(inputClass, "font-mono text-[12px]")} />
            </Row>
          )}
        </>
      )}
      {nothing && <p className="px-5 pt-4 text-[13px] leading-relaxed text-muted">Nothing to edit in the Content tab for this element: it holds other elements. Use Style for its spacing and colours, or select something inside it.</p>}
    </>
  );
}

function ClassField({ node, target, actions }: { node: ResolvedNode; target: NodeRef; actions: EngineInspectorActions }) {
  const classes = node.classes;
  const [value, setValue] = useState(classes.className ?? "");
  const commit = () => {
    if (!classes.editable || value === classes.className) return;
    actions.onApply({ op: "className", target, className: value }, "Changed the classes");
  };
  return (
    <>
      {!classes.editable && (
        <Note kind={reasonKind(classes.reason)} title={reasonTitle(classes.reason)}>
          {classes.reason.message}
        </Note>
      )}
      <Row label="CSS classes" htmlFor="engine-class-input" hint={classes.editable ? (classes.literal ? "Written straight into the className in the code." : "The className has parts computed by code; only its fixed text is edited here and the dynamic parts are kept.") : undefined}>
        <textarea
          id="engine-class-input"
          data-testid="engine-class-input"
          value={value}
          disabled={!classes.editable}
          rows={3}
          onChange={(event) => setValue(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              commit();
            }
          }}
          className={clsx(inputClass, "min-h-16 py-2 font-mono text-[12px] leading-relaxed")}
        />
      </Row>
    </>
  );
}

export function EngineInspector({
  id,
  rect,
  info,
  node,
  resolving,
  resolveError,
  label,
  chain,
  computed,
  device,
  onDevice,
  tailwind,
  previewUrl,
  siteId,
  kit,
  isStaff,
  actions,
}: {
  id: string;
  rect: ElementRect | undefined;
  /** What the bridge knows before the server answers. */
  info: EngineNodeInfo | undefined;
  node: ResolvedNode | null;
  resolving: boolean;
  resolveError: string | null;
  label: string;
  chain: { id: string; label: string }[];
  computed: Record<string, string> | null;
  device: Device;
  onDevice: (device: Device) => void;
  tailwind: boolean | null;
  previewUrl: string;
  siteId: string;
  kit: SiteKit;
  isStaff: boolean;
  actions: EngineInspectorActions;
}) {
  const [tab, setTab] = useState<InspectorTab>("content");
  // Values written in the Style tab, kept until the selection changes so a control never snaps back while the preview reloads.
  const [overrides, setOverrides] = useState<Record<string, unknown>>({});
  const target = useMemo<NodeRef | null>(() => (node ? node.ref : info ? refOf(info) : null), [node, info]);
  const deviceName = device === "phone" ? "Phone" : device === "tablet" ? "Tablet" : "Desktop";

  const styleTarget = useMemo<ControlTarget | null>(() => {
    if (!target) return null;
    return {
      read: (path: Path) => (path.join(".") in overrides ? overrides[path.join(".")] : readStyle(computed, path)),
      write: (path, value, _label, group) => {
        const key = path.join(".");
        // Blur after typing repeats the same value: one write per change is enough.
        if (key in overrides && JSON.stringify(overrides[key]) === JSON.stringify(value)) return;
        setOverrides((current) => ({ ...current, [key]: value }));
        const declarations = toDeclarations(path, value, kit);
        if (declarations) actions.onStyle(target, declarations, group ?? path.join("."));
      },
      device: modelDevice(device),
      onDevice: (next) => onDevice(next === "mobile" ? "phone" : next),
      kit,
      isStaff,
    };
  }, [target, overrides, computed, kit, actions, device, onDevice, isStaff]);

  const tabs: { key: InspectorTab; label: string; icon: ReactNode }[] = [
    { key: "content", label: "Content", icon: node?.kind === "image" ? <IconImage size={16} /> : <IconPencil size={16} /> },
    { key: "style", label: "Style", icon: <IconGauge size={16} /> },
    { key: "advanced", label: "Advanced", icon: <IconSettings size={16} /> },
  ];

  let body: ReactNode;
  if (tab === "content") {
    body = node && target ? (
      <ContentTab key={id} id={id} node={node} target={target} previewUrl={previewUrl} actions={actions} />
    ) : resolveError ? (
      <Note kind="code" title="The code behind this element could not be read">
        {resolveError}
      </Note>
    ) : (
      <p className="px-5 pt-4 text-[13px] text-muted">Reading the code behind this element…</p>
    );
  } else if (tab === "style") {
    body = (
      <>
        <p className="px-5 pt-3 text-[12px] leading-relaxed text-muted" data-testid="engine-device-note">
          Editing the {deviceName} view: changes apply to this size only.
        </p>
        {tailwind === false && (
          <Note kind="info" title="Plain CSS">
            This site does not use Tailwind: styles are written into its stylesheet.
          </Note>
        )}
        {!computed && <p className="px-5 pt-3 text-[12px] text-muted">Waiting for the element's current style…</p>}
        {styleTarget && (
          <div className="pt-1">
            <ControlRenderer target={styleTarget} specs={STYLE_SPECS} />
          </div>
        )}
      </>
    );
  } else {
    body = (
      <>
        {node && target ? <ClassField key={id} node={node} target={target} actions={actions} /> : <p className="px-5 pt-4 text-[13px] text-muted">{resolving ? "Reading the code behind this element…" : "The classes could not be read."}</p>}
        <Row label="In the code">
          <p className="rounded-control bg-ground px-2.5 py-2 font-mono text-[11.5px] leading-relaxed text-text" data-testid="engine-source-location">
            {node ? `${node.file}${node.ref.loc ? `:${node.ref.loc.line}` : ""}` : info?.loc ? `${info.loc.file}:${info.loc.line}` : info?.usage ? `${info.usage.file}:${info.usage.line}` : "Unknown"}
            {node?.component ? <span className="block text-muted">in {node.component}</span> : null}
          </p>
        </Row>
        {rect && (
          <Row label="Element">
            <p className="text-[12px] text-muted">
              &lt;{rect.tag}&gt; · {rect.type}
            </p>
          </Row>
        )}
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2.5 border-b border-line px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={actions.onBackToElements} aria-label="Back to Elements" title="Back to Elements" data-testid="edit-back" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-ground hover:text-text">
            <IconGrid size={18} />
          </button>
          <h2 className="min-w-0 flex-1 truncate font-display text-[16px] font-semibold text-text" data-testid="edit-title">
            Edit {label}
          </h2>
          {rect && (
            <span className="rounded-sm bg-ground px-2 py-1 font-mono text-[11px] text-muted" title={id}>
              {rect.tag}
            </span>
          )}
        </div>
        <Crumbs chain={chain} label={label} onSelect={actions.onSelect} />
        <div role="tablist" aria-label="Inspector tabs" className="flex gap-0.5 rounded-control bg-ground p-0.5">
          {tabs.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} title={item.label} data-testid={`inspector-tab-${item.key}`} onClick={() => setTab(item.key)} className={clsx("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-sm text-[12px] font-semibold", tab === item.key ? "bg-panel text-text shadow-segment" : "text-muted hover:text-text")}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="dense-controls flex flex-col pb-4" data-testid="engine-inspector" data-tab={tab} data-resolving={resolving ? "1" : undefined}>
        {body}
        <div className="px-5 pt-4">
          <LinkButton to={`/sites/${siteId}/requests/new`} variant="secondary" size="sm" className="w-full" data-testid="engine-request-change">
            Request a change
          </LinkButton>
        </div>
      </div>
    </>
  );
}
