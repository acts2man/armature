/**
 * The inspector for a builder element: breadcrumbs of the parent chain (click to select
 * a parent), the element's name, and its Content / Style / Advanced tabs, all rendered
 * from control specs (src/builder/controls/specs.ts). The Style tab has Normal and
 * Hover states. Every change is one named undo step; typing and scrubbing merge.
 */
import { clsx } from "clsx";
import { useMemo, useState, type ReactNode } from "react";
import { IconChevronRight, IconGauge, IconGrid, IconLayout, IconLock, IconPencil, IconSettings } from "@/components/icons.tsx";
import { Button } from "@/components/ui.tsx";
import type { Device, SiteKit } from "@shared/builder/index.ts";
import { ControlRenderer, type ControlTarget } from "./controls/ControlRenderer.tsx";
import { advancedSpecs, contentSpecsFor, isFlexParent, styleSpecs } from "./controls/specs.ts";
import { readAt } from "./controls/path.ts";
import { findElement, type BuilderState } from "./store.ts";
import { widgetLabel } from "./widgets/registry.ts";

export type InspectorTab = "content" | "style" | "advanced";

export type ElementInspectorActions = {
  onSelect: (id: string) => void;
  onSetPath: (id: string, path: string[], value: unknown, label: string, group?: string) => void;
  onEditOnPage: (id: string) => void;
  onRename: (id: string, label: string) => void;
  /** The grid icon in the header: leave Edit mode and go back to Elements. */
  onBackToElements: () => void;
  /** Opens the media library; the chosen picture comes back through onPick. */
  onPickImage?: (onPick: (src: string, alt: string) => void) => void;
};

