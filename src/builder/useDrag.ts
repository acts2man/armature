/**
 * Pointer-based drag and drop for the canvas: from the Elements panel (a new element)
 * or moving an existing one. HTML5 drag events never cross into the iframe, so the
 * drag captures the pointer in the parent, converts it into the frame's own pixels,
 * hit-tests the rect map, draws the indicator from the parent, auto-scrolls the frame
 * near its edges, and drops on pointer-up. Esc cancels.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Element } from "@shared/builder/index.ts";
import type { Rect } from "@shared/visualProtocol.ts";
import { hitTest, type DropTarget } from "./dnd.ts";
import type { GeometryStore } from "@/visual/geometry.ts";
import type { BuilderState } from "./store.ts";

export type DragSource = { kind: "new"; label: string; create: () => Element } | { kind: "move"; id: string; slug: string; label: string };

export type DragState = {
  source: DragSource;
  /** Pointer in page (client) coordinates, for the ghost label. */
  clientX: number;
  clientY: number;
  /** The drop found under the pointer, or null when the pointer is off the canvas or over nothing valid. */
  target: DropTarget | null;
  /** True while the pointer is over the sheet. */
  overCanvas: boolean;
};

const DRAG_THRESHOLD = 4;
const EDGE = 48;

export function useDrag(opts: {
  sheetRef: RefObject<HTMLDivElement | null>;
  scale: number;
  geometry: GeometryStore;
  getState: () => BuilderState;
  slug: string;
  allowLocked: boolean;
  onDrop: (source: DragSource, target: DropTarget) => void;
  onScroll: (deltaY: number) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const pending = useRef<{ source: DragSource; startX: number; startY: number; pointerId: number; target: HTMLElement } | null>(null);
  const scrollTimer = useRef(0);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const update = useCallback((next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const locate = useCallback((clientX: number, clientY: number): { target: DropTarget | null; overCanvas: boolean } => {
    const { sheetRef, scale, geometry, getState, slug, allowLocked } = optsRef.current;
    const sheet = sheetRef.current;
    const current = dragRef.current;
    if (!sheet || !current) return { target: null, overCanvas: false };
    const box = sheet.getBoundingClientRect();
    const overCanvas = clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
    if (!overCanvas) return { target: null, overCanvas: false };
    const x = (clientX - box.left) / scale;
    const y = (clientY - box.top) / scale;
    const state = getState();
    const elements = geometry.get().elements;
    const viewport = geometry.get().viewport;
    const pageRect: Rect = { x: 0, y: 0, width: viewport.width || box.width / scale, height: viewport.height || box.height / scale };
    const target = hitTest({ state, elements, slug, x, y, movingId: current.source.kind === "move" ? current.source.id : undefined, pageRect, allowLocked });
    return { target, overCanvas };
  }, []);

  const stopScrolling = () => {
    window.clearInterval(scrollTimer.current);
    scrollTimer.current = 0;
  };

  const autoScroll = useCallback((clientY: number) => {
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
        const located = locate(current.clientX, current.clientY);
        update({ ...current, ...located });
      }, 40);
    }
  }, [locate, update]);

  const finish = useCallback(
    (drop: boolean) => {
      stopScrolling();
      const current = dragRef.current;
      pending.current = null;
      update(null);
      document.body.classList.remove("ae-dragging");
      if (!current) return;
      // The pointer-up that ends a drag also fires a click on the element the drag started from
      // (a panel item, a toolbar handle); swallow that one click so it never doubles the action.
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
          // capture is a nicety; the window listeners below still see every move
        }
        document.body.classList.add("ae-dragging");
        update({ source: waiting.source, clientX: event.clientX, clientY: event.clientY, target: null, overCanvas: false });
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
  const beginDrag = useCallback((event: React.PointerEvent, source: DragSource) => {
    if (event.button !== 0) return;
    pending.current = { source, startX: event.clientX, startY: event.clientY, pointerId: event.pointerId, target: event.currentTarget as HTMLElement };
  }, []);

  /** Start a drag straight away (from a keyboard "Move" action, or the Navigator). */
  const startDragAt = useCallback(
    (source: DragSource, clientX: number, clientY: number) => {
      document.body.classList.add("ae-dragging");
      update({ source, clientX, clientY, target: null, overCanvas: false });
    },
    [update],
  );

  return { drag, beginDrag, startDragAt, cancelDrag: () => finish(false) };
}
