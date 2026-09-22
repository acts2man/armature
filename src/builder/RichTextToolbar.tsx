/**
 * The floating toolbar over a Text Editor being edited on the page: bold, italic,
 * underline, strike, paragraph or heading, lists, alignment, a link (validated), a colour
 * from the site's palette or any hex, and clear formatting. It lives above the frame;
 * the kit applies each command inside the page and reports the new state back. Buttons
 * never take focus from the page, and the kit keeps the text selection while they're used.
 */
import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import { IconAlignCenter, IconAlignJustify, IconAlignLeft, IconAlignRight, IconBold, IconCheck, IconDroplet, IconEraser, IconItalic, IconLink, IconListBullet, IconListOrdered, IconStrike, IconUnderline } from "@/components/icons.tsx";
import type { SiteKit } from "@shared/builder/index.ts";
import { isAllowedHref } from "@shared/builder/schema.ts";
import type { Rect, RichTextCommand, RichTextState } from "@shared/visualProtocol.ts";
import { resolveKitColor } from "@kit/values.ts";

const EMPTY: RichTextState = { bold: false, italic: false, underline: false, strike: false, bulletList: false, orderedList: false, block: "p", link: null, align: "left" };

const BLOCKS = [
  { value: "p", label: "Paragraph" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
  { value: "h4", label: "Heading 4" },
  { value: "blockquote", label: "Quote" },
];

/** Keeps the page's selection: a press in the toolbar never moves focus. */
const keep = (event: React.MouseEvent | React.PointerEvent) => event.preventDefault();

function Tool({ label, active, onClick, children, testId }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={active} data-testid={testId} onMouseDown={keep} onPointerDown={keep} onClick={onClick} className={clsx("inline-flex h-8 min-w-8 items-center justify-center rounded-sm px-1.5", active ? "bg-accent text-accent-fg" : "hover:bg-ink-2")}>
      {children}
    </button>
  );
}

const TOOLBAR_WIDTH = 580;

const Divider = () => <span className="mx-0.5 h-5 w-px bg-ink-line" aria-hidden="true" />;

