/**
 * Renders an icon saved in an element (a whitelist of SVG node types with their
 * attributes, the shape the lucide set uses). No icon library at runtime.
 */
import { createElement } from "react";
import type { IconValue } from "./types.ts";

const NODE_TAGS = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
const ATTRIBUTES = new Set(["d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2", "width", "height", "points", "fill", "stroke", "stroke-width", "transform", "opacity"]);

export function Icon({ icon, size, className, label }: { icon: IconValue | null | undefined; size?: number | string; className?: string; label?: string }) {
  if (!icon || !Array.isArray(icon.nodes)) return null;
  const nodes = icon.nodes.filter((node) => Array.isArray(node) && NODE_TAGS.has(node[0]) && node[1] && typeof node[1] === "object");
  const style = size !== undefined ? { width: size, height: size } : undefined;
  return (
    <svg viewBox="0 0 24 24" className={className ? `ae-icon-svg ${className}` : "ae-icon-svg"} style={style} aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
      {nodes.map(([tag, attributes], index) => {
        const safe: Record<string, string> = {};
        for (const [name, value] of Object.entries(attributes)) {
          if (ATTRIBUTES.has(name) && typeof value === "string" && !/url\(|javascript:/i.test(value)) safe[name] = value;
        }
        return createElement(tag, { key: index, ...safe });
      })}
    </svg>
  );
}
