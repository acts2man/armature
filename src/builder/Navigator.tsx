/**
 * The Navigator: the page's whole element tree. Click to select and scroll into view,
 * drag to reorder or re-nest, double-click to rename, eye to hide per device, lock
 * (agency), expand/collapse, and a dot on every element that differs from what is
 * published. Stage 1 fields are listed under the site section that shows them.
 */
import { clsx } from "clsx";
import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconChevronRight, IconEye, IconEyeOff, IconLock, IconSection, IconUnlock } from "@/components/icons.tsx";
import { SrOnly } from "@/components/ui.tsx";
import type { Device, Element, LayoutDoc } from "@shared/builder/index.ts";
import type { PageDefinition } from "@shared/schema.ts";
import { fieldRoot, type FieldPath, type MappedField } from "@shared/visualProtocol.ts";
import * as icons from "@/components/icons.tsx";
import { widgetDefinition, widgetLabel } from "./widgets/registry.ts";

export type NavigatorDrop = { parentId: string | null; index: number };

export type NavigatorProps = {
  layout: LayoutDoc | undefined;
  page: PageDefinition | undefined;
  sharedPage: PageDefinition | undefined;
  /** Stage 1 fields on the page, with the element that owns each. */
  fields: MappedField[];
  changedIds: Set<string>;
  changedFields: Set<FieldPath>;
  selectedId: string | null;
  selectedPath: FieldPath | null;
  device: Device;
  isStaff: boolean;
  onSelect: (id: string) => void;
  onSelectField: (path: FieldPath) => void;
  onRename: (id: string, label: string) => void;
  onToggleHidden: (id: string) => void;
  onToggleLock: (id: string) => void;
  onMove: (id: string, drop: NavigatorDrop) => void;
  /** "Headline" for "home.hero.title"; falls back to the path. */
  fieldLabel?: (path: FieldPath) => string;
};

function iconFor(element: Element) {
  if (element.type === "site-section") return <IconSection size={15} />;
  const name = widgetDefinition(element.type)?.icon ?? "Widget";
  const Component = (icons as unknown as Record<string, React.ComponentType<{ size?: number }> | undefined>)[`Icon${name}`] ?? icons.IconWidget;
  return <Component size={15} />;
}

const elementTitle = (element: Element): string => element.label || (element.type === "heading" && typeof element.props["text"] === "string" ? (element.props["text"] as string).slice(0, 40) : element.type === "button" && typeof element.props["text"] === "string" ? (element.props["text"] as string).slice(0, 40) : widgetLabel(element.type));

