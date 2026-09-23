/**
 * The Text Editor widget's Content tab: a full rich-text editor in the panel. Visual
 * edits in a contenteditable with a toolbar (paragraph or heading, bold, italic,
 * underline, strike, lists, link, alignment, colour, clear); Code shows the same
 * document as sanitized HTML and converts what is typed back (unsupported tags are
 * dropped with a notice). Every keystroke writes the document, so the canvas follows
 * live, and edits made on the page flow back into the panel.
 */
import { clsx } from "clsx";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconAlignCenter, IconAlignJustify, IconAlignLeft, IconAlignRight, IconBold, IconDroplet, IconEraser, IconItalic, IconLink, IconListBullet, IconListOrdered, IconStrike, IconUnderline } from "@/components/icons.tsx";
import type { RichDoc, SiteKit } from "@shared/builder/index.ts";
import { isAllowedHref } from "@shared/builder/schema.ts";
import { serializeRichText } from "@kit/richTextDom.ts";
import { resolveKitColor } from "@kit/values.ts";
import { controlInputClass } from "./controls/inputs.tsx";
import { docToHtml, htmlToDoc } from "./richHtml.ts";

const BLOCKS = [
  { value: "p", label: "Paragraph" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" },
  { value: "h5", label: "Heading 5" },
  { value: "h6", label: "Heading 6" },
  { value: "blockquote", label: "Quote" },
];

type State = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; bulletList: boolean; orderedList: boolean; block: string; align: string; link: string | null };
const EMPTY: State = { bold: false, italic: false, underline: false, strike: false, bulletList: false, orderedList: false, block: "p", align: "left", link: null };

/** Keeps the editor's selection: a press on a toolbar button never moves focus. */
const keep = (event: React.MouseEvent | React.PointerEvent) => event.preventDefault();

function Tool({ label, active, onClick, children, testId }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} data-testid={testId} onMouseDown={keep} onPointerDown={keep} onClick={onClick} className={clsx("inline-flex h-7 min-w-7 items-center justify-center rounded-sm px-1", active ? "bg-accent text-accent-fg" : "text-muted hover:bg-ground hover:text-text")}>
      {children}
    </button>
  );
}

const docJson = (doc: RichDoc | undefined) => JSON.stringify(doc ?? { type: "doc", content: [] });

