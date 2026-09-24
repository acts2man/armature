/**
 * The 320px inspector on the right: the selected field by type. Text and paragraphs
 * (edit here or on the canvas, with a character count), images (current picture,
 * Replace, drop zone), links (label and destination, validated like the contract),
 * video/url (validated), and lists (cards to add, duplicate, delete, drag to reorder
 * and edit item fields; the canvas follows live).
 */
import { clsx } from "clsx";
import { useEffect, useId, useRef, useState, type DragEvent, type ReactNode } from "react";
import { IconArrowDown, IconArrowUp, IconCopy, IconGrip, IconImage, IconPlus, IconPointer, IconTrash, IconUndo, IconUpload } from "@/components/icons.tsx";
import { Button, Field, Input, SrOnly, Textarea } from "@/components/ui.tsx";
import type { ContentTree, LinkValue, ListValue } from "@shared/contentFile.ts";
import { LIMITS, isAllowedImagePath, isAllowedLinkTarget } from "@shared/contentValidation.ts";
import type { ItemField, PageField, SiteSchema } from "@shared/schema.ts";
import { fieldPath, fieldRoot, parseFieldPath, type FieldPath } from "@shared/visualProtocol.ts";
import { blankItem, currentValue, fieldMeta, type Draft, type ImageDraft } from "./draftStore.ts";
import { chromeNote, chromePartOf, liveHref, type BuiltParts } from "./pages.ts";

const NO_BUILT_PARTS: BuiltParts = { header: false, footer: false };

export type InspectorActions = {
  onText: (path: FieldPath, text: string) => void;
  onHref: (root: FieldPath, href: string) => void;
  onValue: (root: FieldPath, value: string) => void;
  onImageFile: (path: FieldPath, file: File) => void;
  onClearImage: (path: FieldPath) => void;
  onRevert: (root: FieldPath) => void;
  onEditInline: (path: FieldPath) => void;
  onListAdd: (root: FieldPath, item: Record<string, string>) => void;
  onListDuplicate: (root: FieldPath, index: number) => void;
  onListRemove: (root: FieldPath, index: number) => void;
  onListMove: (root: FieldPath, from: number, to: number) => void;
  onShowOnPage: (path: FieldPath) => void;
};

const urlError = (value: string): string | null => {
  if (value.length > LIMITS.url) return `Too long (${value.length} characters, limit ${LIMITS.url}).`;
  if (!isAllowedLinkTarget(value)) return "Must start with https://, http://, mailto:, tel: or / (a page on this site).";
  return null;
};

const imagePathError = (value: string): string | null => {
  if (value.length > LIMITS.url) return `Too long (limit ${LIMITS.url}).`;
  if (!isAllowedImagePath(value)) return "Must be a path under /assets/ (or pick a picture with Replace).";
  return null;
};

function Count({ value, limit }: { value: string; limit: number }) {
  const over = value.length > limit;
  return (
    <span className={clsx("text-[12px] tabular-nums", over ? "font-semibold text-red" : "text-muted")}>
      {value.length}/{limit}
      {over && <SrOnly> characters, over the limit</SrOnly>}
    </span>
  );
}

