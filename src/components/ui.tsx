/**
 * The UI kit every screen builds from, matching docs/*.html: quiet white panels
 * with 1px borders on a cool grey ground, 8px radii on controls and 12px on cards,
 * 44px targets, Bricolage Grotesque headings and the agency accent everywhere a
 * primary action lives. Everything here is accessible by default: real labels,
 * visible focus, status text for screen readers.
 */
import { clsx } from "clsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Link } from "react-router";
import { buttonClass, inputClass, textareaClass, type Size, type Variant } from "./classes.ts";
import { IconAlert, IconCheckCircle, IconChevronDown, IconInfo, IconX, IconXCircle } from "./icons.tsx";

// --- buttons ------------------------------------------------------------------------

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

function LoadingDot() {
  return (
    <span aria-hidden="true" className="inline-flex h-4 w-4 items-center justify-center">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
    </span>
  );
}

export function Button({ variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading && <LoadingDot />}
      {children}
    </button>
  );
}

export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  className,
  children,
  external,
  ...rest
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children"> & {
  to: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
  external?: boolean;
}) {
  if (external) {
    return (
      <a {...rest} href={to} target="_blank" rel="noreferrer" className={buttonClass(variant, size, clsx("btn", className))}>
        {children}
      </a>
    );
  }
  return (
    <Link {...rest} to={to} className={buttonClass(variant, size, clsx("btn", className))}>
      {children}
    </Link>
  );
}

/** A square icon-only button. `label` is required: it is the accessible name. */
export function IconButton({
  label,
  active,
  size = "md",
  tone = "light",
  className,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  size?: "md" | "sm";
  tone?: "light" | "dark";
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-control border border-transparent disabled:cursor-not-allowed disabled:opacity-50",
        size === "md" ? "h-11 w-11" : "h-9 w-9",
        tone === "light" && (active ? "bg-blue-soft text-accent" : "text-muted hover:bg-ground hover:text-text"),
        tone === "dark" && (active ? "bg-ink-2 text-white" : "text-ink-text hover:bg-ink-2 hover:text-white"),
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// --- form controls ----------------------------------------------------------------

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(inputClass, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(textareaClass, className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={clsx(inputClass, "appearance-none pr-9", className)} {...rest}>
        {children}
      </select>
      <IconChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
    </span>
  );
}

/** A labelled control. `htmlFor` must match the control's id. */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-semibold text-text">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-[12px] leading-relaxed text-muted">{hint}</p>}
      {error && (
        <p className="text-[13px] text-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** The 44×26 switch from the modules screen. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name, e.g. "Turn off Media". */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        "inline-flex h-[26px] w-11 shrink-0 items-center rounded-full p-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "justify-end bg-green" : "justify-start bg-line",
        className,
      )}
    >
      <span className="h-5 w-5 rounded-full bg-white shadow-segment" />
    </button>
  );
}

// --- surfaces -------------------------------------------------------------------------

export function Card({
  children,
  className,
  as: Tag = "div",
  padded = true,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "aside";
  padded?: boolean;
  "aria-live"?: "polite" | "off";
  "aria-labelledby"?: string;
}) {
  return (
    <Tag className={clsx("rounded-card border border-line bg-panel", padded && "p-4 sm:p-5", className)} {...rest}>
      {children}
    </Tag>
  );
}

