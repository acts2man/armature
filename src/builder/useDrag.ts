/**
 * Pointer-based drag and drop for the canvas: from the Elements panel (a new element)
 * or moving an existing one. HTML5 drag events never cross into the iframe, so the
 * drag captures the pointer in the parent, converts it into the frame's own pixels,
 * hit-tests the rect map, draws the indicator from the parent, auto-scrolls the frame
 * near its edges, and drops on pointer-up. Esc cancels.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { Device, Element } from "@shared/builder/index.ts";
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
  /** The device being edited: a container's direction may differ per device. */
  device: Device;
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
    const { sheetRef, scale, geometry, getState, slug, allowLocked, device } = optsRef.current;
    const sheet = sheetRef.current;
    const current = dragRef.current;
    if (!sheet || !current) return { target: null, overCanvas: false };
    const box = sheet.getBoundingClientRect();
    const overCanvas = clientX >= box.left && clientX <= box.right && clientY >= box.top && clientY <= box.bottom;
    if (!overCanvas) return { target: null, overCanvas: false };
    // (The sheet never stays scrolled, but if it is mid-reset the offset still applies.)
    const x = (clientX - box.left + sheet.scrollLeft) / scale;
    const y = (clientY - box.top + sheet.scrollTop) / scale;
    const state = getState();
    const elements = geometry.get().elements;
    const viewport = geometry.get().viewport;
    const pageRect: Rect = { x: 0, y: 0, width: viewport.width || box.width / scale, height: viewport.height || box.height / scale };
    const target = hitTest({ state, elements, slug, x, y, movingId: current.source.kind === "move" ? current.source.id : undefined, pageRect, allowLocked, device });
    return { target, overCanvas };
  }, []);

  const stopScrolling = () => {
    window.clearInterval(scrollTimer.current);
    scrollTimer.current = 0;
  };

  /** How far each auto-scroll tick moves the frame: from the pointer's depth in the edge band, refreshed on every move. */
  const scrollDelta = useRef(0);
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
    // The timer reads the latest depth, so pushing further into the band speeds the scroll up
    // (and easing back slows it) while the timer that the first move started keeps running.
    scrollDelta.current = delta;
    if (!scrollTimer.current) {
      scrollTimer.current = window.setInterval(() => {
        const current = dragRef.current;
        if (!current) return stopScrolling();
        optsRef.current.onScroll(scrollDelta.current * 2);
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

  /**
   * Start a drag straight away, at a point in page (client) pixels: from a keyboard "Move"
   * action, the Navigator, or the page itself (the bridge reports a drag that began inside the
   * frame, where the parent never sees the pointer). The pointer's later positions arrive through
   * `followDrag`, and `endDrag` drops or cancels.
   */
  const startDragAt = useCallback(
    (source: DragSource, clientX: number, clientY: number) => {
      pending.current = null;
      document.body.classList.add("ae-dragging");
      dragRef.current = { source, clientX, clientY, target: null, overCanvas: false };
      update({ ...dragRef.current, ...locate(clientX, clientY) });
    },
    [locate, update],
  );

  /** The pointer moved (reported from inside the frame): find the drop under it and auto-scroll near the edges. */
  const followDrag = useCallback(
    (clientX: number, clientY: number) => {
      const current = dragRef.current;
      if (!current) return;
      const located = locate(clientX, clientY);
      update({ ...current, clientX, clientY, ...located });
      if (located.overCanvas) autoScroll(clientY);
      else stopScrolling();
    },
    [autoScroll, locate, update],
  );

  /** The pointer was released (a drop) or the drag was cancelled, from inside the frame. */
  const endDrag = useCallback((drop: boolean) => finish(drop), [finish]);

  return { drag, beginDrag, startDragAt, followDrag, endDrag, cancelDrag: () => finish(false) };
}
