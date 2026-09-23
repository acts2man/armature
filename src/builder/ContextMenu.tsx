/**
 * The right-click menu for an element: Edit, Duplicate, Copy, Paste, Paste style,
 * Reset style, Save as template, Navigator, Lock (agency), Hide on device, Delete.
 * Positioned inside the viewport, closes on Escape, on a click elsewhere and on scroll.
 */
import { clsx } from "clsx";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type MenuItem = { key: string; label: string; icon?: ReactNode; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void } | { key: string; separator: true };

export function ContextMenu({ x, y, items, onClose, label = "Element menu" }: { x: number; y: number; items: MenuItem[]; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(x, window.innerWidth - width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - height - 8)) });
  }, [x, y]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = buttons[(index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length];
        next?.focus();
      }
    };
    // Close when the canvas scrolls (the menu is anchored to it), but not when the left
    // editor panel re-renders and scrolls its own content, and not from the scroll the
    // opening right-click itself triggers when it scrolls the selected element into view.
    const openedAt = Date.now();
    const onScroll = (event: Event) => {
      if (Date.now() - openedAt < 350) return;
      const target = event.target;
      if (target instanceof Node && document.querySelector('[data-testid="builder-panel"]')?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} role="menu" aria-label={label} data-testid="context-menu" className="toast-in fixed z-50 min-w-56 rounded-[10px] border border-line bg-panel p-1.5 shadow-pop" style={position}>
      {items.map((item) =>
        "separator" in item ? (
          <div key={item.key} role="separator" className="my-1 h-px bg-line" />
        ) : (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={clsx("flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-left text-[13px] disabled:opacity-40", item.danger ? "text-red hover:bg-red-soft" : "text-text hover:bg-ground")}
          >
            <span className="inline-flex w-4 shrink-0 items-center justify-center text-muted">{item.icon}</span>
            <span className="flex-1">{item.label}</span>
            {item.shortcut && <kbd className="font-sans text-[11px] text-muted">{item.shortcut}</kbd>}
          </button>
        ),
      )}
    </div>
  );
}
