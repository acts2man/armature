/** Class-name helpers shared by the UI kit and by screens that need a styled <a> or <input>. */
import { clsx } from "clsx";

export type Variant = "primary" | "secondary" | "ghost" | "dark" | "danger";
export type Size = "md" | "sm" | "bar";

const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-semibold whitespace-nowrap border select-none disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg border-accent hover:opacity-90",
  secondary: "bg-panel text-text border-line hover:bg-ground",
  ghost: "bg-transparent text-text border-transparent hover:bg-ground",
  dark: "bg-ink text-white border-ink hover:bg-ink-2",
  danger: "bg-panel text-red border-red/40 hover:bg-red-soft",
};

const sizes: Record<Size, string> = {
  md: "h-11 px-4 text-[14px]",
  sm: "h-9 px-4 text-[14px]",
  bar: "h-10 px-4 text-[14px]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string): string {
  return clsx(base, variants[variant], sizes[size], className);
}

export const inputClass =
  "block w-full h-11 rounded-control border border-line bg-panel px-3 text-[14px] text-text placeholder:text-muted/70 hover:border-muted/50 focus:border-accent disabled:bg-ground disabled:text-muted";

export const textareaClass =
  "block w-full min-h-28 rounded-control border border-line bg-panel px-3 py-2.5 text-[14px] leading-relaxed text-text placeholder:text-muted/70 hover:border-muted/50 focus:border-accent disabled:bg-ground disabled:text-muted";