function Crumbs({ state, slug, id, onSelect }: { state: BuilderState; slug: string; id: string; onSelect: (id: string) => void }) {
  const entry = findElement(state, id, slug);
  if (!entry) return null;
  const chain = [...entry.ancestors, id];
  return (
    <nav aria-label="Parents" className="flex flex-wrap items-center gap-0.5 text-[12px] text-muted" data-testid="breadcrumbs">
      {chain.map((crumb, index) => {
        const element = findElement(state, crumb, slug)?.element;
        const last = index === chain.length - 1;
        return (
          <span key={crumb} className="flex items-center gap-0.5">
            {index > 0 && <IconChevronRight size={12} />}
            {last ? (
              <span className="font-semibold text-text">{element?.label || widgetLabel(element?.type ?? "")}</span>
            ) : (
              <button type="button" onClick={() => onSelect(crumb)} className="rounded-sm px-1 hover:bg-ground hover:text-text">
                {element?.label || widgetLabel(element?.type ?? "")}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

export function ElementInspector({
  state,
  slug,
  id,
  locked,
  actions,
  agencyName,
  siteUrl = null,
  requestChange,
  device,
  onDevice,
  kit,
  isStaff,
}: {
  state: BuilderState;
  slug: string;
  id: string;
  /** Locked for the current user (agency staff are never locked out). */
  locked: boolean;
  actions: ElementInspectorActions;
  agencyName: string;
  /** The live site's address, for picture previews. */
  siteUrl?: string | null;
  requestChange: () => void;
  device: Device;
  onDevice: (device: Device) => void;
  kit: SiteKit;
  isStaff: boolean;
}) {
  const [tab, setTab] = useState<InspectorTab>("content");
  const [styleState, setStyleState] = useState<"normal" | "hover">("normal");
  const entry = findElement(state, id, slug);
  const element = entry?.element;
  const parentId = entry?.ancestors[entry.ancestors.length - 1];
  const parent = parentId ? findElement(state, parentId, slug)?.element : undefined;
  const flexParent = isFlexParent(parent);

  const target = useMemo<ControlTarget | null>(() => {
    if (!element) return null;
    return {
      read: (path) => readAt(element, path),
      write: (path, value, label, group) => actions.onSetPath(element.id, [...path], value, label, group ? `${group}:${element.id}` : undefined),
      device,
      onDevice,
      kit,
      isStaff,
      actions: { editOnPage: element.type === "text" || element.type === "heading" ? () => actions.onEditOnPage(element.id) : undefined, pickImage: actions.onPickImage },
      siteUrl,
    };
  }, [element, actions, device, onDevice, kit, isStaff, siteUrl]);

  if (!element || !target) return null;
  const content = contentSpecsFor(element.type);
  const restyleBlocked = locked;

  let body;
  if (tab === "content") {
    const siteSectionNote =
      element.type === "site-section" ? (
        <div className="mx-5 mt-3 rounded-control border border-line bg-ground/60 p-3 text-[12px] leading-relaxed text-muted" data-testid="site-section-note">
          {isStaff ? "This section is coded in the site's repository. To make its layout fully editable here, convert it to builder elements in the site's repo." : "This section is looked after by your agency. To change its layout, ask your agency to make this section fully editable."}
          <span className="mt-1.5 block text-text">Its text and pictures are still editable — click them on the page.</span>
        </div>
      ) : null;
    body = content ? (
      <>
        {siteSectionNote}
        <ControlRenderer inset target={target} specs={content} />
      </>
    ) : (
      <>
        {siteSectionNote}
        {element.type !== "site-section" && <p className="px-5 py-4 text-[13px] leading-relaxed text-muted">This element type is not supported by this editor version.</p>}
      </>
    );
  } else if (restyleBlocked) {
    body = (
      <p className="flex items-start gap-1.5 px-5 py-4 text-[13px] leading-relaxed text-muted">
        <IconLock size={14} className="mt-0.5 shrink-0" /> {agencyName} locked this element's design. Ask them if it needs to change.
      </p>
    );
  } else if (tab === "style") {
    body = (
      <>
        <div className="px-5 pt-3">
          <div role="tablist" aria-label="State" className="flex gap-0.5 rounded-control bg-ground p-0.5">
            {(["normal", "hover"] as const).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={styleState === item} data-testid={`style-state-${item}`} onClick={() => setStyleState(item)} className={clsx("h-7 flex-1 rounded-sm text-[12px] font-semibold capitalize", styleState === item ? "bg-panel text-text shadow-segment" : "text-muted hover:text-text")}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <ControlRenderer inset key={styleState} target={target} specs={styleSpecs(element.type, styleState)} />
      </>
    );
  } else {
    body = <ControlRenderer inset target={target} specs={advancedSpecs(flexParent)} />;
  }

  const isContainer = element.type === "container" || element.type === "grid";
  const tabs: { key: InspectorTab; label: string; icon: ReactNode }[] = [
    { key: "content", label: isContainer ? "Layout" : "Content", icon: isContainer ? <IconLayout size={16} /> : <IconPencil size={16} /> },
    { key: "style", label: "Style", icon: <IconGauge size={16} /> },
    { key: "advanced", label: "Advanced", icon: <IconSettings size={16} /> },
  ];

  return (
    <>
      <div className="flex flex-col gap-2.5 border-b border-line px-4 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={actions.onBackToElements} aria-label="Back to Elements" title="Back to Elements" data-testid="edit-back" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-ground hover:text-text">
            <IconGrid size={18} />
          </button>
          <h2 className="min-w-0 flex-1 truncate font-display text-[16px] font-semibold text-text" data-testid="edit-title">
            Edit {widgetLabel(element.type)}
          </h2>
          <span className="rounded-sm bg-ground px-2 py-1 font-mono text-[11px] text-muted" title={element.id}>
            {element.type}
          </span>
        </div>
        <Crumbs state={state} slug={slug} id={id} onSelect={actions.onSelect} />
        <input
          aria-label="Element name"
          value={element.label ?? ""}
          placeholder={widgetLabel(element.type)}
          onChange={(event) => actions.onRename(element.id, event.target.value)}
          className="h-8 w-full rounded-sm border border-transparent bg-ground px-2 text-[13px] font-medium text-text hover:border-line focus:border-accent focus:bg-panel"
        />
        {locked && (
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <IconLock size={13} /> Locked by {agencyName}: it cannot be moved, deleted or restyled.
          </p>
        )}
        <div role="tablist" aria-label="Inspector tabs" className="flex gap-0.5 rounded-control bg-ground p-0.5">
          {tabs.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} title={item.label} data-testid={`inspector-tab-${item.key}`} onClick={() => setTab(item.key)} className={clsx("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-sm text-[12px] font-semibold", tab === item.key ? "bg-panel text-text shadow-segment" : "text-muted hover:text-text")}>
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="dense-controls flex flex-col pb-4" data-testid="element-inspector" data-tab={tab}>
        {body}
        <div className="px-5 pt-4">
          <Button variant="secondary" size="sm" onClick={requestChange} className="w-full" aria-label="Request a change to this element">
            Request a change here
          </Button>
        </div>
      </div>
    </>
  );
}