export function Navigator(props: NavigatorProps) {
  const { layout, fields, changedIds, changedFields, selectedId, selectedPath, device, isStaff, onSelect, onSelectField, onRename, onToggleHidden, onToggleLock, onMove } = props;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; where: "before" | "after" | "inside" } | null>(null);
  const draggingRef = useRef<string | null>(null);
  const rows = useRef<HTMLDivElement>(null);

  // Keep the selected row in view.
  useEffect(() => {
    if (!selectedId) return;
    rows.current?.querySelector<HTMLElement>(`[data-nav-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  if (!layout) return <p className="px-3 py-4 text-[13px] text-muted">This page has no elements yet. Add a section from the Elements tab.</p>;

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isAncestor = (maybeAncestor: string, id: string): boolean => {
    const walk = (elements: Element[]): boolean =>
      elements.some((element) => {
        if (element.id === maybeAncestor) return contains(element, id);
        return element.children ? walk(element.children) : false;
      });
    const contains = (element: Element, target: string): boolean => (element.children ?? []).some((child) => child.id === target || contains(child, target));
    return walk(layout.root);
  };

  /** One row per content field a site section shows (a list's items collapse into the list). */
  const fieldsFor = (element: Element): MappedField[] => {
    if (element.type !== "site-section") return [];
    const seen = new Map<string, MappedField>();
    for (const field of fields) {
      if (field.owner !== element.id) continue;
      const root = fieldRoot(field.path);
      if (!seen.has(root)) seen.set(root, { ...field, path: root });
    }
    return Array.from(seen.values());
  };

  const renderRow = (element: Element, depth: number, parentId: string | null, index: number) => {
    const isContainer = element.type === "container" || element.type === "grid";
    const children = element.children ?? [];
    const sectionFields = fieldsFor(element);
    const expandable = (isContainer && children.length > 0) || sectionFields.length > 0;
    const open = !collapsed.has(element.id);
    const hidden = element.advanced.hidden?.[device] === true;
    const selected = selectedId === element.id;
    const overHere = over?.id === element.id ? over.where : null;
    return (
      <div key={element.id} role="treeitem" aria-selected={selected} aria-expanded={expandable ? open : undefined} aria-level={depth + 1}>
        <div
          data-nav-id={element.id}
          data-testid={`nav-${element.id}`}
          draggable={!element.locked || isStaff}
          onDragStart={(event) => {
            draggingRef.current = element.id;
            setDragging(element.id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", element.id);
          }}
          onDragOver={(event) => {
            const source = draggingRef.current;
            if (!source || source === element.id || isAncestor(source, element.id)) return;
            event.preventDefault();
            const box = event.currentTarget.getBoundingClientRect();
            const ratio = (event.clientY - box.top) / box.height;
            const where: "before" | "after" | "inside" = isContainer && ratio > 0.3 && ratio < 0.7 ? "inside" : ratio < 0.5 ? "before" : "after";
            setOver((current) => (current?.id === element.id && current.where === where ? current : { id: element.id, where }));
          }}
          onDragLeave={() => setOver((current) => (current?.id === element.id ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            const source = draggingRef.current;
            const where = over?.id === element.id ? over.where : "after";
            setOver(null);
            setDragging(null);
            draggingRef.current = null;
            if (!source || source === element.id) return;
            if (where === "inside") onMove(source, { parentId: element.id, index: children.length });
            else onMove(source, { parentId, index: where === "before" ? index : index + 1 });
          }}
          onDragEnd={() => {
            setOver(null);
            setDragging(null);
            draggingRef.current = null;
          }}
          onClick={() => onSelect(element.id)}
          onDoubleClick={() => element.type !== "site-section" && setRenaming(element.id)}
          className={clsx(
            "group relative flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-sm pr-1 text-left text-[13px]",
            selected ? "bg-blue-soft font-semibold text-blue" : "text-text hover:bg-ground",
            dragging === element.id && "opacity-50",
            overHere === "inside" && "outline outline-2 outline-accent",
            hidden && "opacity-60",
          )}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          {overHere === "before" && <span className="pointer-events-none absolute inset-x-1 top-0 h-0.5 bg-accent" />}
          {overHere === "after" && <span className="pointer-events-none absolute inset-x-1 bottom-0 h-0.5 bg-accent" />}
          <button
            type="button"
            tabIndex={-1}
            aria-label={expandable ? (open ? "Collapse" : "Expand") : undefined}
            onClick={(event) => {
              event.stopPropagation();
              if (expandable) toggle(element.id);
            }}
            className={clsx("inline-flex h-5 w-4 shrink-0 items-center justify-center text-muted", !expandable && "invisible")}
          >
            {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
          </button>
          <span className={clsx("shrink-0", selected ? "text-blue" : "text-muted")}>{iconFor(element)}</span>
          {renaming === element.id ? (
            <input
              autoFocus
              defaultValue={element.label ?? ""}
              placeholder={widgetLabel(element.type)}
              aria-label="Element name"
              onClick={(event) => event.stopPropagation()}
              onBlur={(event) => {
                onRename(element.id, event.target.value.trim());
                setRenaming(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                if (event.key === "Escape") setRenaming(null);
              }}
              className="h-6 min-w-0 flex-1 rounded-sm border border-accent bg-panel px-1.5 text-[12px] font-medium text-text"
            />
          ) : (
            <span className="min-w-0 flex-1 truncate">{elementTitle(element)}</span>
          )}
          {changedIds.has(element.id) && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unpublished change" />}
          {element.locked && !isStaff && <IconLock size={13} className="shrink-0 text-muted" aria-label="Locked by the agency" />}
          <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
            <button
              type="button"
              aria-label={hidden ? `Show on ${device}` : `Hide on ${device}`}
              title={hidden ? `Show on ${device}` : `Hide on ${device}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleHidden(element.id);
              }}
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted hover:bg-panel hover:text-text"
            >
              {hidden ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </button>
            {isStaff && (
              <button
                type="button"
                aria-label={element.locked ? "Unlock for clients" : "Lock for clients"}
                title={element.locked ? "Unlock for clients" : "Lock for clients"}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleLock(element.id);
                }}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted hover:bg-panel hover:text-text"
              >
                {element.locked ? <IconLock size={14} /> : <IconUnlock size={14} />}
              </button>
            )}
          </span>
          {hidden && <SrOnly>hidden on {device}</SrOnly>}
        </div>
        {open && expandable && (
          <div role="group">
            {children.map((child, childIndex) => renderRow(child, depth + 1, element.id, childIndex))}
            {sectionFields.map((field) => (
              <button
                key={field.path}
                type="button"
                data-testid={`layer-${field.path}`}
                onClick={() => onSelectField(field.path)}
                className={clsx("flex h-8 w-full items-center gap-1.5 rounded-sm pr-2 text-left text-[13px]", selectedPath && fieldRoot(selectedPath) === field.path ? "bg-blue-soft font-semibold text-blue" : "text-text hover:bg-ground")}
                style={{ paddingLeft: 6 + (depth + 1) * 14 + 18 }}
              >
                <span className={clsx("shrink-0", selectedPath && fieldRoot(selectedPath) === field.path ? "text-blue" : "text-muted")}>{field.kind === "image" ? <icons.IconImage size={14} /> : field.kind === "link" ? <icons.IconLink size={14} /> : <icons.IconHeading size={14} />}</span>
                <span className="min-w-0 flex-1 truncate">{props.fieldLabel?.(field.path) ?? field.path}</span>
                {changedFields.has(field.path) && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="Unpublished change" />}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={rows} role="tree" aria-label="Page structure" className="flex flex-col gap-px px-2 pb-3" data-testid="navigator">
      {layout.root.map((element, index) => renderRow(element, 0, null, index))}
      {props.page && props.sharedPage && (
        <p className="mt-2 px-2 text-[12px] leading-relaxed text-muted">
          Header and footer fields ({props.sharedPage.label}) are listed where they appear; use the Pages tab for fields on other pages.
        </p>
      )}
    </div>
  );
}
