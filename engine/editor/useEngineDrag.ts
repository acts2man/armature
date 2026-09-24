/**
 * Pointer-based drag for the engine canvas, simplified from src/builder/useDrag.ts: a
 * new element from the Elements panel or a move of the selected element. HTML5 drag
 * events never cross into the iframe, so the drag captures the pointer in the parent,
 * converts it into the frame's own pixels, asks `locate` for the drop target, auto-scrolls
 * the frame near its edges and drops on pointer-up. Esc cancels.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { InsertKind } from "../shared/types.ts";
import type { EngineDropTarget } from "./drop.ts";

export type EngineDragSource = { kind: "new"; insert: InsertKind; label: string } | { kind: "move"; id: string; label: string };

export type EngineDragState = {
  source: EngineDragSource;
  clientX: number;
  clientY: number;
  target: EngineDropTarget | null;
  overCanvas: boolean;
  /** Why the current spot is refused, when it is. */
  refusal: string | null;
};

const DRAG_THRESHOLD = 4;
const EDGE = 48;

export function useEngineDrag(opts: {
  sheetRef: RefObject<HTMLDivElement | null>;
  scale: number;
  /** Frame pixels in, the drop target (or a refusal message) out. */
  locate: (x: number, y: number, source: EngineDragSource) => { target: EngineDropTarget | null; refusal: string | null };
  onDrop: (source: EngineDragSource, target: EngineDropTarget) => void;
  onScroll: (deltaY: number) => void;
}) {
  const [drag, setDrag] = useState<EngineDragState | null>(null);
  const dragRef = useRef<EngineDragState | null>(null);
  const pending = useRef<{ source: EngineDragSource; startX: number; startY: number; pointerId: number; target: HTMLElement } | null>(null);
  const scrollTimer = useRef(0);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const update = useCallback((next: EngineDragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const locate = useCallback((clientX: number, clientY: number): Pick<EngineDragState, "target" | "overCanvas" | "refusal"> => {
    const { sheetRef, scale } = optsRef.current;
    const sheet = sheetRef.current;
    const current = dragRef.current;
    if (!sheet || !current) return { target: null, overCanvas: false, refusal: null };
    const box = sheet.getBoundingClientRect();
    const overCanvas = clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
    if (!overCanvas) return { target: null, overCanvas: false, refusal: null };
    const x = (clientX - box.left + sheet.scrollLeft) / scale;
    const y = (clientY - box.top + sheet.scrollTop) / scale;
    const located = optsRef.current.locate(x, y, current.source);
    return { ...located, overCanvas };
  }, []);

  const stopScrolling = () => {
    window.clearInterval(scrollTimer.current);
    scrollTimer.current = 0;
  };

  const autoScroll = useCallback(
    (clientY: number) => {
      const sheet = optsRef.current.sheetRef.current;
      if (!sheet) return stopScrolling();
      const box = sheet.getBoundingClientRect();
      const fromTop = clientY - box.top;
      const fromBottom = box.bottom - clientY;
      let delta = 0;
      if (fromTop >= 0 && fromTop < EDGE) delta = -Math.ceil((EDGE - fromTop) / 4);
      else if (fromBottom >= 0 && fromBottom < EDGE) delta = Math.ceil((EDGE - fromBottom) / 4);
      if (delta === 0) return stopScrolling();
      if (!scrollTimer.current) {
        scrollTimer.current = window.setInterval(() => {
          const current = dragRef.current;
          if (!current) return stopScrolling();
          optsRef.current.onScroll(delta * 2);
          update({ ...current, ...locate(current.clientX, current.clientY) });
        }, 40);
      }
    },
    [locate, update],
  );

  const finish = useCallback(
    (drop: boolean) => {
      stopScrolling();
      const current = dragRef.current;
      pending.current = null;
      update(null);
      document.body.classList.remove("ae-dragging");
      if (!current) return;
      // The pointer-up that ends a drag also clicks whatever the drag started from; swallow that click.
      const swallow = (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 250);
      if (drop && current.target) optsRef.current.onDrop(current.source, current.target);
    },
    [update],
  );

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const waiting = pending.current;
      if (waiting && !dragRef.current) {
        if (Math.hypot(event.clientX - waiting.startX, event.clientY - waiting.startY) < DRAG_THRESHOLD) return;
        try {
          waiting.target.setPointerCapture(waiting.pointerId);
        } catch {
          // capture is a nicety; the window listeners still see every move
        }
        document.body.classList.add("ae-dragging");
        update({ source: waiting.source, clientX: event.clientX, clientY: event.clientY, target: null, overCanvas: false, refusal: null });
      }
      const current = dragRef.current;
      if (!current) return;
      event.preventDefault();
      const located = locate(event.clientX, event.clientY);
      update({ ...current, clientX: event.clientX, clientY: event.clientY, ...located });
      if (located.overCanvas) autoScroll(event.clientY);
      else stopScrolling();
    };
    const onUp = () => {
      if (dragRef.current) finish(true);
      else pending.current = null;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dragRef.current) {
        event.preventDefault();
        finish(false);
      }
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
      stopScrolling();
    };
  }, [autoScroll, finish, locate, update]);

  /** Call from a pointerdown handler on anything draggable. The drag starts after a few pixels of movement. */
  const beginDrag = useCallback((event: React.PointerEvent, source: EngineDragSource) => {
    if (event.button !== 0) return;
    pending.current = { source, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId, target: event.currentTarget as HTMLElement };
  }, []);

  /** Re-run the hit test at the current pointer position (a lazy resolve just finished). */
  const relocate = useCallback(() => {
    const current = dragRef.current;
    if (!current) return;
    update({ ...current, ...locate(current.clientX, current.clientY) });
  }, [locate, update]);

  return { drag, beginDrag, relocate, cancelDrag: () => finish(false) };
}