function TextControl({ id, label, value, multiline, limit, onChange, hint }: { id: string; label: ReactNode; value: string; multiline: boolean; limit: number; onChange: (next: string) => void; hint?: string }) {
  const error = value.length > limit ? `Too long: ${value.length} characters, limit ${limit}.` : null;
  return (
    <Field htmlFor={id} label={<span className="flex items-center justify-between gap-2">{label}<Count value={value} limit={limit} /></span>} hint={hint} error={error}>
      {multiline ? <Textarea id={id} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-32" /> : <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />}
    </Field>
  );
}

function ImageControl({
  path,
  value,
  pending,
  liveUrl,
  onFile,
  onClear,
  onPath,
  requestOpen,
}: {
  path: FieldPath;
  value: string;
  pending: ImageDraft | undefined;
  liveUrl: string | null;
  onFile: (file: File) => void;
  onClear: () => void;
  onPath: (next: string) => void;
  requestOpen: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [broken, setBroken] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    if (requestOpen > 0) input.current?.click();
  }, [requestOpen]);
  const preview = pending ? pending.dataUrl : value.startsWith("data:") ? value : liveHref(liveUrl, value);
  const accept = (event: DragEvent) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault();
      setOver(true);
    }
  };
  const error = pending ? null : imagePathError(value);
  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={accept}
        onDragEnter={accept}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer.files[0];
          if (file) onFile(file);
        }}
        className={clsx("relative flex h-44 items-center justify-center overflow-hidden rounded-[10px] border bg-ground", over ? "border-accent outline outline-2 outline-dashed outline-accent" : "border-line")}
        data-testid="image-preview"
      >
        {preview && broken !== preview ? (
          <img src={preview} alt="" className="h-full w-full object-contain" onError={() => setBroken(preview)} />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[12px] text-muted">
            <IconImage size={22} />
            {value ? "No preview" : "No picture yet"}
          </span>
        )}
        {over && <span className="absolute inset-0 flex items-center justify-center bg-accent/10 text-[13px] font-semibold text-accent">Drop to replace</span>}
      </div>
      {pending ? (
        <p className="text-[13px] font-medium text-accent">
          New picture ready to publish: {pending.name} ({Math.round(pending.bytes / 1024)} KB, {pending.width}×{pending.height})
        </p>
      ) : (
        <p className="text-[12px] leading-relaxed text-muted">PNG, JPEG or WebP. It is resized in your browser (WebP, at most 2000px and 3 MB) before it is published. You can also drop a file onto the picture on the page.</p>
      )}
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        data-testid={`image-input-${path}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => input.current?.click()}>
          <IconUpload size={16} /> Replace
        </Button>
        {pending && (
          <Button size="sm" variant="secondary" onClick={onClear}>
            Keep current picture
          </Button>
        )}
      </div>
      {!pending && (
        <Field htmlFor={`${id}-path`} label="Path" error={error} hint="Advanced: point at a picture already in the site's /assets/ folder.">
          <Input id={`${id}-path`} value={value} onChange={(event) => onPath(event.target.value)} className="font-mono text-[13px]" placeholder="/assets/example.webp" />
        </Field>
      )}
    </div>
  );
}

function ListControl({
  root,
  field,
  list,
  images,
  liveUrl,
  actions,
  activeIndex,
}: {
  root: FieldPath;
  field: PageField;
  list: ListValue;
  images: Draft["images"];
  liveUrl: string | null;
  actions: InspectorActions;
  activeIndex: number | undefined;
}) {
  const itemFields: ItemField[] = field.itemFields ?? [];
  // The index being dragged lives in a ref: drag events fire faster than React re-renders.
  const dragging = useRef<number | null>(null);
  const [dragFrom, setDragFromState] = useState<number | null>(null);
  const setDragFrom = (index: number | null) => {
    dragging.current = index;
    setDragFromState(index);
  };
  const [dragOver, setDragOver] = useState<number | null>(null);
  const parsedRoot = parseFieldPath(root);
  const firstText = itemFields.find((item) => item.type === "text" || item.type === "textarea");

  return (
    <div className="flex flex-col gap-3" data-testid="list-editor">
      <p className="text-[12px] text-muted">
        {list.length} {list.length === 1 ? "item" : "items"}. Drag the handle to reorder.
      </p>
      <ol className="flex flex-col gap-2.5">
        {list.map((item, index) => {
          const key = `${root}[${index}]`;
          const active = activeIndex === index;
          return (
            <li
              key={key}
              draggable
              onDragStart={(event) => {
                setDragFrom(index);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(index));
              }}
              onDragOver={(event) => {
                if (dragging.current === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDragOver((current) => (current === index ? current : index));
              }}
              onDragLeave={() => setDragOver((current) => (current === index ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragging.current;
                if (from !== null && from !== index) actions.onListMove(root, from, index);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              data-testid={`list-item-${index}`}
              className={clsx(
                "rounded-[10px] border bg-ground p-3 transition-[box-shadow,border-color] duration-150",
                active ? "border-accent" : "border-line",
                dragOver === index && dragFrom !== index && "border-accent shadow-pop",
                dragFrom === index && "opacity-50",
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
                  <span className="cursor-grab text-muted active:cursor-grabbing" aria-hidden="true" data-testid={`drag-handle-${index}`}>
                    <IconGrip size={16} />
                  </span>
                  Item {index + 1}
                </span>
                <div className="flex gap-0.5 rounded-control border border-line bg-panel p-0.5">
                  {firstText && parsedRoot && (
                    <button type="button" title="Show on the page" aria-label={`Show item ${index + 1} on the page`} onClick={() => actions.onShowOnPage(fieldPath(parsedRoot.slug, parsedRoot.section, parsedRoot.field, index, firstText.key))} className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text">
                      <IconPointer size={15} />
                    </button>
                  )}
                  <button type="button" title="Move up" aria-label={`Move item ${index + 1} up`} disabled={index === 0} onClick={() => actions.onListMove(root, index, index - 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text disabled:opacity-40">
                    <IconArrowUp size={15} />
                  </button>
                  <button type="button" title="Move down" aria-label={`Move item ${index + 1} down`} disabled={index === list.length - 1} onClick={() => actions.onListMove(root, index, index + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text disabled:opacity-40">
                    <IconArrowDown size={15} />
                  </button>
                  <button type="button" title="Duplicate" aria-label={`Duplicate item ${index + 1}`} onClick={() => actions.onListDuplicate(root, index)} className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-ground hover:text-text">
                    <IconCopy size={15} />
                  </button>
                  <button type="button" title="Delete" aria-label={`Delete item ${index + 1}`} onClick={() => actions.onListRemove(root, index)} className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted hover:bg-red-soft hover:text-red">
                    <IconTrash size={15} />
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2.5">
                {itemFields.map((itemField) => {
                  const path = parsedRoot ? fieldPath(parsedRoot.slug, parsedRoot.section, parsedRoot.field, index, itemField.key) : `${key}.${itemField.key}`;
                  const value = item[itemField.key] ?? "";
                  const id = `${key}-${itemField.key}`;
                  if (itemField.type === "image") {
                    return (
                      <div key={itemField.key} className="space-y-1.5">
                        <span className="block text-[13px] font-semibold text-text">{itemField.label}</span>
                        <ImageControl
                          path={path}
                          value={value}
                          pending={images[path]}
                          liveUrl={liveUrl}
                          onFile={(file) => actions.onImageFile(path, file)}
                          onClear={() => actions.onClearImage(path)}
                          onPath={(next) => actions.onText(path, next)}
                          requestOpen={0}
                        />
                      </div>
                    );
                  }
                  if (itemField.type === "url") {
                    return (
                      <Field key={itemField.key} htmlFor={id} label={itemField.label} error={urlError(value)}>
                        <Input id={id} inputMode="url" value={value} onChange={(event) => actions.onText(path, event.target.value)} />
                      </Field>
                    );
                  }
                  return (
                    <TextControl
                      key={itemField.key}
                      id={id}
                      label={itemField.label}
                      value={value}
                      multiline={itemField.type === "textarea"}
                      limit={itemField.type === "textarea" ? LIMITS.textarea : LIMITS.text}
                      onChange={(next) => actions.onText(path, next)}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>
      <div>
        <Button variant="secondary" size="sm" disabled={list.length >= LIMITS.listItems} onClick={() => actions.onListAdd(root, blankItem(itemFields))}>
          <IconPlus size={16} /> Add item
        </Button>
        {list.length >= LIMITS.listItems && <p className="mt-1 text-[12px] text-muted">A list can hold at most {LIMITS.listItems} items.</p>}
      </div>
    </div>
  );
}

export function Inspector({
  schema,
  baseline,
  draft,
  selectedPath,
  selectedOnCanvas,
  liveUrl,
  actions,
  replaceRequest,
  elementPanel,
  builder = false,
  isStaff = false,
  builtParts = NO_BUILT_PARTS,
}: {
  schema: SiteSchema;
  baseline: ContentTree;
  draft: Draft;
  selectedPath: FieldPath | null;
  selectedOnCanvas: boolean;
  liveUrl: string | null;
  actions: InspectorActions;
  /** Bumped when the toolbar's Replace image is pressed, to open the file picker. */
  replaceRequest: number;
  /** Agency staff read the developer wording of the header/footer note. */
  isStaff?: boolean;
  /** Site contract v2: the selected builder element's panel, shown instead of a field. */
  elementPanel?: ReactNode;
  /** The page builder is on: the left panel is the Navigator, not Layers. */
  builder?: boolean;
  /** Which of the header and footer are built in the editor (v2 sites). */
  builtParts?: BuiltParts;
}) {
  const meta = selectedPath ? fieldMeta(schema, selectedPath) : null;
  const root = selectedPath ? fieldRoot(selectedPath) : null;

  let body: ReactNode;
  if (elementPanel) {
    body = elementPanel;
  } else if (!meta || !root || !selectedPath) {
    body = (
      <div className="flex flex-col gap-3 px-5 py-6 text-[13px] leading-relaxed text-muted">
        <p className="font-semibold text-text">Nothing selected</p>
        <p>{builder ? "Click anything on the page to select it. Click text twice to type straight on the page." : "Click any text, picture or button on the page to edit it. Click it again to type straight on the page."}</p>
        <p>{builder ? "Or pick an element in the Navigator on the left." : "Or pick a field under Layers on the left."}</p>
      </div>
    );
  } else {
    body = <FieldEditor schema={schema} baseline={baseline} draft={draft} selectedPath={selectedPath} selectedOnCanvas={selectedOnCanvas} liveUrl={liveUrl} actions={actions} replaceRequest={replaceRequest} isStaff={isStaff} builtParts={builtParts} />;
  }

  return (
    <aside aria-label="Inspector" className="flex w-80 shrink-0 flex-col border-l border-line bg-panel" data-testid="inspector">
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </aside>
  );
}

/** The editor for one Stage-1 content field (text, image, link, url, video, list), used
 *  in the right inspector (content-only sites) and in the builder's left panel when a
 *  field inside a coded site section is selected. */
export function FieldEditor({
  schema,
  baseline,
  draft,
  selectedPath,
  selectedOnCanvas,
  liveUrl,
  actions,
  replaceRequest,
  isStaff = false,
  builtParts = NO_BUILT_PARTS,
}: {
  schema: SiteSchema;
  baseline: ContentTree;
  draft: Draft;
  selectedPath: FieldPath;
  selectedOnCanvas: boolean;
  liveUrl: string | null;
  actions: InspectorActions;
  replaceRequest: number;
  /** Agency staff read the developer wording of the header/footer note. */
  isStaff?: boolean;
  /** Which of the header and footer are built in the editor, so the note tells the truth. */
  builtParts?: BuiltParts;
}) {
  const meta = fieldMeta(schema, selectedPath);
  const chrome = chromePartOf(schema, selectedPath);
  const root = fieldRoot(selectedPath);
  const changed = root in draft.fields || Object.keys(draft.images).some((path) => fieldRoot(path) === root);
  const value = currentValue(draft, baseline, root);
  if (!meta) return null;
  {
    const { field, section, page } = meta;
    const control = (() => {
      switch (field.type) {
        case "text":
        case "textarea": {
          const text = typeof value === "string" ? value : "";
          return (
            <TextControl
              id="inspector-text"
              label={field.label}
              value={text}
              multiline={field.type === "textarea"}
              limit={field.type === "textarea" ? LIMITS.textarea : LIMITS.text}
              onChange={(next) => actions.onText(root, next)}
              hint={selectedOnCanvas ? "Or click the text on the page and type there." : undefined}
            />
          );
        }
        case "url":
        case "video": {
          const text = typeof value === "string" ? value : "";
          return (
            <Field htmlFor="inspector-url" label={field.label} error={urlError(text)} hint={field.type === "video" ? "Paste the embed URL from YouTube, Vimeo or Wistia. Empty for no video." : "https://, mailto:, tel:, or a page on this site (/contact/)."}>
              <Input id="inspector-url" inputMode="url" value={text} onChange={(event) => actions.onValue(root, event.target.value)} />
            </Field>
          );
        }
        case "link": {
          const link = value && typeof value === "object" && !Array.isArray(value) ? (value as LinkValue) : { label: "", href: "" };
          return (
            <div className="flex flex-col gap-3">
              <TextControl id="inspector-link-label" label="Label" value={link.label} multiline={false} limit={LIMITS.text} onChange={(next) => actions.onText(root, next)} />
              <Field htmlFor="inspector-link-href" label="Destination" error={urlError(link.href)} hint="https://, mailto:, tel:, or a page on this site (/contact/).">
                <Input id="inspector-link-href" inputMode="url" value={link.href} onChange={(event) => actions.onHref(root, event.target.value)} />
              </Field>
              <p className="text-[12px] leading-relaxed text-muted">Opening in a new tab is not something this site's content lets you choose; links open the way the site decides.</p>
            </div>
          );
        }
        case "image": {
          const text = typeof value === "string" ? value : "";
          return <ImageControl path={root} value={text} pending={draft.images[root]} liveUrl={liveUrl} onFile={(file) => actions.onImageFile(root, file)} onClear={() => actions.onClearImage(root)} onPath={(next) => actions.onValue(root, next)} requestOpen={replaceRequest} />;
        }
        case "list": {
          const list = Array.isArray(value) ? (value as ListValue) : [];
          return <ListControl root={root} field={field} list={list} images={draft.images} liveUrl={liveUrl} actions={actions} activeIndex={meta.index} />;
        }
      }
    })();

    return (
      <>
        {chrome && (
          <div className="mx-5 mt-3 rounded-control border border-line bg-ground/60 p-3 text-[12px] leading-relaxed text-muted" data-testid="chrome-note" role="note" data-part={chrome} data-built={(chrome === "header" && builtParts.header) || (chrome === "footer" && builtParts.footer) ? "yes" : "no"}>
            {chromeNote(chrome, builtParts, isStaff)}
            <span className="mt-1.5 block text-text">The words, links and pictures below still edit as usual.</span>
          </div>
        )}
        <div className="flex flex-col gap-2.5 border-b border-line px-5 pb-3 pt-4">
          <div className="text-[12px] font-medium text-muted">
            {page.label} · {section.label}
          </div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-[18px] font-semibold text-text">{field.label}</h2>
            <span className="rounded-sm bg-ground px-2 py-1 font-mono text-[11px] text-muted" title={selectedPath}>
              {root}
            </span>
          </div>
          <div role="group" aria-label="Inspector tabs" className="flex gap-0.5 rounded-control bg-ground p-0.5">
            <span aria-current="true" className="h-8 flex-1 rounded-sm bg-panel text-center text-[12px] font-semibold leading-8 text-text shadow-segment">
              Content
            </span>
            <span className="h-8 flex-1 rounded-sm text-center text-[12px] font-semibold leading-8 text-muted/60" title="Colours and fonts come in a later stage">
              Style
            </span>
            <span className="h-8 flex-1 rounded-sm text-center text-[12px] font-semibold leading-8 text-muted/60" title="Comes in a later stage">
              Advanced
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {changed ? <span className="inline-flex h-6 items-center rounded-full bg-blue-soft px-2.5 text-[12px] font-semibold text-blue">Changed</span> : <span className="inline-flex h-6 items-center rounded-full bg-grey-soft px-2.5 text-[12px] font-semibold text-muted">Published</span>}
            {!selectedOnCanvas && <span className="text-[12px] text-muted">Not shown on this page</span>}
            <button type="button" disabled={!changed} onClick={() => actions.onRevert(root)} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-[12px] font-semibold text-text hover:bg-ground disabled:cursor-not-allowed disabled:opacity-40">
              <IconUndo size={14} /> Revert to published
            </button>
          </div>
        </div>
        <div className="flex flex-col gap-3 px-5 py-4">
          {field.help && <p className="text-[12px] leading-relaxed text-muted">{field.help}</p>}
          {control}
        </div>
      </>
    );
  }
}
