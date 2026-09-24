/**
 * The engine editor once the preview is up: the builder's top bar, the switching left
 * panel (Elements or Edit), and the preview in the canvas with the engine's overlays.
 * Every click in the preview becomes a NodeRef the server resolves into what can be
 * edited; every change is one edit op applied to the site's real source, after which the
 * preview hot-reloads and the bridge sends a fresh map. Undo, redo, drag to move, insert,
 * inline text editing and publishing all go through the engine API.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { defaultSiteKit, type SiteKit } from "../../shared/builder/index.ts";
import { ARMATURE_CONTRACT_VERSION, type PageDefinition, type SiteSchema } from "../../shared/schema.ts";
import type { RichTextCommand, RichTextState } from "../../shared/visualProtocol.ts";
import { BuilderPanel } from "../../src/builder/BuilderPanel.tsx";
import type { HandleActions } from "../../src/builder/Handles.tsx";
import type { HandleWrite } from "../../src/builder/handles.ts";
import { readPanelCollapsed, writePanelCollapsed } from "../../src/builder/panelState.ts";
import { useToast } from "../../src/components/ui.tsx";
import type { Agency, Site } from "../../src/lib/types.ts";
import { Canvas, type ToolbarActions } from "../../src/visual/Canvas.tsx";
import { createGeometryStore } from "../../src/visual/geometry.ts";
import { modelDevice, normalizePath, type Device } from "../../src/visual/pages.ts";
import { ShortcutsSheet } from "../../src/visual/Sheets.tsx";
import { TopBar } from "../../src/visual/TopBar.tsx";
import type { Declarations, EditOp, HistoryState, InsertKind, Loc, NodeRef, ResolvedNode, RichRun, SiteInfo } from "../shared/types.ts";
import type { EngineApi, EngineEditResult } from "./api.ts";
import { findDropTarget } from "./drop.ts";
import { EngineElementsPanel, insertLabel } from "./EngineElementsPanel.tsx";
import { EngineInspector } from "./EngineInspector.tsx";
import { EngineOverlays } from "./EngineOverlays.tsx";
import { EnginePublishDialog } from "./EnginePublishDialog.tsx";
import { ancestorChain, idForLoc, labelFor, refOf, stylesheetsIn } from "./nodes.ts";
import { useEngineBridge, type EngineBridgeMessage, type EngineNodeInfo } from "./useEngineBridge.ts";
import { useEngineDrag, type EngineDragSource } from "./useEngineDrag.ts";
import type { EngineDropTarget } from "./drop.ts";

const EMPTY_SCHEMA: SiteSchema = {
  armatureContract: ARMATURE_CONTRACT_VERSION,
  pages: [],
};
const NO_CHANGES = new Set<string>();
const NOOP_ACTIONS: ToolbarActions = {
  onEditInline: () => undefined,
  onReplaceImage: () => undefined,
  onEditLink: () => undefined,
  onRevert: () => undefined,
  onRequestChange: () => undefined,
};
/** Style writes from a control or a handle are merged per group and sent after this pause; the last value always goes. */
const STYLE_DELAY_MS = 150;
/** After an edit the preview hot-reloads; the selection's computed style is asked for again after this. */
const REFRESH_DELAY_MS = 500;

/** The canvas is wide enough for a desktop; the tablet sits just under the site's desktop breakpoint; the phone is a real phone. */
function deviceWidthsFor(info: SiteInfo): Record<Device, number> {
  const desktopBreakpoint = info.theme.breakpoints.desktop;
  const tablet = desktopBreakpoint >= 700 && desktopBreakpoint <= 1400 ? desktopBreakpoint - 1 : 1024;
  return { desktop: 1440, tablet, phone: 390 };
}

