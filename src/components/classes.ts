/** Class-name helpers shared by the UI kit and by screens that need a styled <a> or <input>. */
import { clsx } from "clsx";

export type Variant = "primary" | "secondary" | "ghost" | "danger";
export type Size = "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-line bg-panel text-text hover:bg-ground",
  ghost: "text-text hover:bg-ground",
  danger: "border border-danger/40 bg-panel text-danger hover:bg-danger-soft",
};
const sizes: Record<Size, string> = {
  md: "min-h-11 px-4 text-[15px]",
  sm: "min-h-9 px-3 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string): string {
  return clsx(base, variants[variant], sizes[size], className);
}

export const inputClass =
  "block w-full min-h-11 rounded-lg border border-line bg-panel px-3 py-2 text-[15px] text-text placeholder:text-muted/70 focus:border-accent disabled:bg-ground disabled:text-muted";
