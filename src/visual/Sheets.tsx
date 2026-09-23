/**
 * Small companions of the workspace: the keyboard shortcuts sheet, the three-step
 * first-run tour, the "Request a change" bar, the draft-restore prompt and the
 * small-screen notice.
 */
import { clsx } from "clsx";
import { useEffect, useState, type ReactNode } from "react";
import { IconBranch, IconKeyboard, IconSend, IconX } from "@/components/icons.tsx";
import { Button, LinkButton, Modal } from "@/components/ui.tsx";
import { markTourSeen, modKey } from "./pages.ts";

// --- shortcuts ------------------------------------------------------------------------

export function ShortcutsSheet({ open, onClose, builder }: { open: boolean; onClose: () => void; builder?: boolean }) {
  const mod = modKey();
  const builderRows: [string, string][] = builder
    ? [
        ["Drag from Elements", "Add a widget where the blue line shows"],
        ["Right-click", "The element menu"],
        [`${mod}+C / ${mod}+V`, "Copy and paste an element (works across pages and sites)"],
        [`${mod}+Shift+V`, "Paste only the style"],
        [`${mod}+D`, "Duplicate the element"],
        ["Delete", "Delete the element"],
        ["↑ ↓", "Select the previous or next element"],
        ["← →", "Select the parent, or the first child"],
        ["Alt+Click", "Select the parent"],
        [`${mod}+P`, "Preview"],
      ]
    : [];
  const rows: [string, string][] = [
    ...builderRows,
    ["Click", "Select text, a picture or a button"],
    ["Click again, or Enter", "Type straight on the page"],
    ["Enter", "Finish typing (Shift+Enter for a new line in a paragraph)"],
    ["Esc", "Stop typing without changes, or deselect"],
    ["Tab", "Select the next field on the page"],
    [`${mod}+Z`, "Undo"],
    [`Shift+${mod}+Z`, "Redo"],
    [`${mod}+S`, "Publish"],
    [`${mod}+Click a link`, "Follow the link"],
    ["?", "This sheet"],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2.5 text-[14px]">
        {rows.map(([keys, what]) => (
          <div key={keys} className="contents">
            <dt className="whitespace-nowrap">
              <kbd className="inline-flex h-7 items-center rounded-sm border border-line bg-ground px-2 font-sans text-[12px] font-semibold text-text">{keys}</kbd>
            </dt>
            <dd className="text-text">{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

// --- first-run tour --------------------------------------------------------------------

type Step = { title: string; body: string; anchor: "canvas" | "layers" | "inspector" | "publish" };

const STEPS: Step[] = [
  { title: "Click anything to edit it", body: "Click a headline, a paragraph, a picture or a button on the page. Click text twice to type right there.", anchor: "canvas" },
  { title: "Every field lives in Layers", body: "The panel on the left lists everything you can change on this page. A dot means it has unpublished changes.", anchor: "layers" },
  { title: "Publish when you're ready", body: "Nothing goes live until you press Publish. Your draft is saved in this browser, across every page.", anchor: "publish" },
];

/** The page builder's five steps (the style level skips the first: it cannot add elements). */
const BUILDER_STEPS: Step[] = [
  { title: "Drag in what you need", body: "The Elements panel holds every widget and saved template. Drag one onto the page, or click it to add it after what is selected.", anchor: "layers" },
  { title: "Click to select, twice to type", body: "Click anything on the page to select it; click text twice to type right there. A right-click shows everything you can do with it.", anchor: "canvas" },
  { title: "Fine-tune in the panel", body: "Selecting anything opens its Content, Style and Advanced settings in the left panel. The grid icon takes you back to Elements. Switch to tablet or phone at the top for per-screen values.", anchor: "layers" },
  { title: "Drag the handles", body: "A selected element shows handles for its spacing and size. Hold Alt to change both sides at once, Shift for all four.", anchor: "canvas" },
  { title: "Publish when you're ready", body: "Nothing goes live until you press Publish. Your draft is saved to your account as you work, so it waits for you on any device.", anchor: "publish" },
];

export type TourKind = "content" | "builder" | "style";
const stepsFor = (kind: TourKind): Step[] => (kind === "builder" ? BUILDER_STEPS : kind === "style" ? BUILDER_STEPS.slice(1) : STEPS);

export function Tour({ active, kind = "content", onDone }: { active: boolean; kind?: TourKind; onDone: () => void }) {
  const [step, setStep] = useState(0);
  const STEPS = stepsFor(kind);
  const seenKey = kind === "content" ? "content" : "builder";
  const finish = () => {
    markTourSeen(seenKey);
    onDone();
  };
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        markTourSeen(seenKey);
        onDone();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onDone, seenKey]);
  if (!active) return null;
  const current = STEPS[step] ?? STEPS[0]!;
  const position =
    current.anchor === "canvas"
      ? "left-1/2 top-24 -translate-x-1/2"
      : current.anchor === "layers"
        ? "left-[336px] top-24"
        : current.anchor === "inspector"
          ? "right-[340px] top-24"
          : "right-[132px] top-[68px]";
  return (
    <div className={clsx("toast-in absolute z-30 w-72 rounded-card border border-line bg-panel p-4 shadow-pop", position)} role="dialog" aria-label={`Tip ${step + 1} of ${STEPS.length}`} data-testid="tour">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[14px] font-semibold text-text">{current.title}</p>
        <button type="button" aria-label="Dismiss the tour" onClick={finish} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-ground hover:text-text">
          <IconX size={16} />
        </button>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-muted">{current.body}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="flex gap-1.5" aria-hidden="true">
          {STEPS.map((_, index) => (
            <span key={index} className={clsx("h-1.5 w-1.5 rounded-full", index === step ? "bg-accent" : "bg-line")} />
          ))}
        </span>
        <Button size="sm" onClick={() => (step < STEPS.length - 1 ? setStep(step + 1) : finish())}>
          {step < STEPS.length - 1 ? "Next" : "Got it"}
        </Button>
      </div>
    </div>
  );
}

// --- request bar -----------------------------------------------------------------------------

export function RequestBar({ agencyName, onSubmit }: { agencyName: string; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(text.trim());
        setText("");
      }}
      className="absolute inset-x-[120px] bottom-[18px] z-20 flex h-14 items-center gap-3 rounded-full border border-line bg-panel pl-[18px] pr-2 shadow-pop"
      data-testid="request-bar"
    >
      <span className="text-accent">
        <IconBranch size={18} />
      </span>
      <label htmlFor="request-bar-input" className="sr-only">
        Need something bigger? Request a change
      </label>
      <input
        id="request-bar-input"
        type="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={`Need something bigger? Describe it and ${agencyName} will build it`}
        className="h-10 min-w-0 flex-1 bg-transparent text-[14px] text-text placeholder:text-muted/80 focus:outline-none"
      />
      <button type="submit" aria-label="Request a change" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg hover:opacity-90">
        <IconSend size={18} />
      </button>
    </form>
  );
}

// --- restore prompt ---------------------------------------------------------------------------

export function RestorePrompt({ open, savedAt, count, source = "browser", onKeep, onDiscard }: { open: boolean; savedAt: string; count: number; source?: "browser" | "account"; onKeep: () => void; onDiscard: () => void }) {
  const when = (() => {
    const date = new Date(savedAt);
    return Number.isNaN(date.getTime()) ? "earlier" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  })();
  return (
    <Modal
      open={open}
      onClose={onKeep}
      title="You have unpublished changes"
      footer={
        <>
          <Button variant="danger" onClick={onDiscard}>
            Discard
          </Button>
          <Button onClick={onKeep} data-testid="restore-keep">
            Keep
          </Button>
        </>
      }
    >
      <p className="text-[14px] leading-relaxed text-text">
        You have {count} unpublished {count === 1 ? "change" : "changes"} from {when}, {source === "account" ? "saved to your account (you may have made them on another device)" : "saved in this browser"}. Keep working on them, or discard them and start from what is published.
      </p>
    </Modal>
  );
}

// --- too small ----------------------------------------------------------------------------------

export function TooSmall({ formEditorHref, homeHref, children }: { formEditorHref: string; homeHref: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-ground p-6">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-card border border-line bg-panel p-6 shadow-sheet">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-control bg-ground text-text">
          <IconKeyboard size={20} />
        </span>
        <h1 className="font-display text-[22px] font-semibold text-text">Visual editing needs a bigger screen</h1>
        <p className="text-[14px] leading-relaxed text-muted">The visual editor shows your whole website next to its tools, which needs a window at least 900 pixels wide. On this screen, the page editor edits the same content with a form.</p>
        {children}
        <div className="flex flex-wrap gap-2">
          <LinkButton to={formEditorHref}>Open the page editor</LinkButton>
          <LinkButton to={homeHref} variant="secondary">
            Back
          </LinkButton>
        </div>
      </div>
    </div>
  );
}
