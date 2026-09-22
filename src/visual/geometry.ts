/**
 * Per-frame geometry from the bridge (hover and selection rectangles, viewport),
 * kept outside React state so the overlays can follow scrolling at 60fps without
 * re-rendering the whole editor. Read it with `useGeometry()`.
 */
import { useSyncExternalStore } from "react";
import type { MappedField, Viewport } from "@shared/visualProtocol.ts";

export type Geometry = {
  hover: MappedField | null;
  /** The selected element's latest rectangle, or null when it is not on this page. */
  selected: MappedField | null;
  viewport: Viewport;
  fields: MappedField[];
};

export type GeometryStore = {
  get: () => Geometry;
  subscribe: (listener: () => void) => () => void;
  patch: (partial: Partial<Geometry>) => void;
  reset: () => void;
};

const initial = (): Geometry => ({ hover: null, selected: null, viewport: { width: 0, height: 0, scrollX: 0, scrollY: 0 }, fields: [] });

export function createGeometryStore(): GeometryStore {
  let state = initial();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    patch: (partial) => {
      state = { ...state, ...partial };
      emit();
    },
    reset: () => {
      state = initial();
      emit();
    },
  };
}

export function useGeometry(store: GeometryStore): Geometry {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
