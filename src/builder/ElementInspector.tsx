/**
 * The inspector for a builder element: breadcrumbs of the parent chain (click to select
 * a parent), the element's name, and its Content / Style / Advanced tabs, all rendered
 * from control specs (src/builder/controls/specs.ts). The Style tab has Normal and
 * Hover states. Every change is one named undo step; typing and scrubbing merge.
 */
import { clsx } from "clsx";
import { useMemo, useState } from "react";
import { IconChevronRight, IconLock } from "@/components/icons.tsx";
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
      actions: { editOnPage: element.type === "text" || element.type === "heading" ? () => actions.onEditOnPage(element.id) : undefined },
    };
  }, [element, actions, device, onDevice, kit, isStaff]);

  if (!element || !target) return null;
  const content = contentSpecsFor(element.type);
  const restyleBlocked = locked;

  let body;
  if (tab === "content") {
    body = content ? <ControlRenderer inset target={target} specs={content} /> : <p className="px-5 py-4 text-[13px] leading-relaxed text-muted">This element type is not supported by this editor version.</p>;
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

  return (
    <>
      <div className="flex flex-col gap-2.5 border-b border-line px-5 pb-3 pt-4">
        <Crumbs state={state} slug={slug} id={id} onSelect={actions.onSelect} />
        <div className="flex items-center justify-between gap-2">
          <input
            aria-label="Element name"
            value={element.label ?? ""}
            placeholder={widgetLabel(element.type)}
            onChange={(event) => actions.onRename(element.id, event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1 font-display text-[18px] font-semibold text-text hover:border-line focus:border-accent"
          />
          <span className="rounded-sm bg-ground px-2 py-1 font-mono text-[11px] text-muted" title={element.id}>
            {element.type}
          </span>
        </div>
        {locked && (
          <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
            <IconLock size={13} /> Locked by {agencyName}: it cannot be moved, deleted or restyled.
          </p>
        )}
        <div role="tablist" aria-label="Inspector tabs" className="flex gap-0.5 rounded-control bg-ground p-0.5">
          {(["content", "style", "advanced"] as InspectorTab[]).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} data-testid={`inspector-tab-${item}`} onClick={() => setTab(item)} className={clsx("h-8 flex-1 rounded-sm text-[12px] font-semibold capitalize", tab === item ? "bg-panel text-text shadow-segment" : "text-muted hover:text-text")}>
              {item}
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