/** A card with the 56px header row from the designs. */
export function Panel({
  title,
  aside,
  children,
  className,
  as: Tag = "section",
  id,
  bodyClassName,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "aside" | "div" | "article";
  id?: string;
  bodyClassName?: string;
}) {
  const headingId = useId();
  return (
    <Tag className={clsx("flex flex-col overflow-hidden rounded-card border border-line bg-panel", className)} aria-labelledby={id ?? headingId}>
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 sm:px-5">
        <h2 id={id ?? headingId} className="font-sans text-[15px] font-bold tracking-normal text-text">
          {title}
        </h2>
        {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      <div className={clsx("min-w-0", bodyClassName)}>{children}</div>
    </Tag>
  );
}

/** A row inside a Panel: icon, text and an action, divided by 1px lines. */
export function PanelRow({
  icon,
  title,
  detail,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-2.5 last:border-b-0 sm:px-5", className)}>
      <div className="flex min-w-0 items-center gap-3.5">
        {icon && <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-ground text-text">{icon}</span>}
        <div className="min-w-0">
          <div className="font-semibold text-text">{title}</div>
          {detail && <div className="text-[13px] text-muted">{detail}</div>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** The 28px Bricolage number with a label above and a note beside it. */
export function StatCard({ label, value, note, className }: { label: ReactNode; value: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-col gap-1.5 rounded-card border border-line bg-panel px-5 py-4", className)}>
      <div className="text-[13px] text-muted">{label}</div>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="font-display text-[28px] font-semibold leading-none text-text">{value}</span>
        {note && <span className="text-[12px] text-muted">{note}</span>}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
  /** A row of pills and short facts under the title, like "site.com · Live · Last published …". */
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        {eyebrow && <div className="text-[13px] font-medium text-muted">{eyebrow}</div>}
        <h1 className="font-display text-[26px] font-semibold leading-tight text-text sm:text-[30px]">{title}</h1>
        {description && <p className="max-w-2xl text-[14px] leading-relaxed text-muted">{description}</p>}
        {meta && <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px] text-muted">{meta}</div>}
      </div>
      {action && <div className="flex flex-wrap gap-2.5">{action}</div>}
    </div>
  );
}

// --- status ---------------------------------------------------------------------------

type NoticeKind = "info" | "success" | "warning" | "danger";
const noticeStyles: Record<NoticeKind, string> = {
  info: "border-line bg-panel text-text",
  success: "border-green/25 bg-green-soft text-green",
  warning: "border-amber/25 bg-amber-soft text-amber",
  danger: "border-red/25 bg-red-soft text-red",
};
const noticeIcons: Record<NoticeKind, ReactNode> = {
  info: <IconInfo size={18} />,
  success: <IconCheckCircle size={18} />,
  warning: <IconAlert size={18} />,
  danger: <IconXCircle size={18} />,
};

/** A message block. Warnings and errors announce themselves. */
export function Notice({
  kind = "info",
  title,
  children,
  className,
  action,
}: {
  kind?: NoticeKind;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <div role={kind === "warning" || kind === "danger" ? "alert" : "status"} className={clsx("flex gap-3 rounded-card border p-4 text-[14px]", noticeStyles[kind], className)}>
      <span className="mt-0.5 shrink-0">{noticeIcons[kind]}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx("whitespace-pre-wrap break-words leading-relaxed", title && "mt-1")}>{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <p className="inline-flex items-center gap-2 text-[13px] text-muted" role="status">
      <LoadingDot />
      {label}
    </p>
  );
}

/** A shimmering placeholder that keeps the layout still while data loads. */
export function Skeleton({ className, lines = 1 }: { className?: string; lines?: number }) {
  if (lines <= 1) return <span aria-hidden="true" className={clsx("skeleton block h-4", className)} />;
  return (
    <span aria-hidden="true" className={clsx("block space-y-2", className)}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className={clsx("skeleton block h-4", index === lines - 1 && "w-2/3")} />
      ))}
    </span>
  );
}

/** A few skeleton rows inside a panel, with a status line for screen readers. */
export function SkeletonRows({ rows = 3, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-line px-4 py-4 last:border-b-0 sm:px-5" aria-hidden="true">
          <span className="skeleton h-8 w-8 shrink-0 rounded-control" />
          <span className="flex-1 space-y-2">
            <span className="skeleton block h-3.5 w-1/2" />
            <span className="skeleton block h-3 w-1/3" />
          </span>
          <span className="skeleton h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export type PillTone = "neutral" | "success" | "warning" | "danger" | "accent" | "blue" | "green" | "amber" | "grey";
const pillStyles: Record<PillTone, string> = {
  neutral: "bg-grey-soft text-muted",
  grey: "bg-grey-soft text-muted",
  success: "bg-green-soft text-green",
  green: "bg-green-soft text-green",
  warning: "bg-amber-soft text-amber",
  amber: "bg-amber-soft text-amber",
  danger: "bg-red-soft text-red",
  accent: "bg-blue-soft text-blue",
  blue: "bg-blue-soft text-blue",
};

export function Pill({ tone = "neutral", children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold", pillStyles[tone], className)}>
      {children}
    </span>
  );
}

/** Badge is the same shape as Pill; the name matches the design notes. */
export const Badge = Pill;

/** A count bubble for navigation, white on the dark sidebar. */
export function CountBadge({ count, tone = "dark" }: { count: number; tone?: "dark" | "light" }) {
  if (count <= 0) return null;
  return (
    <span
      className={clsx(
        "inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[12px] font-bold",
        tone === "dark" ? "bg-white text-ink" : "bg-ink text-white",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

/** Two-letter monogram in a soft square, used for sites and people. */
export function Monogram({
  name,
  size = "md",
  tone = "ground",
  round,
  className,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  tone?: "ground" | "white" | "ink" | "dark";
  round?: boolean;
  className?: string;
}) {
  const initials = useMemo(() => monogram(name), [name]);
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "inline-flex shrink-0 items-center justify-center font-bold",
        size === "sm" && "h-6 w-6 rounded-sm text-[11px]",
        size === "md" && "h-8 w-8 rounded-control text-[11px]",
        size === "lg" && "h-9 w-9 rounded-control text-[12px]",
        round && "rounded-full",
        tone === "ground" && "bg-ground text-text",
        tone === "white" && "bg-white text-ink",
        tone === "ink" && "bg-ink text-white",
        tone === "dark" && "bg-ink-2 text-white",
        className,
      )}
    >
      {initials}
    </span>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function monogram(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
}

export function EmptyState({ title, children, action, icon }: { title: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line bg-panel px-6 py-10 text-center">
      {icon && <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-control bg-ground text-muted">{icon}</span>}
      <p className="font-semibold text-text">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Visually hidden but read by screen readers. */
export function SrOnly({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

// --- tabs -------------------------------------------------------------------------------

/** The segmented control from the editor panels: 32px pills on a grey track. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={clsx("inline-flex gap-0.5 rounded-control bg-ground p-0.5", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={clsx(
              "h-8 min-w-11 rounded-sm px-3 text-[12px] font-semibold",
              active ? "bg-panel text-text shadow-segment" : "text-muted hover:text-text",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Route tabs with an accent underline. */
export function TabBar({ children, label }: { children: ReactNode; label: string }) {
  return (
    <nav aria-label={label} className="-mb-px flex flex-wrap gap-1 sm:flex-nowrap sm:overflow-x-auto">
      {children}
    </nav>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function tabClass({ isActive }: { isActive: boolean }): string {
  return clsx(
    "inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-[14px] font-medium",
    isActive ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
  );
}

// --- data tables ------------------------------------------------------------------------

/**
 * Grid-based table rows like the fleet screen: a 40px header, 58px rows, 1px
 * dividers. `columns` is a CSS grid-template-columns value; give each cell its own
 * element. Use with `role="table"` semantics for screen readers.
 */
export function DataTable({
  columns,
  head,
  children,
  label,
  className,
  minWidth,
}: {
  columns: string;
  head: ReactNode[];
  children: ReactNode;
  label: string;
  className?: string;
  /** Lets the grid scroll sideways on narrow screens instead of crushing cells. */
  minWidth?: number;
}) {
  return (
    <div className={clsx("overflow-x-auto", className)}>
      <div role="table" aria-label={label} style={{ minWidth }}>
        <div role="row" className="grid h-10 items-center gap-3 border-b border-line px-4 text-[12px] font-semibold text-muted sm:px-5" style={{ gridTemplateColumns: columns }}>
          {head.map((cell, index) => (
            <div role="columnheader" key={index} className="truncate">
              {cell}
            </div>
          ))}
        </div>
        <div role="rowgroup">{children}</div>
      </div>
    </div>
  );
}

export function DataRow({
  columns,
  children,
  selected,
  className,
  onClick,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "onClick" | "children"> & {
  columns: string;
  children: ReactNode;
  selected?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      {...rest}
      role="row"
      aria-selected={selected}
      onClick={onClick}
      className={clsx(
        "grid min-h-[58px] items-center gap-3 border-b border-line px-4 py-2 text-[13px] last:border-b-0 sm:px-5",
        selected ? "bg-blue-soft" : onClick && "hover:bg-ground",
        onClick && "cursor-pointer",
        className,
      )}
      style={{ gridTemplateColumns: columns }}
    >
      {children}
    </div>
  );
}

export function Cell({ children, className, muted }: { children?: ReactNode; className?: string; muted?: boolean }) {
  return (
    <div role="cell" className={clsx("min-w-0", muted && "text-muted", className)}>
      {children}
    </div>
  );
}

// --- toast --------------------------------------------------------------------------------

type ToastItem = { id: number; kind: "success" | "info" | "danger"; message: string };
type ToastContextValue = { show: (message: string, kind?: ToastItem["kind"]) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const show = useCallback((message: string, kind: ToastItem["kind"] = "success") => {
    const id = ++counter.current;
    setItems((current) => [...current, { id, kind, message }]);
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4000);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
        {items.map((item) => (
          <div
            key={item.id}
            className={clsx(
              "toast-in pointer-events-auto flex items-center gap-2 rounded-control px-4 py-3 text-[14px] font-medium shadow-dark",
              item.kind === "danger" ? "bg-red text-white" : "bg-ink text-white",
            )}
          >
            {item.kind === "success" && <IconCheckCircle size={16} />}
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  // Outside a provider (tests, isolated renders) a toast is simply not shown.
  return value ?? { show: () => undefined };
}

// --- modal and drawer ------------------------------------------------------------------------

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);
}

/** A centred dialog. Keeps focus inside, closes on Escape and on the backdrop. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEscape(open, onClose);
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center backdrop p-4 sm:items-center" onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="toast-in w-full max-w-lg rounded-card border border-line bg-panel shadow-pop outline-none"
      >
        <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-5">
          <h2 id={id} className="font-sans text-[15px] font-bold tracking-normal text-text">
            {title}
          </h2>
          <IconButton label="Close" size="sm" onClick={onClose}>
            <IconX size={18} />
          </IconButton>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** A panel that slides in from the right (or from the left for navigation). */
export function Drawer({
  open,
  onClose,
  title,
  side = "right",
  children,
  dark,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  side?: "left" | "right";
  children: ReactNode;
  dark?: boolean;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEscape(open, onClose);
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    <div className={clsx("fixed inset-0 z-40 flex backdrop", side === "right" && "justify-end")} onClick={onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={clsx("toast-in flex h-full w-[min(100%,320px)] flex-col outline-none", dark ? "bg-ink text-ink-text" : "border-l border-line bg-panel")}
      >
        <div className={clsx("flex min-h-14 items-center justify-between gap-3 px-4", dark ? "border-b border-ink-2" : "border-b border-line")}>
          <h2 id={id} className={clsx("font-sans text-[15px] font-bold tracking-normal", dark ? "text-white" : "text-text")}>
            {title}
          </h2>
          <IconButton label="Close" size="sm" tone={dark ? "dark" : "light"} onClick={onClose}>
            <IconX size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

// --- timeline ------------------------------------------------------------------------------

export type TimelineStep = { title: ReactNode; detail?: ReactNode; state: "done" | "current" | "todo"; mono?: boolean };

/** The progress list from the change-request panel. */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="flex flex-col gap-1">
      {steps.map((step, index) => {
        const last = index === steps.length - 1;
        return (
          <li key={index} className="flex min-h-11 gap-3">
            <div className="flex flex-col items-center gap-1">
              <span
                className={clsx(
                  "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                  step.state === "done" && "bg-green-soft text-green",
                  step.state === "current" && "bg-accent text-accent-fg",
                  step.state === "todo" && "border border-line bg-panel text-muted",
                )}
              >
                {step.state === "done" ? (
                  <IconCheckCircle size={14} />
                ) : step.state === "current" ? (
                  <span className="h-2 w-2 rounded-full bg-white" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-line" />
                )}
              </span>
              {!last && <span className="w-px flex-1 bg-line" aria-hidden="true" />}
            </div>
            <div className="min-w-0 pb-2">
              <div className="text-[14px] font-semibold leading-6 text-text">{step.title}</div>
              {step.detail && <div className={clsx("text-[12px] leading-snug", step.mono ? "font-mono text-text" : "text-muted")}>{step.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The grey quote block that holds a request's title and details. */
export function QuoteBlock({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[10px] bg-ground px-4 py-3.5">
      <div className="font-display text-[18px] font-semibold leading-snug text-text">{title}</div>
      {children && <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}
