/**
 * Per-agency accent colour. Sets the runtime CSS variables the design tokens read.
 */
const DEFAULT_ACCENT = "#2b3fd6";

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (index: number) => {
    const part = Number.parseInt(value.slice(index, index + 2), 16) / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function applyAccent(color: string | null | undefined): void {
  const accent = color && isHexColor(color) ? color : DEFAULT_ACCENT;
  const root = document.documentElement;
  root.style.setProperty("--accent", accent);
  // White text on dark accents, ink on light ones (WCAG contrast heuristic).
  root.style.setProperty("--accent-fg", luminance(accent) > 0.4 ? "#16202b" : "#ffffff");
}

export function applyPortalTitle(portalName: string | null | undefined): void {
  document.title = portalName?.trim() || "Editing dashboard";
}
