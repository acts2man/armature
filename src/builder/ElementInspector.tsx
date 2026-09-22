/**
 * The inspector for a builder element: breadcrumbs of the parent chain (click to select
 * a parent), the element's name, and its Content / Style / Advanced tabs. Milestone 2
 * ships the frame and the content controls of the core widgets; milestone 3 replaces
 * the body with the schema-driven control library.
 */
import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { IconChevronRight, IconLock } from "@/components/icons.tsx";
import { Button, Field, Input, Select, Textarea } from "@/components/ui.tsx";
import type { Element, Size } from "@shared/builder/index.ts";
import { richTextToPlain, plainDoc } from "@kit/richText.tsx";
import { parseSize, sizeToCss } from "@kit/values.ts";
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

function ContentControls({ element, actions }: { element: Element; actions: ElementInspectorActions }) {
  const set = (path: string[], value: unknown, label: string, group?: string) => actions.onSetPath(element.id, path, value, label, group);
  const props = element.props as Record<string, unknown>;
  switch (element.type) {
    case "heading":
      return (
        <>
          <Field htmlFor="el-text" label="Text">
            <Textarea id="el-text" value={String(props["text"] ?? "")} onChange={(event) => set(["props", "text"], event.target.value, "Changed heading text", `typing:${element.id}`)} className="min-h-20" />
          </Field>
          <Field htmlFor="el-tag" label="HTML tag">
            <Select id="el-tag" value={String(props["tag"] ?? "h2")} onChange={(event) => set(["props", "tag"], event.target.value, "Changed heading tag")}>
              {["h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span"].map((tag) => (
                <option key={tag} value={tag}>
                  {tag.toUpperCase()}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="el-link" label="Link (optional)" hint="https://, mailto:, tel:, or a page on this site (/contact/).">
            <Input id="el-link" inputMode="url" value={String((props["link"] as { href?: string } | undefined)?.href ?? "")} onChange={(event) => set(["props", "link"], event.target.value ? { href: event.target.value } : undefined, "Changed heading link", `typing:${element.id}:link`)} />
          </Field>
        </>
      );
    case "text":
      return (
        <>
          <p className="text-[13px] leading-relaxed text-muted">Double-click the text on the page to edit it with formatting. The box below edits it as plain text (formatting is removed).</p>
          <Field htmlFor="el-plain" label="Plain text">
            <Textarea id="el-plain" value={richTextToPlain(props["doc"] as never)} onChange={(event) => set(["props", "doc"], plainDoc(event.target.value), "Changed text", `typing:${element.id}`)} className="min-h-32" />
          </Field>
          <Button size="sm" variant="secondary" onClick={() => actions.onEditOnPage(element.id)}>
            Edit on the page
          </Button>
        </>
      );
    case "button":
      return (
        <>
          <Field htmlFor="el-btn-text" label="Text">
            <Input id="el-btn-text" value={String(props["text"] ?? "")} onChange={(event) => set(["props", "text"], event.target.value, "Changed button text", `typing:${element.id}`)} />
          </Field>
          <Field htmlFor="el-btn-link" label="Link" hint="https://, mailto:, tel:, or a page on this site (/contact/).">
            <Input id="el-btn-link" inputMode="url" value={String((props["link"] as { href?: string } | undefined)?.href ?? "")} onChange={(event) => set(["props", "link", "href"], event.target.value, "Changed button link", `typing:${element.id}:link`)} />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-text">
            <input type="checkbox" checked={!!(props["link"] as { newTab?: boolean } | undefined)?.newTab} onChange={(event) => set(["props", "link", "newTab"], event.target.checked || undefined, "Changed button target")} /> Open in a new tab
          </label>
          <Field htmlFor="el-btn-size" label="Size">
            <Select id="el-btn-size" value={String(props["size"] ?? "md")} onChange={(event) => set(["props", "size"], event.target.value, "Changed button size")}>
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
              <option value="xl">Extra large</option>
            </Select>
          </Field>
        </>
      );
    case "image":
      return (
        <>
          <Field htmlFor="el-src" label="Picture path" hint="A picture under /assets/ or an https:// address. The media library (milestone 6) will pick these.">
            <Input id="el-src" value={String(props["src"] ?? "")} onChange={(event) => set(["props", "src"], event.target.value, "Changed picture", `typing:${element.id}`)} className="font-mono text-[13px]" />
          </Field>
          <Field htmlFor="el-alt" label="Alt text">
            <Input id="el-alt" value={String(props["alt"] ?? "")} onChange={(event) => set(["props", "alt"], event.target.value, "Changed alt text", `typing:${element.id}:alt`)} />
          </Field>
          <Field htmlFor="el-caption" label="Caption">
            <Input id="el-caption" value={String(props["caption"] ?? "")} onChange={(event) => set(["props", "caption"], event.target.value || undefined, "Changed caption", `typing:${element.id}:caption`)} />
          </Field>
        </>
      );
    case "spacer": {
      const current = readDesktop(props["height"]) as Size | undefined;
      return (
        <Field htmlFor="el-height" label="Height" hint="A number with a unit, for example 40px or 4rem.">
          <Input id="el-height" defaultValue={sizeToCss(current) ?? "50px"} onBlur={(event) => {
            const size = parseSize(event.target.value);
            if (size) set(["props", "height"], size, "Changed spacer height");
          }} />
        </Field>
      );
    }
    case "divider":
      return (
        <Field htmlFor="el-divider-text" label="Text in the middle (optional)">
          <Input id="el-divider-text" value={String(props["text"] ?? "")} onChange={(event) => set(["props", "text"], event.target.value || undefined, "Changed divider text", `typing:${element.id}`)} />
        </Field>
      );
    case "container":
    case "grid":
      return (
        <>
          <Field htmlFor="el-layout" label="Width">
            <Select id="el-layout" value={String(props["layout"] ?? "boxed")} onChange={(event) => set(["props", "layout"], event.target.value, "Changed container width")}>
              <option value="boxed">Boxed (content width)</option>
              <option value="full">Full width</option>
            </Select>
          </Field>
          <Field htmlFor="el-tag" label="HTML tag">
            <Select id="el-tag" value={String(props["tag"] ?? "div")} onChange={(event) => set(["props", "tag"], event.target.value, "Changed container tag")}>
              {["div", "section", "header", "footer", "article", "aside", "nav"].map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </Select>
          </Field>
          {element.type === "container" && (
            <Field htmlFor="el-direction" label="Direction (desktop)">
              <Select id="el-direction" value={String(readDesktop(props["direction"]) ?? "column")} onChange={(event) => set(["props", "direction", "desktop"], event.target.value, "Changed direction")}>
                <option value="column">Column (stacked)</option>
                <option value="row">Row (side by side)</option>
                <option value="column-reverse">Column, reversed</option>
                <option value="row-reverse">Row, reversed</option>
              </Select>
            </Field>
          )}
        </>
      );
    case "site-section":
      return <p className="text-[13px] leading-relaxed text-muted">A section coded into the site. Its words and pictures are edited by clicking them on the page; move it, hide it per device or delete it from here.</p>;
    default:
      return <p className="text-[13px] leading-relaxed text-muted">This element type is not supported by this editor version.</p>;
  }
}

const readDesktop = (value: unknown): unknown => (value && typeof value === "object" && "desktop" in (value as object) ? (value as { desktop: unknown }).desktop : value);

export function ElementInspector({ state, slug, id, locked, actions, agencyName, requestChange }: { state: BuilderState; slug: string; id: string; locked: boolean; actions: ElementInspectorActions; agencyName: string; requestChange: () => void }) {
  const [tab, setTab] = useState<InspectorTab>("content");
  const entry = findElement(state, id, slug);
  if (!entry) return null;
  const element = entry.element;
  let body: ReactNode;
  if (tab === "content") body = <ContentControls element={element} actions={actions} />;
  else body = <p className="text-[13px] leading-relaxed text-muted">{tab === "style" ? "Typography, colours, backgrounds, borders and shadows" : "Spacing, size, position, motion and visibility"} come in the next milestone of the builder.</p>;

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
      <div className="flex flex-col gap-3 px-5 py-4" data-testid="element-inspector">
        {body}
        <Button variant="secondary" size="sm" onClick={requestChange}>
          Request a change to this element
        </Button>
      </div>
    </>
  );
}