export function RichTextEditor({ doc, kit, onChange, onEditOnPage }: { doc: RichDoc | undefined; kit: SiteKit; onChange: (doc: RichDoc) => void; onEditOnPage?: () => void }) {
  const [tab, setTab] = useState<"visual" | "code">("visual");
  const host = useRef<HTMLDivElement>(null);
  /** The document this editor last wrote, so its own writes never reset the caret. */
  const emitted = useRef<string>("");
  const [state, setState] = useState<State>(EMPTY);
  const [panel, setPanel] = useState<"link" | "color" | null>(null);
  const [href, setHref] = useState("");
  const [hex, setHex] = useState("#");
  /** What is being typed in the Code tab; null shows the document's own HTML. */
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const [dropped, setDropped] = useState(0);
  const code = codeDraft ?? docToHtml(doc, kit);

  const emit = useCallback(
    (next: RichDoc) => {
      emitted.current = docJson(next);
      onChange(next);
    },
    [onChange],
  );

  // Edits made elsewhere (on the page, undo, the Code tab) replace the editor's content; its
  // own writes do not, so the caret stays. A freshly shown Visual tab always renders the document.
  const shownTab = useRef<"visual" | "code" | null>(null);
  useLayoutEffect(() => {
    const json = docJson(doc);
    const fresh = tab === "visual" && shownTab.current !== "visual";
    shownTab.current = tab;
    if (json === emitted.current && !fresh) return;
    emitted.current = json;
    if (host.current) host.current.innerHTML = docToHtml(doc, kit);
  }, [doc, kit, tab]);

  const readState = useCallback(() => {
    const element = host.current;
    const selection = window.getSelection();
    if (!element || !selection || !selection.anchorNode || !element.contains(selection.anchorNode)) return;
    let block = "p";
    let link: string | null = null;
    let node: Node | null = selection.anchorNode;
    while (node && node !== element) {
      if (node instanceof HTMLAnchorElement && link === null) link = node.getAttribute("href");
      if (node.nodeType === Node.ELEMENT_NODE && /^(P|H[1-6]|BLOCKQUOTE)$/.test((node as Element).tagName) && block === "p") block = (node as Element).tagName.toLowerCase();
      node = node.parentNode;
    }
    setState({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      strike: document.queryCommandState("strikeThrough"),
      bulletList: document.queryCommandState("insertUnorderedList"),
      orderedList: document.queryCommandState("insertOrderedList"),
      block,
      align: document.queryCommandState("justifyCenter") ? "center" : document.queryCommandState("justifyRight") ? "right" : document.queryCommandState("justifyFull") ? "justify" : "left",
      link,
    });
  }, []);

  useEffect(() => {
    if (tab !== "visual") return;
    document.addEventListener("selectionchange", readState);
    return () => document.removeEventListener("selectionchange", readState);
  }, [tab, readState]);

  const onInput = () => {
    if (host.current) emit(serializeRichText(host.current));
    readState();
  };

  const command = (name: string, value?: string) => {
    const element = host.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    switch (name) {
      case "bold":
      case "italic":
      case "underline":
        document.execCommand(name);
        break;
      case "strike":
        document.execCommand("strikeThrough");
        break;
      case "bulletList":
        document.execCommand("insertUnorderedList");
        break;
      case "orderedList":
        document.execCommand("insertOrderedList");
        break;
      case "block":
        document.execCommand("formatBlock", false, `<${(value ?? "p").replace(/[^a-z0-9]/gi, "")}>`);
        break;
      case "align":
        document.execCommand(value === "center" ? "justifyCenter" : value === "right" ? "justifyRight" : value === "justify" ? "justifyFull" : "justifyLeft");
        break;
      case "link":
        if (value) document.execCommand("createLink", false, value);
        else document.execCommand("unlink");
        break;
      case "color":
        if (value) document.execCommand("foreColor", false, value);
        break;
      case "clear":
        document.execCommand("removeFormat");
        document.execCommand("unlink");
        break;
      default:
        return;
    }
    onInput();
  };

  const hrefError = href && !isAllowedHref(href) ? "Use https://, mailto:, tel:, a page (/contact/) or #anchor." : null;
  const swatches = [
    { ref: "kit:color.primary", label: "Primary" },
    { ref: "kit:color.secondary", label: "Secondary" },
    { ref: "kit:color.text", label: "Text" },
    { ref: "kit:color.accent", label: "Accent" },
    ...kit.colors.custom.map((color) => ({ ref: `kit:color.custom.${color.id}`, label: color.label })),
  ];

  return (
    <div className="flex flex-col gap-2" data-testid="text-editor">
      <div role="tablist" aria-label="Editor mode" className="flex gap-0.5 rounded-control bg-ground p-0.5">
        {(["visual", "code"] as const).map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tab === item} data-testid={`text-editor-tab-${item}`} onClick={() => setTab(item)} className={clsx("h-7 flex-1 rounded-sm text-[12px] font-semibold capitalize", tab === item ? "bg-panel text-text shadow-segment" : "text-muted hover:text-text")}>
            {item}
          </button>
        ))}
      </div>

      {tab === "visual" ? (
        <div className="flex flex-col gap-1.5">
          <div role="toolbar" aria-label="Text formatting" className="flex flex-wrap items-center gap-0.5 rounded-sm border border-line bg-ground/60 p-1">
            <select aria-label="Text style" value={BLOCKS.some((block) => block.value === state.block) ? state.block : "p"} onMouseDown={(event) => event.stopPropagation()} onChange={(event) => command("block", event.target.value)} className="h-7 rounded-sm border border-line bg-panel px-1 text-[12px] font-semibold text-text" data-testid="te-block">
              {BLOCKS.map((block) => (
                <option key={block.value} value={block.value}>
                  {block.label}
                </option>
              ))}
            </select>
            <Tool label="Bold" active={state.bold} onClick={() => command("bold")} testId="te-bold"><IconBold size={14} /></Tool>
            <Tool label="Italic" active={state.italic} onClick={() => command("italic")} testId="te-italic"><IconItalic size={14} /></Tool>
            <Tool label="Underline" active={state.underline} onClick={() => command("underline")} testId="te-underline"><IconUnderline size={14} /></Tool>
            <Tool label="Strikethrough" active={state.strike} onClick={() => command("strike")} testId="te-strike"><IconStrike size={14} /></Tool>
            <Tool label="Bulleted list" active={state.bulletList} onClick={() => command("bulletList")} testId="te-bullets"><IconListBullet size={14} /></Tool>
            <Tool label="Numbered list" active={state.orderedList} onClick={() => command("orderedList")} testId="te-numbers"><IconListOrdered size={14} /></Tool>
            <Tool label={state.link ? `Link: ${state.link}` : "Add a link"} active={!!state.link || panel === "link"} onClick={() => { setHref(state.link ?? ""); setPanel((open) => (open === "link" ? null : "link")); }} testId="te-link"><IconLink size={14} /></Tool>
            {(
              [
                ["left", "Align left", IconAlignLeft],
                ["center", "Centre", IconAlignCenter],
                ["right", "Align right", IconAlignRight],
                ["justify", "Justify", IconAlignJustify],
              ] as const
            ).map(([value, label, Icon]) => (
              <Tool key={value} label={label} active={state.align === value} onClick={() => command("align", value)} testId={`te-align-${value}`}><Icon size={14} /></Tool>
            ))}
            <Tool label="Text colour" active={panel === "color"} onClick={() => setPanel((open) => (open === "color" ? null : "color"))} testId="te-color"><IconDroplet size={14} /></Tool>
            <Tool label="Clear formatting" onClick={() => command("clear")} testId="te-clear"><IconEraser size={14} /></Tool>
          </div>

          {panel === "link" && (
            <form
              className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel p-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (hrefError) return;
                command("link", href.trim());
                setPanel(null);
              }}
            >
              <div className="flex items-center gap-1.5">
                <input autoFocus type="text" inputMode="url" aria-label="Link address" value={href} placeholder="https://… or /contact/" onChange={(event) => setHref(event.target.value)} className={clsx(controlInputClass, "flex-1", hrefError && "border-red")} aria-invalid={!!hrefError} data-testid="te-link-input" />
                <button type="submit" disabled={!!hrefError} onMouseDown={keep} className="h-8 shrink-0 rounded-sm bg-accent px-2.5 text-[12px] font-semibold text-accent-fg disabled:opacity-40">
                  {href.trim() ? "Apply" : "Remove"}
                </button>
              </div>
              <p className={clsx("text-[11px]", hrefError ? "text-red" : "text-muted")}>{hrefError ?? "Select the words first. Leave empty and apply to remove the link."}</p>
            </form>
          )}

          {panel === "color" && (
            <div className="flex flex-col gap-2 rounded-sm border border-line bg-panel p-2">
              <div className="flex flex-wrap gap-1.5">
                {swatches.map((swatch) => {
                  const color = resolveKitColor(kit, swatch.ref) ?? "#000000";
                  return <button key={swatch.ref} type="button" title={`${swatch.label} (site colour)`} aria-label={`Colour the text ${swatch.label}`} onMouseDown={keep} onClick={() => { command("color", color); setPanel(null); }} className="h-6 w-6 rounded-full border border-line" style={{ background: color }} />;
                })}
              </div>
              <form
                className="flex items-center gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
                  command("color", hex);
                  setPanel(null);
                }}
              >
                <input type="text" aria-label="Hex colour" value={hex} onChange={(event) => setHex(event.target.value)} className={clsx(controlInputClass, "flex-1 font-mono text-[12px]")} />
                <button type="submit" onMouseDown={keep} className="h-8 shrink-0 rounded-sm border border-line px-2 text-[12px] font-semibold hover:bg-ground">
                  Apply
                </button>
              </form>
            </div>
          )}

          <div
            ref={host}
            role="textbox"
            aria-multiline="true"
            aria-label="Text"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            data-testid="text-editor-visual"
            onInput={onInput}
            onFocus={readState}
            onKeyUp={readState}
            onMouseUp={readState}
            className={clsx(
              controlInputClass,
              "h-auto min-h-40 cursor-text overflow-y-auto py-2 text-[13px] leading-relaxed [&_a]:text-accent [&_a]:underline [&_blockquote]:my-1 [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-2 [&_h1]:my-1 [&_h1]:text-[20px] [&_h1]:font-bold [&_h2]:my-1 [&_h2]:text-[18px] [&_h2]:font-bold [&_h3]:my-1 [&_h3]:text-[16px] [&_h3]:font-bold [&_h4]:my-1 [&_h4]:text-[14px] [&_h4]:font-bold [&_h5]:my-1 [&_h5]:font-bold [&_h6]:my-1 [&_h6]:font-bold [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5",
            )}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <textarea
            aria-label="HTML"
            value={code}
            spellCheck={false}
            data-testid="text-editor-code"
            onChange={(event) => {
              setCodeDraft(event.target.value);
              const result = htmlToDoc(event.target.value);
              setDropped(result.dropped);
              emit(result.doc);
            }}
            onBlur={() => {
              // Show the HTML as it was kept, so what was dropped is visibly gone.
              setCodeDraft(null);
              if (dropped) setDropped(0);
            }}
            className={clsx(controlInputClass, "min-h-40 py-1.5 font-mono text-[12px] leading-relaxed")}
          />
          {dropped > 0 && (
            <p className="rounded-sm border border-amber/40 bg-amber-soft px-2 py-1.5 text-[11px] leading-relaxed text-text" role="status" data-testid="text-editor-notice">
              {dropped === 1 ? "1 tag is not supported and was removed" : `${dropped} tags are not supported and were removed`} (its text stays). Supported: paragraphs, headings, bold, italic, underline, strikethrough, links, lists, quotes and colours.
            </p>
          )}
        </div>
      )}
      {onEditOnPage && (
        <button type="button" onClick={onEditOnPage} className="h-8 rounded-sm border border-line text-[12px] font-semibold text-text hover:bg-ground">
          Edit on the page
        </button>
      )}
    </div>
  );
}