/** The site kit the colour pickers show: the defaults, with the site's own primary / secondary / accent when its theme names them. */
function kitFor(info: SiteInfo): SiteKit {
  const kit = defaultSiteKit();
  const find = (pattern: RegExp) => info.theme.colors.find((color) => pattern.test(color.name) && /^#[0-9a-f]{3,8}$/i.test(color.value))?.value;
  const primary = find(/^primary$/i);
  const secondary = find(/^secondary$/i);
  const accent = find(/^accent$/i);
  return {
    ...kit,
    colors: {
      ...kit.colors,
      primary: primary ?? kit.colors.primary,
      secondary: secondary ?? kit.colors.secondary,
      accent: accent ?? kit.colors.accent,
      custom: info.theme.colors
        .filter((color) => /^#[0-9a-f]{3,8}$/i.test(color.value) && !/^(primary|secondary|accent)$/i.test(color.name))
        .slice(0, 12)
        .map((color) => ({
          id: color.name.replace(/[^a-z0-9_-]/gi, "-"),
          label: color.name,
          value: color.value,
        })),
    },
  };
}

const runsToText = (runs: RichRun[]): string => runs.map((run) => (run.br ? "\n" : run.text)).join("");

/** The canvas scale (sheet width over device width), measured from the sheet the Canvas draws. */
function useScale(sheetRef: React.RefObject<HTMLDivElement | null>, deviceWidth: number): number {
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = sheetRef.current;
    if (!element) return;
    const measure = () => setScale(Math.min(1, Math.max(0.1, element.clientWidth / deviceWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [sheetRef, deviceWidth]);
  return scale;
}

export function EngineWorkspace({ api, site, info, previewUrl, isStaff, agency, userName, initialPage }: { api: EngineApi; site: Site; info: SiteInfo; previewUrl: string; isStaff: boolean; agency: Agency | null; userName: string; initialPage: string }) {
  const siteId = site.id;
  const toast = useToast();
  const [, setSearchParams] = useSearchParams();
  const [pagePath, setPagePath] = useState(initialPage);
  const pagePathRef = useRef(pagePath);
  const [device, setDevice] = useState<Device>("desktop");
  const deviceRef = useRef(device);
  const deviceWidths = useMemo(() => deviceWidthsFor(info), [info]);
  const kit = useMemo(() => kitFor(info), [info]);
  const [geometry] = useState(() => createGeometryStore());
  const [nodes, setNodes] = useState<Record<string, EngineNodeInfo>>({});
  const nodesRef = useRef(nodes);
  const [computed, setComputed] = useState<{
    id: string;
    computed: Record<string, string>;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef(selectedId);
  const [history, setHistory] = useState<HistoryState>({
    canUndo: false,
    canRedo: false,
    undoLabel: null,
    redoLabel: null,
    length: 0,
  });
  const [changedCount, setChangedCount] = useState(0);
  const [editing, setEditing] = useState<{
    id: string;
    runs: RichRun[];
  } | null>(null);
  const [richState, setRichState] = useState<RichTextState | null>(null);
  const [panelMode, setPanelMode] = useState<"elements" | "edit">("elements");
  const [collapsed, setCollapsed] = useState(() => readPanelCollapsed());
  const [publishOpen, setPublishOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The server's answers per element id; cleared after every edit, undo and redo. The refs
  // are what event handlers read; the state is a copy for rendering, refreshed on every change.
  const resolvedRef = useRef(new Map<string, ResolvedNode>());
  const resolveErrors = useRef(new Map<string, string>());
  const pendingResolves = useRef(new Set<string>());
  const [resolveState, setResolveState] = useState<{
    nodes: Map<string, ResolvedNode>;
    errors: Map<string, string>;
    pending: Set<string>;
  }>({ nodes: new Map(), errors: new Map(), pending: new Set() });
  const syncResolve = useCallback(
    () =>
      setResolveState({
        nodes: new Map(resolvedRef.current),
        errors: new Map(resolveErrors.current),
        pending: new Set(pendingResolves.current),
      }),
    [],
  );
  const pendingSelect = useRef<Loc | null>(null);
  const reselecting = useRef(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const topBarRef = useRef<HTMLDivElement | null>(null);
  const scale = useScale(sheetRef, deviceWidths[device]);
  const relocateRef = useRef<() => void>(() => undefined);

  // Event handlers and async callbacks read the latest values through these refs.
  useEffect(() => {
    pagePathRef.current = pagePath;
    deviceRef.current = device;
    nodesRef.current = nodes;
    selectedRef.current = selectedId;
  });

  const togglePanel = useCallback((next: boolean) => {
    setCollapsed(next);
    writePanelCollapsed(next);
  }, []);

  const showHint = useCallback((text: string) => {
    setHint(text);
    window.setTimeout(() => setHint((current) => (current === text ? null : current)), 2500);
  }, []);

  // --- the bridge ---------------------------------------------------------------------------------------------
  const messageRef = useRef<(message: EngineBridgeMessage) => void>(() => undefined);
  const bridge = useEngineBridge({
    previewUrl,
    onMessage: (message) => messageRef.current(message),
  });
  const { send, load } = bridge;

  useEffect(() => {
    load(initialPage);
  }, [load, initialPage]);

  const rectsOf = useCallback(() => new Map(geometry.get().elements.map((element) => [element.id, element])), [geometry]);

  const resolve = useCallback(
    async (id: string): Promise<ResolvedNode | null> => {
      const cached = resolvedRef.current.get(id);
      if (cached) return cached;
      const node = nodesRef.current[id];
      if (!node || pendingResolves.current.has(id)) return null;
      pendingResolves.current.add(id);
      syncResolve();
      const answer = await api.resolve({
        site: siteId,
        ref: refOf(node),
        page: pagePathRef.current,
      });
      pendingResolves.current.delete(id);
      if (answer.ok) {
        resolvedRef.current.set(id, answer.node);
        resolveErrors.current.delete(id);
      } else {
        resolveErrors.current.set(id, answer.message);
      }
      syncResolve();
      relocateRef.current();
      return answer.ok ? answer.node : null;
    },
    [api, siteId, syncResolve],
  );
  const resolved = useCallback((id: string) => resolvedRef.current.get(id), []);

  const select = useCallback(
    (id: string | null, options: { fromCanvas?: boolean; scroll?: boolean } = {}) => {
      setSelectedId(id);
      reselecting.current = false;
      if (id) {
        setPanelMode("edit");
        void resolve(id);
        if (!options.fromCanvas) send({ type: "armature:element:select", id, scroll: options.scroll });
      } else {
        setPanelMode("elements");
        if (!options.fromCanvas) send({ type: "armature:element:select", id: null });
      }
    },
    [resolve, send],
  );

  const refreshChanges = useCallback(async () => {
    const answer = await api.changes(siteId);
    if (answer.ok) setChangedCount(answer.files.length);
  }, [api, siteId]);

  useEffect(() => {
    let active = true;
    api.changes(siteId).then(
      (answer) => {
        if (active && answer.ok) setChangedCount(answer.files.length);
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [api, siteId]);

  /** What every edit, undo and redo does with the server's answer. */
  const handleResult = useCallback(
    (result: EngineEditResult) => {
      if (!result.ok) {
        toast.show(result.message, "danger");
        return false;
      }
      setHistory(result.history);
      resolvedRef.current.clear();
      syncResolve();
      if (result.select) pendingSelect.current = result.select;
      for (const path of result.cssChanged ?? stylesheetsIn(result.changed)) send({ type: "armature:engine:css", path });
      void refreshChanges();
      window.setTimeout(() => {
        send({ type: "armature:engine:refresh" });
        // The preview has usually reloaded by now: find the element the server pointed at in the current map.
        const wanted = pendingSelect.current;
        if (wanted) {
          const found = idForLoc(nodesRef.current, wanted);
          if (found) {
            pendingSelect.current = null;
            select(found);
            return;
          }
        }
        const id = selectedRef.current;
        if (id && !pendingSelect.current) {
          void resolve(id);
          send({ type: "armature:element:select", id });
        }
      }, REFRESH_DELAY_MS);
      // A location that never shows up (the element rendered nothing) must not capture a later map.
      window.setTimeout(() => {
        if (pendingSelect.current === result.select) pendingSelect.current = null;
      }, 4000);
      return true;
    },
    [toast, send, refreshChanges, resolve, syncResolve, select],
  );

  const run = useCallback(
    async (op: EditOp): Promise<boolean> => {
      setBusy(true);
      const result = await api.apply({ site: siteId, op });
      setBusy(false);
      return handleResult(result);
    },
    [api, siteId, handleResult],
  );
  const undo = useCallback(async () => handleResult(await api.undo(siteId)), [api, siteId, handleResult]);
  const redo = useCallback(async () => handleResult(await api.redo(siteId)), [api, siteId, handleResult]);

  const targetOf = useCallback((id: string): NodeRef | null => {
    const node = resolvedRef.current.get(id);
    if (node) return node.ref;
    const info = nodesRef.current[id];
    return info ? refOf(info) : null;
  }, []);

  // --- style writes: merged per group, sent after a short pause -------------------------------------------------
  const styleQueue = useRef(new Map<string, { target: NodeRef; declarations: Declarations; timer: number }>());
  const queueStyle = useCallback(
    (target: NodeRef, declarations: Declarations, group: string) => {
      const existing = styleQueue.current.get(group);
      if (existing) window.clearTimeout(existing.timer);
      const merged = { ...(existing?.declarations ?? {}), ...declarations };
      const timer = window.setTimeout(() => {
        styleQueue.current.delete(group);
        void run({
          op: "style",
          target,
          device: deviceRef.current,
          declarations: merged,
        });
      }, STYLE_DELAY_MS);
      styleQueue.current.set(group, { target, declarations: merged, timer });
    },
    [run],
  );
  useEffect(() => {
    const queue = styleQueue.current;
    return () => {
      for (const entry of queue.values()) window.clearTimeout(entry.timer);
    };
  }, []);

  /** The padding and margin handles: sides that changed from the measured box (or were sent earlier in the same drag). */
  const sentSides = useRef(new Map<string, Set<string>>());
  const handleActions = useMemo<HandleActions>(
    () => ({
      onWrite: (writes: HandleWrite[], _label, group) => {
        for (const write of writes) {
          const target = targetOf(write.id);
          const rect = rectsOf().get(write.id);
          if (!target || !rect) continue;
          const kind = write.path[0] === "advanced" && (write.path[1] === "padding" || write.path[1] === "margin") ? write.path[1] : null;
          if (kind) {
            const sides = write.value as Partial<Record<"top" | "right" | "bottom" | "left", { value: number; unit: string }>>;
            const sent = sentSides.current.get(group) ?? new Set<string>();
            const declarations: Declarations = {};
            for (const side of ["top", "right", "bottom", "left"] as const) {
              const size = sides[side];
              if (!size) continue;
              if (Math.round(size.value) !== Math.round(rect[kind][side]) || sent.has(side)) {
                sent.add(side);
                declarations[`${kind}-${side}`] = `${Math.round(size.value)}${size.unit}`;
              }
            }
            sentSides.current.set(group, sent);
            if (Object.keys(declarations).length) queueStyle(target, declarations, group);
          } else if (write.path[0] === "props" && write.path[1] === "minHeight") {
            const size = write.value as { value: number; unit: string };
            queueStyle(target, { "min-height": `${Math.round(size.value)}${size.unit}` }, group);
          }
        }
      },
      onCancel: (group) => {
        const entry = styleQueue.current.get(group);
        if (entry) window.clearTimeout(entry.timer);
        styleQueue.current.delete(group);
        sentSides.current.delete(group);
      },
    }),
    [targetOf, rectsOf, queueStyle],
  );

  // --- structure ----------------------------------------------------------------------------------------------
  const deleteElement = useCallback(
    async (id: string) => {
      const target = targetOf(id);
      if (!target) return;
      const node = resolvedRef.current.get(id);
      if (node && !node.structure.editable) return toast.show(node.structure.reason?.message ?? "This element cannot be deleted.", "danger");
      const parentId = rectsOf().get(id)?.parentId ?? null;
      if (await run({ op: "delete", target })) select(parentId);
    },
    [targetOf, rectsOf, run, select, toast],
  );
  const duplicateElement = useCallback(
    async (id: string) => {
      const target = targetOf(id);
      if (!target) return;
      const node = resolvedRef.current.get(id);
      if (node && !node.structure.editable) return toast.show(node.structure.reason?.message ?? "This element cannot be duplicated.", "danger");
      await run({ op: "duplicate", target });
    },
    [targetOf, run, toast],
  );
  const selectParent = useCallback(
    (id: string) => {
      const parentId = rectsOf().get(id)?.parentId;
      if (parentId) select(parentId, { scroll: true });
    },
    [rectsOf, select],
  );

  /** Click on a tile: after the selected element, or inside it when it is an empty box. */
  const insertFromPanel = useCallback(
    async (kind: InsertKind) => {
      const id = selectedRef.current;
      if (!id) return toast.show("Select an element first, or drag the tile onto the page.", "info");
      const rects = rectsOf();
      const rect = rects.get(id);
      const node = resolvedRef.current.get(id) ?? (await resolve(id));
      if (!rect || !node) return toast.show("Still reading the code behind the selected element. Try again in a moment.", "info");
      const inside = node.structure.canReceiveChildren && (rect.empty || rect.type === "container");
      if (inside) {
        const count = geometry.get().elements.filter((element) => element.parentId === id).length;
        await run({ op: "insert", parent: node.ref, index: count, kind });
        return;
      }
      const parentInfo = rect.parentId ? nodesRef.current[rect.parentId] : undefined;
      if (!parentInfo) return toast.show("Not here: the selected element has no parent the engine can write into.", "danger");
      await run({
        op: "insert",
        parent: refOf(parentInfo),
        index: node.structure.index + 1,
        kind,
      });
    },
    [rectsOf, resolve, geometry, run, toast],
  );

  // --- drag and drop ---------------------------------------------------------------------------------------------
  const locate = useCallback(
    (x: number, y: number, source: EngineDragSource): { target: EngineDropTarget | null; refusal: string | null } => {
      const elements = geometry.get().elements;
      const rects = new Map(elements.map((element) => [element.id, element]));
      const movingId = source.kind === "move" ? source.id : undefined;
      const target = findDropTarget({
        elements,
        x,
        y,
        movingId,
        resolved,
        requestResolve: (id) => void resolve(id),
      });
      if (!target) return { target: null, refusal: null };
      if (movingId) {
        const check = api.checkMove({
          target: resolvedRef.current.get(movingId) ?? null,
          parent: resolvedRef.current.get(target.parentId) ?? null,
          targetId: movingId,
          parentId: target.parentId,
          parentChain: (id) => ancestorChain(rects, id),
        });
        if (!check.ok) return { target: null, refusal: check.message };
      }
      return { target, refusal: null };
    },
    [geometry, resolved, resolve, api],
  );
  const onDrop = useCallback(
    (source: EngineDragSource, target: EngineDropTarget) => {
      const parentInfo = nodesRef.current[target.parentId];
      const parent = resolvedRef.current.get(target.parentId)?.ref ?? (parentInfo ? refOf(parentInfo) : null);
      if (!parent) return;
      if (source.kind === "new")
        void run({
          op: "insert",
          parent,
          index: target.index,
          kind: source.insert,
        });
      else {
        const moving = targetOf(source.id);
        if (moving) void run({ op: "move", target: moving, parent, index: target.index });
      }
    },
    [run, targetOf],
  );
  const { drag, beginDrag, relocate } = useEngineDrag({
    sheetRef,
    scale,
    locate,
    onDrop,
    onScroll: (deltaY) => send({ type: "armature:scroll", deltaY }),
  });
  useEffect(() => {
    relocateRef.current = relocate;
  }, [relocate]);
  const beginMove = useCallback(
    (event: React.PointerEvent, id: string) => {
      const rects = rectsOf();
      const rect = rects.get(id);
      // The likely drop targets are the element's own ancestors: resolve them before the pointer gets there.
      for (const ancestorId of ancestorChain(rects, id)) void resolve(ancestorId);
      beginDrag(event, {
        kind: "move",
        id,
        label: labelFor(resolvedRef.current.get(id), rect, nodesRef.current[id]),
      });
    },
    [rectsOf, resolve, beginDrag],
  );

  // --- messages from the bridge ---------------------------------------------------------------------------------
  // Installed after every render so the handler always sees the latest state and callbacks.
  useEffect(() => {
    messageRef.current = (message) => {
      switch (message.type) {
        case "armature:elements:map":
          geometry.patch({
            elements: message.elements,
            viewport: message.viewport,
          });
          break;
        case "armature:viewport":
          geometry.patch({ viewport: message.viewport });
          break;
        case "armature:element:hover":
          geometry.patch({ hoverElement: message.id });
          break;
        case "armature:engine:nodes": {
          setNodes(message.nodes);
          nodesRef.current = message.nodes;
          const wanted = pendingSelect.current;
          if (wanted) {
            const id = idForLoc(message.nodes, wanted);
            if (id) {
              pendingSelect.current = null;
              select(id);
            }
          }
          break;
        }
        case "armature:engine:computed":
          if (message.id) setComputed({ id: message.id, computed: message.computed });
          break;
        case "armature:element:select": {
          if (message.source === "canvas") {
            if (message.id) select(message.id, { fromCanvas: true });
            else select(null, { fromCanvas: true });
          } else if (message.source === "refresh" && message.id === null && selectedRef.current && !pendingSelect.current) {
            // The preview reloaded and the selected DOM node was replaced: ask for the same id once.
            if (!reselecting.current) {
              reselecting.current = true;
              send({
                type: "armature:element:select",
                id: selectedRef.current,
              });
            }
          } else if (message.source === "editor" && message.id === null && reselecting.current) {
            reselecting.current = false;
            select(null, { fromCanvas: true });
          } else if (message.source === "editor" && message.id) {
            reselecting.current = false;
          }
          break;
        }
        case "armature:element:edit:start":
          setEditing({ id: message.id, runs: message.value });
          break;
        case "armature:element:edit:input":
          setEditing({ id: message.id, runs: message.value });
          break;
        case "armature:element:edit:commit": {
          setEditing(null);
          setRichState(null);
          const target = targetOf(message.id);
          if (!target) break;
          const node = resolvedRef.current.get(message.id);
          const before = node?.text?.editable ? node.text.value : null;
          const text = runsToText(message.value);
          if (before !== null && before === text && !message.value.some((run) => run.bold || run.italic || run.href)) break;
          if (node?.text && node.text.editable && node.text.rich) void run({ op: "richText", target, runs: message.value });
          else void run({ op: "text", target, value: text });
          break;
        }
        case "armature:element:edit:cancel":
          setEditing(null);
          setRichState(null);
          break;
        case "armature:richtext:state":
          setRichState(message.state);
          break;
        case "armature:route:changed": {
          const route = normalizePath(message.route);
          setPagePath(route);
          setSearchParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.set("page", route);
              return next;
            },
            { replace: true },
          );
          select(null, { fromCanvas: true });
          break;
        }
        case "armature:navigate":
          if (!message.followed) showHint("Links do not open while editing. Ctrl/Cmd+click to follow one.");
          break;
        case "armature:error":
          toast.show(message.message, "danger");
          break;
        case "armature:key":
          // The engine bridge also sends "escape", which the kit's protocol does not list.
          switch (message.key as string) {
            case "undo":
              if (history.canUndo) void undo();
              break;
            case "redo":
              if (history.canRedo) void redo();
              break;
            case "delete":
              if (selectedRef.current) void deleteElement(selectedRef.current);
              break;
            case "duplicate":
              if (selectedRef.current) void duplicateElement(selectedRef.current);
              break;
            case "escape":
              select(null);
              break;
            case "up":
              if (selectedRef.current) selectParent(selectedRef.current);
              break;
            case "publish":
              setPublishOpen(true);
              break;
            case "help":
              setShortcutsOpen(true);
              break;
            default:
              break;
          }
          break;
        default:
          break;
      }
    };
  });

  // Keyboard shortcuts while the focus is in the editor itself (the bridge forwards the frame's).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey ? history.canRedo : history.canUndo) void (event.shiftKey ? redo() : undo());
      } else if (mod && key === "s") {
        event.preventDefault();
        setPublishOpen(true);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedRef.current && !drag) {
        event.preventDefault();
        void deleteElement(selectedRef.current);
      } else if (event.key === "Escape" && !publishOpen && !shortcutsOpen) {
        select(null);
      } else if (event.key === "?") {
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [history, undo, redo, deleteElement, select, drag, publishOpen, shortcutsOpen]);

  // Preview mode: the site's links work and nothing is selected.
  useEffect(() => {
    if (bridge.connection.status !== "ready") return;
    send({ type: "armature:mode", mode: preview ? "preview" : "edit" });
  }, [preview, send, bridge.connection.status]);
  const togglePreview = useCallback(
    (next: boolean) => {
      setPreview(next);
      if (next) select(null);
    },
    [select],
  );

  // The top bar is reused from the builder; the engine's tests find its buttons by these ids.
  useLayoutEffect(() => {
    const root = topBarRef.current;
    if (!root) return;
    const tag = (selector: string, id: string) => root.querySelector(selector)?.setAttribute("data-testid", id);
    tag('button[aria-label="Undo"]', "engine-undo");
    tag('button[aria-label="Redo"]', "engine-redo");
    tag('button[aria-label^="Desktop view"]', "engine-device-desktop");
    tag('button[aria-label^="Tablet view"]', "engine-device-tablet");
    tag('button[aria-label^="Phone view"]', "engine-device-phone");
    tag('button[title^="Publish ("]', "engine-publish");
  });

  // --- derived --------------------------------------------------------------------------------------------------
  const pages = useMemo<PageDefinition[]>(
    () =>
      info.pages
        .filter((page) => !page.private)
        .map((page) => ({
          slug: page.path,
          label: page.label,
          path: page.path,
          sections: [],
        })),
    [info.pages],
  );
  const page = useMemo(
    () =>
      pages.find((item) => normalizePath(item.path) === normalizePath(pagePath)) ?? {
        slug: pagePath,
        label: pagePath === "/" ? "Home" : pagePath,
        path: pagePath,
        sections: [],
      },
    [pages, pagePath],
  );
  const goToPage = useCallback(
    (path: string) => {
      const next = normalizePath(path);
      setPagePath(next);
      setSearchParams((current) => {
        const params = new URLSearchParams(current);
        params.set("page", next);
        return params;
      });
      select(null, { fromCanvas: true });
      setComputed(null);
      geometry.reset();
      load(next);
    },
    [setSearchParams, select, geometry, load],
  );

  const rects = rectsOf();
  const resolvedNow = (id: string) => resolveState.nodes.get(id);
  const nameOf = (id: string) => labelFor(resolvedNow(id), rects.get(id), nodes[id]);
  const selectedRect = selectedId ? rects.get(selectedId) : undefined;
  const selectedNode = selectedId ? (resolvedNow(selectedId) ?? null) : null;
  const selectedInfo = selectedId ? nodes[selectedId] : undefined;
  const selectedLabel = selectedId ? nameOf(selectedId) : null;
  const chain = selectedId ? ancestorChain(rects, selectedId).map((id) => ({ id, label: nameOf(id) })) : [];
  const connecting = bridge.connection.status !== "ready" && bridge.connection.status !== "error";
  const viewPageHref = `${previewUrl.replace(/\/+$/, "")}${pagePath}`;
  const tailwind = bridge.tailwind;
  const deviceName = device === "phone" ? "Phone" : device === "tablet" ? "Tablet" : "Desktop";
  const inspectorActions = useMemo(
    () => ({
      onSelect: (id: string) => select(id, { scroll: true }),
      onBackToElements: () => setPanelMode("elements"),
      onApply: (op: EditOp) => void run(op),
      onStyle: queueStyle,
      onEditOnPage: (id: string) => send({ type: "armature:element:edit:start", id }),
    }),
    [select, run, queueStyle, send],
  );
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ground text-text" data-testid="engine-editor" data-connecting={connecting ? "yes" : undefined} data-busy={busy ? "yes" : undefined}>
      <div ref={topBarRef}>
        <TopBar
          siteName={site.name}
          siteId={siteId}
          isStaff={isStaff}
          agency={agency}
          userName={userName}
          pages={pages}
          page={page}
          changedByPage={{}}
          onPage={goToPage}
          device={device}
          onDevice={setDevice}
          deviceWidths={deviceWidths}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={() => void undo()}
          onRedo={() => void redo()}
          status={{ kind: busy ? "saving" : "saved", changes: changedCount }}
          preview={preview}
          onPreview={togglePreview}
          canPublish={changedCount > 0 && !busy}
          onPublish={() => setPublishOpen(true)}
          builder={{
            onHistory: () => undefined,
            historyOpen: false,
            onOpenElements: () => {
              setPanelMode("elements");
              if (collapsed) togglePanel(false);
            },
            onPageSettings: () => undefined,
            pageSettingsOpen: false,
            onShortcuts: () => setShortcutsOpen(true),
            onSaveDraft: () => undefined,
            viewPageHref,
            allPagesHref: `/sites/${siteId}/pages`,
          }}
        />
      </div>
      <div className="flex h-9 shrink-0 items-center gap-4 border-b border-line bg-panel px-4 text-[12px] text-muted" data-testid="engine-status" data-phase="ready" data-changes={changedCount} data-page={pagePath} data-device={device}>
        <span className="font-semibold text-text">Code engine</span>
        <span className="truncate font-mono text-[11px]">
          {site.repo_owner}/{site.repo_name}@{site.branch || "main"}
        </span>
        <label className="flex items-center gap-1.5">
          Page
          <select value={page.slug} onChange={(event) => goToPage(event.target.value)} className="h-7 rounded-sm border border-line bg-panel px-1.5 text-[12px] text-text" data-testid="engine-page-select">
            {pages.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.label} ({item.path})
              </option>
            ))}
            {!pages.some((item) => item.slug === page.slug) && <option value={page.slug}>{page.label}</option>}
          </select>
        </label>
        <span>{changedCount === 0 ? "No changed files" : changedCount === 1 ? "1 changed file" : `${changedCount} changed files`}</span>
        <span>Editing the {deviceName} view</span>
        {tailwind === false && <span>Plain CSS: styles go into {info.stylesheet ?? "the site's stylesheet"}</span>}
        {history.undoLabel && <span className="ml-auto truncate">Last: {history.undoLabel}</span>}
      </div>
      <div className="flex min-h-0 flex-1">
        <BuilderPanel collapsed={collapsed} onToggle={togglePanel}>
          {panelMode === "edit" && selectedId ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
              <EngineInspector
                key={selectedId}
                id={selectedId}
                rect={selectedRect}
                info={selectedInfo}
                node={selectedNode}
                resolving={resolveState.pending.has(selectedId)}
                resolveError={resolveState.errors.get(selectedId) ?? null}
                label={selectedLabel ?? "Element"}
                chain={chain}
                computed={computed && computed.id === selectedId ? computed.computed : null}
                device={device}
                onDevice={setDevice}
                tailwind={tailwind}
                previewUrl={previewUrl}
                siteId={siteId}
                kit={kit}
                isStaff={isStaff}
                actions={inspectorActions}
              />
            </div>
          ) : (
            <EngineElementsPanel selectionLabel={selectedLabel} onInsert={(kind) => void insertFromPanel(kind)} onBeginDrag={beginDrag} />
          )}
        </BuilderPanel>
        <div className="relative flex min-w-0 flex-1">
          <Canvas
            iframeRef={bridge.iframeRef}
            src={bridge.src}
            attempt={bridge.attempt}
            onLoad={bridge.beginHandshake}
            connection={bridge.connection}
            onRetry={() => load(pagePath)}
            deviceWidth={deviceWidths[device]}
            store={geometry}
            schema={EMPTY_SCHEMA}
            selectedPath={null}
            changed={NO_CHANGES}
            editing={false}
            preview={preview}
            actions={NOOP_ACTIONS}
            onSelectImage={() => undefined}
            onDropImage={() => undefined}
            formEditorHref={`/sites/${siteId}/pages`}
            siteName={site.name}
            hint={hint}
            sheetRef={sheetRef}
            dragging={drag !== null}
            elementOverlays={
              <EngineOverlays
                store={geometry}
                scale={scale}
                nodes={nodes}
                resolved={resolvedNow}
                selectedId={selectedId}
                device={modelDevice(device)}
                editing={editing !== null}
                drag={drag}
                handleActions={handleActions}
                richText={{
                  state: richState,
                  onCommand: (command: RichTextCommand, value?: string) => send({ type: "armature:richtext:command", command, value }),
                  onDone: () => send({ type: "armature:element:edit:stop", commit: true }),
                }}
                actions={{
                  onSelect: (id) => select(id),
                  onEdit: (id) => send({ type: "armature:element:edit:start", id }),
                  onDuplicate: (id) => void duplicateElement(id),
                  onDelete: (id) => void deleteElement(id),
                  onAddInside: (id) => {
                    select(id);
                    setPanelMode("elements");
                    if (collapsed) togglePanel(false);
                  },
                  onBeginMove: beginMove,
                  onSelectParent: selectParent,
                }}
              />
            }
          />
          {drag && (
            <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-control bg-ink px-3 py-1.5 text-[12px] font-semibold text-white shadow-dark" style={{ left: drag.clientX, top: drag.clientY - 12 }} data-testid="drag-ghost">
              {drag.source.kind === "new" ? insertLabel(drag.source.insert) : drag.source.label}
              {drag.target && (
                <span className="ml-2 font-medium text-white/70" data-testid="drop-label">
                  {drag.target.beside ? `${drag.target.beside.edge} ${nameOf(drag.target.beside.id)}` : `into ${nameOf(drag.target.parentId)}`}
                </span>
              )}
              {drag.overCanvas && !drag.target && <span className="ml-2 text-red-soft">{drag.refusal ? `Not here: ${drag.refusal}` : "Not here"}</span>}
            </div>
          )}
        </div>
      </div>
      <EnginePublishDialog open={publishOpen} onClose={() => setPublishOpen(false)} api={api} siteId={siteId} pageLabel={page.label} onPublished={() => void refreshChanges()} />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} builder />
    </div>
  );
}