export function RichTextToolbar({ rect, scale, viewportWidth, state, kit, onCommand, onDone }: { rect: Rect; scale: number; viewportWidth: number; state: RichTextState | null; kit: SiteKit; onCommand: (command: RichTextCommand, value?: string) => void; onDone: () => void }) {
  const current = state ?? EMPTY;
  const [panel, setPanel] = useState<"link" | "color" | null>(null);
  const [href, setHref] = useState("");
  const [hex, setHex] = useState("#");
  const top = rect.y * scale - 52;
  const below = top < 4;
  // The toolbar is about 580px wide: keep it inside the canvas, aligned with the text when it fits.
  const left = Math.max(4, Math.min(rect.x * scale, viewportWidth * scale - TOOLBAR_WIDTH - 4));
  const hrefError = href && !isAllowedHref(href) ? "Use https://, mailto:, tel:, a page (/contact/) or #anchor." : null;
  const swatches = [
    { ref: "kit:color.primary", label: "Primary" },
    { ref: "kit:color.secondary", label: "Secondary" },
    { ref: "kit:color.text", label: "Text" },
    { ref: "kit:color.accent", label: "Accent" },
    ...kit.colors.custom.map((color) => ({ ref: `kit:color.custom.${color.id}`, label: color.label })),
  ];

  return (
    <div className="dense-controls pointer-events-auto absolute z-10 flex flex-col gap-1" style={{ left, top: below ? (rect.y + rect.height) * scale + 10 : top }} data-testid="richtext-toolbar">
      <div role="toolbar" aria-label="Text formatting" className="toast-in flex h-10 items-center gap-0.5 rounded-[8px] bg-ink px-1 text-white shadow-dark">
        <select
          aria-label="Text style"
          value={BLOCKS.some((block) => block.value === current.block) ? current.block : "p"}
          onChange={(event) => onCommand("block", event.target.value)}
          className="h-8 min-h-0 rounded-sm border-0 bg-ink-2 px-1.5 text-[12px] font-semibold text-white"
          data-testid="rt-block"
        >
          {BLOCKS.map((block) => (
            <option key={block.value} value={block.value}>
              {block.label}
            </option>
          ))}
        </select>
        <Divider />
        <Tool label="Bold (Ctrl/Cmd+B)" active={current.bold} onClick={() => onCommand("bold")} testId="rt-bold">
          <IconBold size={15} />
        </Tool>
        <Tool label="Italic (Ctrl/Cmd+I)" active={current.italic} onClick={() => onCommand("italic")} testId="rt-italic">
          <IconItalic size={15} />
        </Tool>
        <Tool label="Underline (Ctrl/Cmd+U)" active={current.underline} onClick={() => onCommand("underline")} testId="rt-underline">
          <IconUnderline size={15} />
        </Tool>
        <Tool label="Strikethrough" active={current.strike} onClick={() => onCommand("strike")} testId="rt-strike">
          <IconStrike size={15} />
        </Tool>
        <Divider />
        <Tool label="Bulleted list" active={current.bulletList} onClick={() => onCommand("bulletList")} testId="rt-bullets">
          <IconListBullet size={15} />
        </Tool>
        <Tool label="Numbered list" active={current.orderedList} onClick={() => onCommand("orderedList")} testId="rt-numbers">
          <IconListOrdered size={15} />
        </Tool>
        <Divider />
        {(
          [
            ["left", "Align left", IconAlignLeft],
            ["center", "Centre", IconAlignCenter],
            ["right", "Align right", IconAlignRight],
            ["justify", "Justify", IconAlignJustify],
          ] as const
        ).map(([value, label, Icon]) => (
          <Tool key={value} label={label} active={current.align === value} onClick={() => onCommand("align", value)} testId={`rt-align-${value}`}>
            <Icon size={15} />
          </Tool>
        ))}
        <Divider />
        <Tool
          label={current.link ? `Link: ${current.link}` : "Add a link"}
          active={!!current.link || panel === "link"}
          onClick={() => {
            setHref(current.link ?? "");
            setPanel((open) => (open === "link" ? null : "link"));
          }}
          testId="rt-link"
        >
          <IconLink size={15} />
        </Tool>
        <Tool label="Text colour" active={panel === "color"} onClick={() => setPanel((open) => (open === "color" ? null : "color"))} testId="rt-color">
          <IconDroplet size={15} />
        </Tool>
        <Tool label="Clear formatting" onClick={() => onCommand("clear")} testId="rt-clear">
          <IconEraser size={15} />
        </Tool>
        <Divider />
        <Tool label="Done (Esc cancels)" onClick={onDone} testId="rt-done">
          <IconCheck size={15} />
        </Tool>
      </div>

      {panel === "link" && (
        <form
          className="toast-in flex w-80 flex-col gap-1.5 rounded-[10px] border border-line bg-panel p-2 text-text shadow-pop"
          onSubmit={(event) => {
            event.preventDefault();
            if (hrefError) return;
            onCommand("link", href.trim());
            setPanel(null);
          }}
        >
          <div className="flex items-center gap-1.5">
            <input autoFocus type="text" inputMode="url" aria-label="Link address" value={href} placeholder="https://… or /contact/" onChange={(event) => setHref(event.target.value)} className={clsx("h-8 min-w-0 flex-1 rounded-sm border border-line px-2 text-[13px]", hrefError && "border-red")} aria-invalid={!!hrefError} data-testid="rt-link-input" />
            <button type="submit" disabled={!!hrefError} className="h-8 rounded-sm bg-accent px-3 text-[12px] font-semibold text-accent-fg disabled:opacity-40">
              {href.trim() ? "Apply" : "Remove"}
            </button>
          </div>
          <p className={clsx("text-[11px]", hrefError ? "text-red" : "text-muted")}>{hrefError ?? "Select the words first. Leave empty and apply to remove the link."}</p>
        </form>
      )}

      {panel === "color" && (
        <div className="toast-in flex w-64 flex-col gap-2 rounded-[10px] border border-line bg-panel p-2 text-text shadow-pop">
          <div className="flex flex-wrap gap-1.5">
            {swatches.map((swatch) => {
              const color = resolveKitColor(kit, swatch.ref) ?? "#000000";
              return <button key={swatch.ref} type="button" title={`${swatch.label} (site colour)`} aria-label={`Colour the text ${swatch.label}`} onMouseDown={keep} onClick={() => { onCommand("color", color); setPanel(null); }} className="h-6 w-6 rounded-full border border-line" style={{ background: color }} />;
            })}
          </div>
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
              onCommand("color", hex);
              setPanel(null);
            }}
          >
            <input type="text" aria-label="Hex colour" value={hex} onChange={(event) => setHex(event.target.value)} className="h-8 min-w-0 flex-1 rounded-sm border border-line px-2 font-mono text-[12px]" />
            <button type="submit" className="h-8 rounded-sm border border-line px-2 text-[12px] font-semibold hover:bg-ground">
              Apply
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
