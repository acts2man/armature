/**
 * The visual editor workspace: one draft per site across every page (content fields,
 * pictures, layouts and the site kit), the bridge connection, selection, one command
 * system with undo/redo, autosave, publishing, shortcuts and the tour. Layout per
 * docs/1-visual-editor.html: top bar, icon rail, left panel, scaled canvas, inspector,
 * and the "Need something bigger?" bar.
 *
 * With a v1.1 bridge (protocol 1) this is the Stage 1 editor. With a v2 kit (protocol 2)
 * and an editing level that allows it, the page builder switches on: the Elements,
 * Navigator and History panels, element overlays, drag and drop, the context menu.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router";
import { BuilderPanel, type BuilderTab } from "@/builder/BuilderPanel.tsx";
import { pastedElement, readClipboard, writeClipboard } from "@/builder/clipboard.ts";
import { ContextMenu, type MenuItem } from "@/builder/ContextMenu.tsx";
import type { DropTarget } from "@/builder/dnd.ts";
import { ElementInspector } from "@/builder/ElementInspector.tsx";
import { ElementOverlays } from "@/builder/ElementOverlays.tsx";
import { ElementsPanel } from "@/builder/ElementsPanel.tsx";
import { apply, breakGroup, canRedo, canUndo, createHistory, jumpTo, redo, reset, undo, type Command, type EditorHistory, type EditorState } from "@/builder/history.ts";
import { HistoryPanel } from "@/builder/HistoryPanel.tsx";
import { Navigator } from "@/builder/Navigator.tsx";
import { draftChangeCount, draftKey, isEmptyEditorDraft, legacyDraftKey, parseEditorDraft, restoreEditorDraft, serializeEditorDraft, type StoredEditorDraft } from "@/builder/persistence.ts";
import {
  changedElementIds,
  changedPages,
  findElement,
  insertElement,
  isContainerType,
  moveElement,
  removeElement,
  seedLayout,
  setElementPath,
  setKit,
  setKitPath,
  setLayout,
  updateElement,
  type BuilderBaseline,
  type BuilderState,
} from "@/builder/store.ts";
import { SiteSettingsPanel } from "@/builder/SiteSettingsPanel.tsx";
import { StructurePicker } from "@/builder/StructurePicker.tsx";
import { withKitFont } from "@/builder/fonts.ts";
import { useDrag, type DragSource } from "@/builder/useDrag.ts";
import { createStructure, widgetLabel, type Structure } from "@/builder/widgets/registry.ts";
import { IconCopy, IconEraser, IconEye, IconEyeOff, IconLock, IconPaste, IconPencil, IconTemplate, IconTrash, IconTree, IconUnlock } from "@/components/icons.tsx";
import { siteQueryKey } from "@/components/SiteLayout.tsx";
import { Button, Modal, useToast } from "@/components/ui.tsx";
import { callFunction, type Failure } from "@/lib/functions.ts";
import { fileToBase64, prepareImage } from "@/lib/resizeImage.ts";
import type { Agency, Site } from "@/lib/types.ts";
import { defaultSiteKit, validateSiteKit, withFreshIds, type Element, type LayoutDoc, type RichDoc } from "@shared/builder/index.ts";
import type { ContentValue } from "@shared/contentFile.ts";
import type { ContentGetResponse, PublishBatchResponse } from "@shared/publishTypes.ts";
import type { PageDefinition, PageSection, SiteSchema } from "@shared/schema.ts";
import { fieldPath, fieldRoot, parseFieldPath, type BridgeToEditor, type FieldPath, type MappedField, type ShortcutKey } from "@shared/visualProtocol.ts";
import { Canvas } from "./Canvas.tsx";
import {
  addListItem,
  changedRoots,
  clearImage,
  currentText,
  currentValue,
  discardAll,
  draftForBridge,
  dropRoots,
  duplicateListItem,
  emptyDraft,
  emptyHistory,
  fieldMeta,
  moveListItem,
  removeListItem,
  revertField,
  setFieldValue,
  setImage,
  setLinkHref,
  setText,
  summarizeDraft,
  toPublishRequest,
  type Draft,
  type History as ContentHistory,
  type ImageDraft,
} from "./draftStore.ts";
import { createGeometryStore } from "./geometry.ts";
import { IconRail } from "./IconRail.tsx";
import { Inspector } from "./Inspector.tsx";
import { LeftPanel, PagesList, type LeftTab } from "./LeftPanel.tsx";
import { defaultPage, deviceWidthFor, editablePages, modKey, modelDevice, pageForRoute, tourSeen, type Device } from "./pages.ts";
import { PublishDialog, type PublishState } from "./PublishDialog.tsx";
import { RequestBar, RestorePrompt, ShortcutsSheet, Tour } from "./Sheets.tsx";
import { TopBar } from "./TopBar.tsx";
import { useBridge } from "./useBridge.ts";

const AUTOSAVE_MS = 300;
const HINT_MS = 2600;

/** Every field of the site as the bridge should show it: published values with the draft on top. */
function contentForBridge(schema: SiteSchema, baseline: ContentGetResponse["content"], draft: Draft): Record<FieldPath, ContentValue> {
  const out: Record<FieldPath, ContentValue> = {};
  for (const page of schema.pages) {
    for (const section of page.sections) {
      for (const field of section.fields) {
        const root = fieldPath(page.slug, section.key, field.key);
        const value = currentValue(draft, baseline, root);
        if (value !== undefined) out[root] = value;
      }
    }
  }
  return { ...out, ...draftForBridge(draft, baseline) };
}

const isTypingTarget = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element.isContentEditable;
};

/** Labels from a conflict ("Home → Hero → Headline") back to field roots. */
function rootsForLabels(schema: SiteSchema, labels: string[]): FieldPath[] {
  const roots: FieldPath[] = [];
  for (const label of labels) {
    const parts = label.split(" → ").map((part) => part.trim());
    const [pageLabel, sectionLabel, fieldLabel] = parts.length === 3 ? parts : [undefined, parts[0], parts[1]];
    for (const page of schema.pages) {
      if (pageLabel && page.label !== pageLabel) continue;
      for (const section of page.sections) {
        if (section.label !== sectionLabel) continue;
        for (const field of section.fields) {
          if (field.label === fieldLabel) roots.push(fieldPath(page.slug, section.key, field.key));
        }
      }
    }
  }
  return roots;
}

type Selection = { kind: "field"; path: FieldPath } | { kind: "element"; id: string; slug: string } | null;

const initialState = (baseline: BuilderBaseline): EditorState => ({ content: emptyDraft(), builder: { layouts: baseline.layouts, deletedPages: [], kit: baseline.kit } });

export function EditorWorkspace({
  site,
  isStaff,
  agency,
  userId,
  userName,
  content,
  refetchContent,
  initialSlug,
}: {
  site: Site;
  isStaff: boolean;
  agency: Agency | null;
  userId: string;
  userName: string;
  content: ContentGetResponse;
  refetchContent: () => Promise<unknown>;
  initialSlug: string | undefined;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const schema = content.schema;
  const published = content.content;
  const pages = useMemo(() => editablePages(schema), [schema]);
  const agencyName = agency?.portal_name?.trim() || agency?.name || "the agency";
  const formEditorHref = `/sites/${site.id}/pages`;
  const mod = modKey();

  // --- the baseline: what is published --------------------------------------------------------
  const baseline = useMemo<BuilderBaseline>(() => ({ layouts: content.layouts ?? {}, kit: content.siteKit ?? defaultSiteKit() }), [content.layouts, content.siteKit]);
  const editingLevel = content.editingLevel ?? "content";
  const canBuild = isStaff || editingLevel === "builder";

  // --- the draft: one history for every kind of change ------------------------------------------------
  const storageKey = draftKey(site.id, userId);
  const [pendingRestore, setPendingRestore] = useState<StoredEditorDraft | null>(() => {
    try {
      return parseEditorDraft(localStorage.getItem(storageKey)) ?? parseEditorDraft(localStorage.getItem(legacyDraftKey(site.id, userId)));
    } catch {
      return null;
    }
  });
  const [history, setHistory] = useState<EditorHistory>(() => createHistory(initialState(baseline)));
  const state = history.present;
  const draft = state.content;
  const run = useCallback((command: Command) => setHistory((current) => apply(current, command)), []);
  /** A Stage 1 change through the same command system. */
  const contentCommand = useCallback(
    (label: string, fn: (history: ContentHistory) => ContentHistory, group?: string) =>
      run({
        label,
        group,
        run: (current) => {
          const next = fn(emptyHistory(current.content)).present;
          return next === current.content ? null : { ...current, content: next };
        },
      }),
    [run],
  );

  // Coded pages without a layout are seeded from the sections their slot shows, outside the
  // history: the seed enters the state only when the person first edits that page.
  const [seeds, setSeeds] = useState<Record<string, LayoutDoc>>({});
  const builderView = useMemo<BuilderState>(() => {
    const layouts = { ...state.builder.layouts };
    for (const [slug, seed] of Object.entries(seeds)) if (!layouts[slug] && !state.builder.deletedPages.includes(slug)) layouts[slug] = seed;
    return { ...state.builder, layouts };
  }, [state.builder, seeds]);
  const builderRef = useRef(builderView);
  useLayoutEffect(() => {
    builderRef.current = builderView;
  }, [builderView]);
  const materialize = useCallback((builder: BuilderState, slug: string): BuilderState => (builder.layouts[slug] || !seeds[slug] ? builder : setLayout(builder, seeds[slug] as LayoutDoc)), [seeds]);
  /** A builder change: seeds the page if needed, then runs the command against the builder state. */
  const builderCommand = useCallback(
    (label: string, slug: string, fn: (builder: BuilderState) => BuilderState | null, group?: string) =>
      run({
        label,
        group,
        run: (current) => {
          const next = fn(materialize(current.builder, slug));
          return next ? { ...current, builder: next } : null;
        },
      }),
    [run, materialize],
  );

  const changed = useMemo(() => changedRoots(draft), [draft]);
  const count = useMemo(() => draftChangeCount(state, baseline), [state, baseline]);
  const dirty = count > 0;
  const layoutChanges = useMemo(() => changedPages(state.builder, baseline), [state.builder, baseline]);

  // Autosave to this browser, debounced. `savedState` is the last state written.
  const [savedState, setSavedState] = useState<EditorState | null>(null);
  useEffect(() => {
    if (pendingRestore) return;
    const timer = window.setTimeout(() => {
      try {
        if (isEmptyEditorDraft(state, baseline)) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, serializeEditorDraft(state, baseline));
        localStorage.removeItem(legacyDraftKey(site.id, userId));
      } catch {
        // storage full or unavailable: the draft still lives in memory
      }
      setSavedState(state);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [state, baseline, storageKey, pendingRestore, site.id, userId]);
  const saveState: "clean" | "saving" | "saved" = !dirty ? "clean" : savedState === state ? "saved" : "saving";

  // Fresh content (after a publish or a reload) may already carry some of the draft: rebase it.
  const [seen, setSeen] = useState({ commit: content.commitSha, baseline });
  if (seen.commit !== content.commitSha) {
    const stored = parseEditorDraft(serializeEditorDraft(state, seen.baseline));
    setSeen({ commit: content.commitSha, baseline });
    setHistory(reset(stored ? restoreEditorDraft(stored, baseline, published, schema) : initialState(baseline)));
    setSeeds({});
  }

  // --- page, device, mode, selection -----------------------------------------------------------------
  const [pageSlug, setPageSlug] = useState<string>(() => (initialSlug && schema.pages.some((page) => page.slug === initialSlug) ? initialSlug : (defaultPage(schema)?.slug ?? "")));
  const page = schema.pages.find((item) => item.slug === pageSlug);
  const [device, setDevice] = useState<Device>("desktop");
  const [preview, setPreview] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("layers");
  const [builderTab, setBuilderTab] = useState<BuilderTab>("navigator");
  const [selection, setSelection] = useState<Selection>(null);
  const selectedPath = selection?.kind === "field" ? selection.path : null;
  const selectedId = selection?.kind === "element" ? selection.id : null;
  const [editingPath, setEditingPath] = useState<FieldPath | null>(null);
  const [editingElement, setEditingElement] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [replaceRequest, setReplaceRequest] = useState(0);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [structureAt, setStructureAt] = useState<{ index: number } | null>(null);
  const geometry = useMemo(() => createGeometryStore(), []);
  const editStartValue = useRef<string | null>(null);
  const editStartElement = useRef<unknown>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    navigate(`/sites/${site.id}/visual/${pageSlug}`, { replace: true });
  }, [pageSlug, site.id, navigate]);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  // --- the bridge ------------------------------------------------------------------------------------
  const handleMessage = useRef<(message: BridgeToEditor) => void>(() => undefined);
  const bridge = useBridge({ liveUrl: site.live_url, siteId: site.id, handlers: { onMessage: (message) => handleMessage.current(message) } });
  const { send, connection } = bridge;
  const ready = connection.status === "ready";
  const protocol = connection.status === "ready" ? connection.protocol : null;
  const builder = protocol === 2 && canBuild;
  const sections = useMemo(() => (connection.status === "ready" ? connection.sections : []), [connection]);

  const loadedOnce = useRef(false);
  useEffect(() => {
    if (loadedOnce.current || !page) return;
    loadedOnce.current = true;
    bridge.load(page.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.path]);

  const bridgeContent = useMemo(() => contentForBridge(schema, published, draft), [schema, published, draft]);
  useEffect(() => {
    if (!ready) return;
    send({ type: "armature:draft:apply", fields: bridgeContent });
  }, [ready, bridgeContent, send]);
  useEffect(() => {
    if (!ready) return;
    send({ type: "armature:mode", mode: preview ? "preview" : "edit" });
  }, [ready, preview, send]);
  useEffect(() => {
    if (!ready) geometry.reset();
  }, [ready, geometry]);
  // Site contract v2: the kit renders the draft layouts and kit.
  const layoutsForBridge = useMemo(() => {
    const out: Record<string, LayoutDoc | null> = { ...builderView.layouts };
    for (const slug of builderView.deletedPages) out[slug] = null;
    return out;
  }, [builderView]);
  useEffect(() => {
    if (!ready || protocol !== 2) return;
    send({ type: "armature:layout:apply", layouts: layoutsForBridge, kit: builderView.kit });
  }, [ready, protocol, layoutsForBridge, builderView.kit, send]);

  const seedFromSlots = useCallback(
    (slots: { slug: string; defaults: string[] }[]) => {
      setSeeds((current) => {
        let next = current;
        for (const slot of slots) {
          if (builderRef.current.layouts[slot.slug] || current[slot.slug] || baseline.layouts[slot.slug]) continue;
          const target = schema.pages.find((item) => item.slug === slot.slug);
          next = { ...next, [slot.slug]: seedLayout(slot, target?.path ?? "/", userName) };
        }
        return next;
      });
    },
    [baseline.layouts, schema, userName],
  );
  useEffect(() => {
    if (connection.status === "ready" && connection.protocol === 2) seedFromSlots(connection.slots);
  }, [connection, seedFromSlots]);

  const select = useCallback(
    (next: Selection, scroll = true) => {
      setSelection(next);
      if (!ready) return;
      if (next?.kind === "field") {
        send({ type: "armature:select", path: next.path, scroll });
      } else if (next?.kind === "element") {
        send({ type: "armature:element:select", id: next.id, scroll });
      } else {
        send({ type: "armature:select", path: null, scroll: false });
        if (protocol === 2) send({ type: "armature:element:select", id: null, scroll: false });
      }
    },
    [ready, protocol, send],
  );
  const selectPath = useCallback((path: FieldPath | null, scroll = true) => select(path ? { kind: "field", path } : null, scroll), [select]);
  const selectElement = useCallback((id: string | null, scroll = true) => select(id ? { kind: "element", id, slug: pageSlug } : null, scroll), [select, pageSlug]);

  const goToPage = useCallback(
    (slug: string) => {
      const target = schema.pages.find((item) => item.slug === slug);
      if (!target) return;
      setPageSlug(slug);
      setSelection(null);
      if (ready) send({ type: "armature:navigate", path: target.path });
      else bridge.load(target.path);
    },
    [schema, ready, send, bridge],
  );

  // --- element commands ------------------------------------------------------------------------------
  /** Locked for the current person: clients cannot touch a locked element or anything inside one. */
  const lockedIn = useCallback(
    (builderState: BuilderState, id: string): boolean => {
      if (isStaff) return false;
      const entry = findElement(builderState, id, pageSlug);
      if (!entry) return false;
      return entry.element.locked === true || entry.ancestors.some((ancestor) => findElement(builderState, ancestor, pageSlug)?.element.locked);
    },
    [isStaff, pageSlug],
  );
  /** For event handlers: the latest state through the ref. */
  const isLockedForMe = useCallback((id: string): boolean => lockedIn(builderRef.current, id), [lockedIn]);

  const onModelDevice = useCallback((next: "desktop" | "tablet" | "mobile") => setDevice(next === "mobile" ? "phone" : next), []);

  const inspectorActions = useMemo(
    () => ({
      onSelect: (id: string) => selectElement(id),
      onSetPath: (id: string, path: string[], value: unknown, label: string, group?: string) => {
        // A locked element keeps its words editable; its place and design are the agency's.
        if (isLockedForMe(id) && (path[0] === "style" || path[0] === "advanced")) return;
        builderCommand(
          label,
          pageSlug,
          (current) => {
            const next = setElementPath(current, id, pageSlug, path, value);
            if (!next) return null;
            // A Google font chosen for an element joins the kit's font list, which the site loads.
            return path[path.length - 1] === "fontFamily" ? setKit(next, withKitFont(next.kit, value)) : next;
          },
          group,
        );
      },
      onEditOnPage: (id: string) => send({ type: "armature:element:edit:start", id }),
      onRename: (id: string, label: string) => builderCommand("Renamed element", pageSlug, (current) => setElementPath(current, id, pageSlug, ["label"], label || undefined), `rename:${id}`),
    }),
    [builderCommand, isLockedForMe, pageSlug, selectElement, send],
  );

  /** A change to the site kit (Site settings). An edit that would make the kit invalid is dropped. */
  const writeKit = useCallback(
    (path: readonly string[], value: unknown, label: string, group?: string) =>
      builderCommand(
        label,
        pageSlug,
        (current) => {
          let next = setKitPath(current, path, value);
          const last = path[path.length - 1];
          if (last === "fontFamily" || (path[0] === "fonts" && (last === "heading" || last === "body"))) next = setKit(next, withKitFont(next.kit, value));
          if (next === current) return null;
          return validateSiteKit(next.kit).errors.length === 0 ? next : null;
        },
        group ? `kit:${group}` : undefined,
      ),
    [builderCommand, pageSlug],
  );

  const insertAt = useCallback(
    (element: Element, target: { parentId: string | null; index: number }, label: string) => {
      builderCommand(`Added ${label}`, pageSlug, (current) => insertElement(current, element, { slug: pageSlug, ...target }, userName));
      setSelection({ kind: "element", id: element.id, slug: pageSlug });
      window.setTimeout(() => send({ type: "armature:element:select", id: element.id, scroll: true }), 120);
    },
    [builderCommand, pageSlug, send, userName],
  );

  /** Where a click-to-insert goes: inside the selected container, after the selected element, or at the end of the page. */
  const insertionPoint = useCallback((): { parentId: string | null; index: number } => {
    const current = builderRef.current;
    if (selectedId) {
      const entry = findElement(current, selectedId, pageSlug);
      if (entry) {
        if (isContainerType(entry.element.type) && !isLockedForMe(selectedId)) return { parentId: selectedId, index: entry.element.children?.length ?? 0 };
        if (!(entry.parentId && isLockedForMe(entry.parentId))) return { parentId: entry.parentId, index: entry.index + 1 };
      }
    }
    return { parentId: null, index: current.layouts[pageSlug]?.root.length ?? 0 };
  }, [selectedId, pageSlug, isLockedForMe]);

  const deleteElement = useCallback(
    (id: string) => {
      if (isLockedForMe(id)) return toast.show("That element is locked by the agency.", "info");
      const entry = findElement(builderRef.current, id, pageSlug);
      const label = entry ? widgetLabel(entry.element.type) : "element";
      builderCommand(`Deleted ${label}`, pageSlug, (current) => removeElement(current, id, pageSlug));
      setSelection((current) => (current?.kind === "element" && current.id === id ? null : current));
      toast.show(`${label} deleted. ${mod}+Z to undo.`, "info");
    },
    [builderCommand, isLockedForMe, pageSlug, toast, mod],
  );

  const duplicate = useCallback(
    (id: string) => {
      const entry = findElement(builderRef.current, id, pageSlug);
      if (!entry) return;
      if (entry.element.type === "site-section") {
        const key = String(entry.element.props["key"] ?? "");
        if (!sections.find((section) => section.key === key)?.repeatable) return toast.show("The site registers this section as one-of-a-kind, so it cannot be duplicated.", "info");
      }
      if (entry.parentId && isLockedForMe(entry.parentId)) return toast.show("That element sits inside a locked container.", "info");
      // The copy is made here, not inside the command, so its id is known before React runs the updater.
      const copy = withFreshIds(entry.element);
      builderCommand(`Duplicated ${widgetLabel(entry.element.type)}`, pageSlug, (current) => insertElement(current, copy, { slug: pageSlug, parentId: entry.parentId, index: entry.index + 1 }, userName));
      selectElement(copy.id);
    },
    [builderCommand, isLockedForMe, pageSlug, sections, selectElement, toast, userName],
  );

  const copyElement = useCallback(
    async (id: string) => {
      const entry = findElement(builderRef.current, id, pageSlug);
      if (!entry) return;
      await writeClipboard({ armature: "element", element: entry.element });
      toast.show(`${widgetLabel(entry.element.type)} copied.`, "info");
    },
    [pageSlug, toast],
  );

  const pasteElement = useCallback(async () => {
    const payload = await readClipboard();
    if (!payload || payload.armature !== "element") return toast.show("Nothing to paste. Copy an element first.", "info");
    const element = pastedElement(payload.element);
    insertAt(element, insertionPoint(), widgetLabel(element.type));
  }, [insertAt, insertionPoint, toast]);

  const pasteStyle = useCallback(async () => {
    if (!selectedId) return;
    const payload = await readClipboard();
    if (!payload) return toast.show("Nothing to paste.", "info");
    if (isLockedForMe(selectedId)) return toast.show("That element is locked by the agency.", "info");
    const source = payload.armature === "style" ? payload : { style: payload.element.style, advanced: payload.element.advanced };
    builderCommand("Pasted style", pageSlug, (current) => updateElement(current, selectedId, pageSlug, (element) => ({ ...element, style: source.style, advanced: { ...source.advanced, hidden: element.advanced.hidden, cssId: element.advanced.cssId } })));
  }, [builderCommand, isLockedForMe, pageSlug, selectedId, toast]);

  const resetStyle = useCallback(
    (id: string) => {
      if (isLockedForMe(id)) return toast.show("That element is locked by the agency.", "info");
      builderCommand("Reset style", pageSlug, (current) => updateElement(current, id, pageSlug, (element) => ({ ...element, style: {}, advanced: { hidden: element.advanced.hidden } })));
    },
    [builderCommand, isLockedForMe, pageSlug, toast],
  );

  const toggleHidden = useCallback(
    (id: string) => {
      const which = modelDevice(device);
      const entry = findElement(builderRef.current, id, pageSlug);
      const hidden = entry?.element.advanced.hidden?.[which] === true;
      builderCommand(`${hidden ? "Showed" : "Hid"} ${widgetLabel(entry?.element.type ?? "")} on ${which}`, pageSlug, (current) => setElementPath(current, id, pageSlug, ["advanced", "hidden", which], hidden ? undefined : true));
    },
    [builderCommand, device, pageSlug],
  );

  const toggleLock = useCallback(
    (id: string) => {
      const entry = findElement(builderRef.current, id, pageSlug);
      const locked = entry?.element.locked === true;
      builderCommand(`${locked ? "Unlocked" : "Locked"} ${widgetLabel(entry?.element.type ?? "")}`, pageSlug, (current) => setElementPath(current, id, pageSlug, ["locked"], locked ? undefined : true));
    },
    [builderCommand, pageSlug],
  );

  const moveTo = useCallback(
    (id: string, target: { parentId: string | null; index: number }) => {
      if (isLockedForMe(id)) return toast.show("That element is locked by the agency.", "info");
      const entry = findElement(builderRef.current, id, pageSlug);
      builderCommand(`Moved ${widgetLabel(entry?.element.type ?? "")}`, pageSlug, (current) => moveElement(current, id, pageSlug, { slug: pageSlug, ...target }, isStaff));
    },
    [builderCommand, isLockedForMe, isStaff, pageSlug, toast],
  );

  const addStructure = useCallback(
    (structure: Structure, index: number | null) => {
      const element = createStructure(structure);
      insertAt(element, index === null ? insertionPoint() : { parentId: null, index }, `${structure.label} section`);
    },
    [insertAt, insertionPoint],
  );

  // --- drag and drop ----------------------------------------------------------------------------------------
  const deviceWidths = useMemo(
    () => ({ desktop: deviceWidthFor("desktop", null), tablet: deviceWidthFor("tablet", protocol === 2 ? builderView.kit.breakpoints : null), phone: deviceWidthFor("phone", protocol === 2 ? builderView.kit.breakpoints : null) }),
    [protocol, builderView.kit.breakpoints],
  );
  const [sheetWidth, setSheetWidth] = useState(0);
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const measure = () => setSheetWidth(sheet.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [ready]);
  const scale = sheetWidth > 0 ? sheetWidth / deviceWidths[device] : 1;
  const { drag, beginDrag } = useDrag({
    sheetRef,
    scale,
    geometry,
    getState: () => builderRef.current,
    slug: pageSlug,
    allowLocked: isStaff,
    onScroll: (deltaY) => send({ type: "armature:scroll", deltaY }),
    onDrop: (source: DragSource, target: DropTarget) => {
      if (source.kind === "new") insertAt(source.create(), { parentId: target.parentId, index: target.index }, source.label);
      else moveTo(source.id, { parentId: target.parentId, index: target.index });
    },
  });

  // --- shortcuts -----------------------------------------------------------------------------------------------
  const [publishOpen, setPublishOpen] = useState(false);
  const shortcut = useCallback(
    (key: ShortcutKey) => {
      const siblingsOf = (id: string): { ids: string[]; index: number; parentId: string | null } | null => {
        const entry = findElement(builderRef.current, id, pageSlug);
        if (!entry) return null;
        const siblings = entry.parentId === null ? (builderRef.current.layouts[pageSlug]?.root ?? []) : (findElement(builderRef.current, entry.parentId, pageSlug)?.element.children ?? []);
        return { ids: siblings.map((element) => element.id), index: entry.index, parentId: entry.parentId };
      };
      switch (key) {
        case "undo":
          setHistory((current) => undo(current));
          return;
        case "redo":
          setHistory((current) => redo(current));
          return;
        case "publish":
          if (dirty && !preview) setPublishOpen(true);
          return;
        case "preview":
          setPreview((current) => !current);
          setSelection(null);
          return;
        case "help":
          setShortcutsOpen((current) => !current);
          return;
        case "next": {
          const fields = [...geometry.get().fields].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
          if (fields.length === 0) return;
          const index = fields.findIndex((field) => field.path === selectedPath);
          const next = fields[(index + 1) % fields.length];
          if (next) selectPath(next.path);
          return;
        }
        case "copy":
          if (selectedId) void copyElement(selectedId);
          return;
        case "paste":
          if (builder) void pasteElement();
          return;
        case "pasteStyle":
          if (builder) void pasteStyle();
          return;
        case "duplicate":
          if (selectedId && builder) duplicate(selectedId);
          return;
        case "delete":
          if (selectedId && builder) deleteElement(selectedId);
          return;
        case "up":
        case "down":
        case "left":
        case "right": {
          if (!selectedId) return;
          const around = siblingsOf(selectedId);
          if (!around) return;
          if (key === "left") {
            if (around.parentId) selectElement(around.parentId);
            return;
          }
          if (key === "right") {
            const first = findElement(builderRef.current, selectedId, pageSlug)?.element.children?.[0];
            if (first) selectElement(first.id);
            return;
          }
          const next = around.ids[around.index + (key === "up" ? -1 : 1)];
          if (next) selectElement(next);
          return;
        }
      }
    },
    [dirty, preview, geometry, selectedPath, selectPath, selectedId, builder, copyElement, pasteElement, pasteStyle, duplicate, deleteElement, selectElement, pageSlug],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);
      const lower = event.key.toLowerCase();
      if (meta && lower === "s") {
        event.preventDefault();
        shortcut("publish");
        return;
      }
      if (typing) return;
      if (meta && lower === "z") {
        event.preventDefault();
        shortcut(event.shiftKey ? "redo" : "undo");
      } else if (meta && lower === "y") {
        event.preventDefault();
        shortcut("redo");
      } else if (meta && lower === "p") {
        event.preventDefault();
        shortcut("preview");
      } else if (meta && lower === "c" && selectedId) {
        event.preventDefault();
        shortcut("copy");
      } else if (meta && lower === "v" && builder) {
        event.preventDefault();
        shortcut(event.shiftKey ? "pasteStyle" : "paste");
      } else if (meta && lower === "d" && selectedId) {
        event.preventDefault();
        shortcut("duplicate");
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !meta) {
        event.preventDefault();
        shortcut("delete");
      } else if (event.key.startsWith("Arrow") && selectedId && !meta) {
        event.preventDefault();
        shortcut(event.key.replace("Arrow", "").toLowerCase() as ShortcutKey);
      } else if (event.key === "?" && !meta) {
        event.preventDefault();
        shortcut("help");
      } else if (event.key === "Escape") {
        if (shortcutsOpen || publishOpen || menu || structureAt) return; // the sheets close themselves
        if (selection) select(null);
      } else if (event.key === "Tab" && !meta && !event.altKey && (event.target === document.body || (event.target as HTMLElement | null)?.dataset?.["testid"] === "canvas")) {
        event.preventDefault();
        shortcut("next");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut, selection, select, selectedId, builder, shortcutsOpen, publishOpen, menu, structureAt]);

  // --- messages from the bridge -------------------------------------------------------------------------------
  const onBridgeMessage = (message: BridgeToEditor) => {
    switch (message.type) {
      case "armature:ready": {
        const target = pageForRoute(schema, message.route);
        if (target && target.slug !== pageSlug) setPageSlug(target.slug);
        if (!tourSeen() && !pendingRestore) setTourOpen(true);
        return;
      }
      case "armature:fields:map":
        geometry.patch({ fields: message.fields, viewport: message.viewport });
        return;
      case "armature:elements:map":
        geometry.patch({ elements: message.elements, viewport: message.viewport });
        return;
      case "armature:viewport":
        geometry.patch({ viewport: message.viewport });
        return;
      case "armature:hover":
        geometry.patch({ hover: message.field });
        return;
      case "armature:element:hover":
        geometry.patch({ hoverElement: message.id });
        return;
      case "armature:select":
        geometry.patch({ selected: message.field });
        if (message.source === "canvas") {
          if (message.field) setSelection({ kind: "field", path: message.field.path });
          else if (selection?.kind === "field") setSelection(null);
          if (message.field?.kind === "link" && message.field.href) setHint(`Hold ${mod} and click to follow this link`);
        }
        return;
      case "armature:element:select":
        if (message.source === "canvas") {
          if (message.id) setSelection({ kind: "element", id: message.id, slug: pageSlug });
          else if (selection?.kind === "element") setSelection(null);
        }
        return;
      case "armature:element:contextmenu": {
        if (!builder) return;
        const box = sheetRef.current?.getBoundingClientRect();
        setSelection({ kind: "element", id: message.id, slug: pageSlug });
        setMenu({ id: message.id, x: (box?.left ?? 0) + message.x * scale, y: (box?.top ?? 0) + message.y * scale });
        return;
      }
      case "armature:slot":
        seedFromSlots(message.slots);
        return;
      case "armature:edit:start":
        setEditingPath(message.path);
        editStartValue.current = currentText(draft, published, message.path);
        return;
      case "armature:edit:input":
        contentCommand("Typed", (current) => setText(current, published, message.path, message.value), `typing:${message.path}`);
        return;
      case "armature:edit:commit":
        contentCommand("Edited text", (current) => setText(current, published, message.path, message.value), `typing:${message.path}`);
        setHistory((current) => breakGroup(current));
        setEditingPath(null);
        editStartValue.current = null;
        return;
      case "armature:edit:cancel": {
        const original = editStartValue.current;
        if (original !== null) contentCommand("Cancelled typing", (current) => setText(current, published, message.path, original), `typing:${message.path}`);
        setHistory((current) => breakGroup(current));
        setEditingPath(null);
        editStartValue.current = null;
        return;
      }
      case "armature:element:edit:start":
        setEditingElement(message.id);
        editStartElement.current = message.value;
        return;
      case "armature:element:edit:input":
      case "armature:element:edit:commit": {
        const entry = findElement(builderRef.current, message.id, pageSlug);
        if (entry) {
          const path = entry.element.type === "text" ? ["props", "doc"] : ["props", "text"];
          const value = entry.element.type === "text" ? (message.value as RichDoc) : String(message.value);
          builderCommand(`Edited ${widgetLabel(entry.element.type)} text`, pageSlug, (current) => setElementPath(current, message.id, pageSlug, path, value), `typing:${message.id}`);
        }
        if (message.type === "armature:element:edit:commit") {
          setHistory((current) => breakGroup(current));
          setEditingElement(null);
        }
        return;
      }
      case "armature:element:edit:cancel": {
        const entry = findElement(builderRef.current, message.id, pageSlug);
        const original = editStartElement.current;
        if (entry && original !== null) {
          const path = entry.element.type === "text" ? ["props", "doc"] : ["props", "text"];
          builderCommand("Cancelled typing", pageSlug, (current) => setElementPath(current, message.id, pageSlug, path, original), `typing:${message.id}`);
        }
        setHistory((current) => breakGroup(current));
        setEditingElement(null);
        return;
      }
      case "armature:route:changed": {
        const target = pageForRoute(schema, message.route);
        if (target && target.slug !== pageSlug) {
          setPageSlug(target.slug);
          setSelection(null);
        }
        return;
      }
      case "armature:navigate":
        if (!message.followed) setHint(message.external ? "External links open outside the editor" : `Hold ${mod} and click to follow this link`);
        else if (message.external) setHint("External links open outside the editor");
        return;
      case "armature:key":
        shortcut(message.key);
        return;
      case "armature:error":
        toast.show(message.message, "danger");
        return;
      default:
        return;
    }
  };
  useEffect(() => {
    handleMessage.current = onBridgeMessage;
  });

  // --- images ---------------------------------------------------------------------------------------------------
  const attachImage = useCallback(
    async (path: FieldPath, file: File) => {
      try {
        const prepared = await prepareImage(file);
        URL.revokeObjectURL(prepared.previewUrl);
        const base64 = await fileToBase64(prepared.file);
        const image: ImageDraft = { name: prepared.file.name, type: prepared.file.type, width: prepared.width, height: prepared.height, bytes: prepared.bytes, dataUrl: `data:${prepared.file.type};base64,${base64}` };
        contentCommand("Replaced picture", (current) => setImage(current, path, image));
        setSelection({ kind: "field", path });
      } catch (error) {
        toast.show(error instanceof Error ? error.message : String(error), "danger");
      }
    },
    [contentCommand, toast],
  );

  // --- publishing -------------------------------------------------------------------------------------------------
  const [publishState, setPublishState] = useState<PublishState>({ step: "summary" });
  const summary = useMemo(() => summarizeDraft(draft, schema), [draft, schema]);
  const publish = useMutation({
    mutationFn: async (): Promise<PublishBatchResponse | Failure> => {
      setPublishState({ step: "publishing", stage: "Checking your changes against the site's rules…" });
      const request = toPublishRequest(draft, schema, site.id, content.commitSha);
      window.setTimeout(() => setPublishState((current) => (current.step === "publishing" ? { step: "publishing", stage: "Committing to the site's repository…" } : current)), 900);
      return callFunction<PublishBatchResponse>("content-publish-batch", request);
    },
    onSuccess: async (result) => {
      if (result.ok) {
        const publishedCount = changed.size;
        setHistory((current) => reset({ ...current.present, content: emptyDraft() }));
        setPublishState({ step: "done", commitSha: result.commitSha, commitUrl: result.commitUrl, count: publishedCount });
        await refetchContent();
        void queryClient.invalidateQueries({ queryKey: ["publishes"] });
        void queryClient.invalidateQueries({ queryKey: ["site-publishes"] });
        void queryClient.invalidateQueries({ queryKey: siteQueryKey(site.id) });
        return;
      }
      setPublishState(result.code === "conflict" ? { step: "conflict", failure: result } : { step: "failed", failure: result });
    },
    onError: (error: Error) => setPublishState({ step: "failed", failure: { ok: false, code: "github_error", message: error.message } }),
  });

  const openPublish = () => {
    setPublishState({ step: "summary" });
    setPublishOpen(true);
  };

  // --- leaving ------------------------------------------------------------------------------------------------------
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !nextLocation.pathname.startsWith(`/sites/${site.id}/visual`) && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // --- request a change ---------------------------------------------------------------------------------------------
  const requestChange = (path: FieldPath | "", text = "") => {
    const meta = path ? fieldMeta(schema, path) : null;
    const element = selectedId ? findElement(builderView, selectedId, pageSlug)?.element : undefined;
    const where = meta ? `${meta.page.label} page, ${meta.section.label} section, "${meta.label}"` : element ? `${page?.label ?? ""} page, ${element.label || widgetLabel(element.type)} element (${element.id})` : page ? `${page.label} page` : site.name;
    const params = new URLSearchParams();
    params.set("title", text ? text.slice(0, 120) : meta ? `Change to ${meta.label} on the ${meta.page.label} page` : element ? `Change to the ${element.label || widgetLabel(element.type)} on the ${page?.label ?? ""} page` : `Change to the ${page?.label ?? ""} page`.trim());
    params.set("details", `${text ? `${text}\n\n` : ""}Where: ${where}${path ? ` (${path})` : ""}\nCurrent text: ${path ? currentText(draft, published, path).slice(0, 300) : ""}`.trim());
    navigate(`/sites/${site.id}/requests/new?${params.toString()}`);
  };

  // --- derived ---------------------------------------------------------------------------------------------------------
  const changedByPage = useMemo(() => {
    const out: Record<string, number> = {};
    for (const root of changed) {
      const slug = parseFieldPath(root)?.slug;
      if (slug) out[slug] = (out[slug] ?? 0) + 1;
    }
    for (const change of layoutChanges) out[change.slug] = (out[change.slug] ?? 0) + 1;
    return out;
  }, [changed, layoutChanges]);
  const [canvasRoots, setCanvasRoots] = useState<Set<FieldPath>>(() => new Set());
  const [canvasFields, setCanvasFields] = useState<MappedField[]>([]);
  useEffect(() => {
    return geometry.subscribe(() => {
      const fields = geometry.get().fields;
      const roots = new Set<FieldPath>();
      for (const field of fields) roots.add(fieldRoot(field.path));
      setCanvasRoots((current) => (current.size === roots.size && [...roots].every((root) => current.has(root)) ? current : roots));
      setCanvasFields((current) => (current.length === fields.length && current.every((field, index) => field.path === fields[index]?.path && field.owner === fields[index]?.owner) ? current : fields));
    });
  }, [geometry]);
  const selectedOnCanvas = selectedPath !== null && canvasRoots.has(fieldRoot(selectedPath));
  const currentLayout = builderView.layouts[pageSlug];
  const changedIds = useMemo(() => changedElementIds(builderView.layouts[pageSlug], baseline.layouts[pageSlug]), [builderView.layouts, baseline.layouts, pageSlug]);
  const sectionsInUse = useMemo(() => new Set((currentLayout?.root ?? []).flatMap((element) => (element.type === "site-section" ? [String(element.props["key"])] : []))), [currentLayout]);
  const sharedPage = schema.pages.find((item) => item.slug === "shared" && item.slug !== page?.slug);
  const fieldLabel = (path: FieldPath): string => fieldMeta(schema, path)?.label ?? path;

  // --- the context menu -------------------------------------------------------------------------------------------------
  const menuItems = (id: string): MenuItem[] => {
    const entry = findElement(builderView, id, pageSlug);
    const locked = lockedIn(builderView, id);
    const which = modelDevice(device);
    const hidden = entry?.element.advanced.hidden?.[which] === true;
    const editable = entry && (entry.element.type === "heading" || entry.element.type === "text" || entry.element.type === "button");
    return [
      { key: "edit", label: "Edit", icon: <IconPencil size={14} />, disabled: !editable || locked, onSelect: () => send({ type: "armature:element:edit:start", id }) },
      { key: "duplicate", label: "Duplicate", icon: <IconCopy size={14} />, shortcut: `${mod}+D`, disabled: locked, onSelect: () => duplicate(id) },
      { key: "copy", label: "Copy", icon: <IconCopy size={14} />, shortcut: `${mod}+C`, onSelect: () => void copyElement(id) },
      { key: "paste", label: "Paste", icon: <IconPaste size={14} />, shortcut: `${mod}+V`, onSelect: () => void pasteElement() },
      { key: "paste-style", label: "Paste style", icon: <IconPaste size={14} />, shortcut: `${mod}+Shift+V`, disabled: locked, onSelect: () => void pasteStyle() },
      { key: "reset-style", label: "Reset style", icon: <IconEraser size={14} />, disabled: locked, onSelect: () => resetStyle(id) },
      { key: "s1", separator: true },
      { key: "template", label: "Save as template", icon: <IconTemplate size={14} />, disabled: true, onSelect: () => undefined },
      { key: "navigator", label: "Show in Navigator", icon: <IconTree size={14} />, onSelect: () => setBuilderTab("navigator") },
      ...(isStaff ? [{ key: "lock", label: entry?.element.locked ? "Unlock for clients" : "Lock for clients", icon: entry?.element.locked ? <IconUnlock size={14} /> : <IconLock size={14} />, onSelect: () => toggleLock(id) } satisfies MenuItem] : []),
      { key: "hide", label: hidden ? `Show on ${which}` : `Hide on ${which}`, icon: hidden ? <IconEye size={14} /> : <IconEyeOff size={14} />, disabled: locked, onSelect: () => toggleHidden(id) },
      { key: "s2", separator: true },
      { key: "delete", label: "Delete", icon: <IconTrash size={14} />, shortcut: "Delete", danger: true, disabled: locked, onSelect: () => deleteElement(id) },
    ];
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ground text-text" data-testid="visual-editor" data-protocol={protocol ?? undefined} data-builder={builder ? "on" : undefined}>
      <TopBar
        siteName={site.name}
        siteId={site.id}
        isStaff={isStaff}
        agency={agency}
        userName={userName}
        pages={pages}
        page={page}
        changedByPage={changedByPage}
        onPage={goToPage}
        device={device}
        onDevice={setDevice}
        deviceWidths={deviceWidths}
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        onUndo={() => setHistory((current) => undo(current))}
        onRedo={() => setHistory((current) => redo(current))}
        status={{ kind: saveState, changes: count }}
        preview={preview}
        onPreview={(next) => {
          setPreview(next);
          if (next) select(null);
        }}
        canPublish={dirty && !publish.isPending}
        onPublish={openPublish}
        builder={builder ? { onHistory: () => setBuilderTab((current) => (current === "history" ? "navigator" : "history")), onNavigator: () => setBuilderTab("navigator"), historyOpen: builderTab === "history", navigatorOpen: builderTab === "navigator" } : undefined}
      />
      <div className="flex min-h-0 flex-1">
        <IconRail siteId={site.id} isStaff={isStaff} />
        {builder ? (
          <BuilderPanel tab={builderTab} tabs={["elements", "navigator", "pages", "site"]} onTab={setBuilderTab}>
            {builderTab === "elements" && (
              <ElementsPanel
                isStaff={isStaff}
                sections={sections}
                sectionsInUse={sectionsInUse}
                onBeginDrag={beginDrag}
                onInsert={(element, label) => insertAt(element, insertionPoint(), label)}
                onStructure={() => setStructureAt({ index: -1 })}
              />
            )}
            {builderTab === "navigator" && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <Navigator
                  layout={currentLayout}
                  page={page}
                  sharedPage={sharedPage}
                  fields={canvasFields}
                  changedIds={changedIds}
                  changedFields={changed}
                  selectedId={selectedId}
                  selectedPath={selectedPath}
                  device={modelDevice(device)}
                  isStaff={isStaff}
                  fieldLabel={fieldLabel}
                  onSelect={(id) => selectElement(id)}
                  onSelectField={(path) => selectPath(path)}
                  onRename={(id, label) => builderCommand("Renamed element", pageSlug, (current) => setElementPath(current, id, pageSlug, ["label"], label || undefined))}
                  onToggleHidden={toggleHidden}
                  onToggleLock={toggleLock}
                  onMove={(id, drop) => moveTo(id, drop)}
                />
                <OffPageFields page={page} sharedPage={sharedPage} canvasFields={canvasFields} connected={ready} changed={changed} selectedPath={selectedPath} onSelect={(path) => selectPath(path)} />
              </div>
            )}
            {builderTab === "pages" && (
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                <PagesList pages={pages} page={page} changedByPage={changedByPage} onPage={goToPage} shared={sharedPage} />
              </div>
            )}
            {builderTab === "history" && <HistoryPanel history={history} onJump={(steps) => setHistory((current) => jumpTo(current, steps))} />}
            {builderTab === "site" && <SiteSettingsPanel kit={builderView.kit} write={writeKit} device={modelDevice(device)} onDevice={onModelDevice} isStaff={isStaff} />}
          </BuilderPanel>
        ) : (
          <LeftPanel
            tab={leftTab}
            onTab={setLeftTab}
            schema={schema}
            page={page}
            pages={pages}
            changed={changed}
            changedByPage={changedByPage}
            onCanvas={canvasRoots}
            connected={ready}
            selectedPath={selectedPath}
            onSelectField={(path) => {
              if (preview) setPreview(false);
              selectPath(path);
            }}
            onPage={goToPage}
          />
        )}
        <div className="relative flex min-w-0 flex-1">
          <Canvas
            iframeRef={bridge.iframeRef}
            src={bridge.src}
            attempt={bridge.attempt}
            onLoad={bridge.beginHandshake}
            connection={connection}
            onRetry={() => page && bridge.load(page.path)}
            deviceWidth={deviceWidths[device]}
            store={geometry}
            schema={schema}
            selectedPath={selectedPath}
            changed={changed}
            editing={editingPath !== null}
            preview={preview}
            actions={{
              onEditInline: (path) => {
                const field = geometry.get().selected;
                if (field?.inline) send({ type: "armature:edit:start", path });
                else document.getElementById("inspector-text")?.focus();
              },
              onReplaceImage: (path) => {
                setSelection({ kind: "field", path });
                setReplaceRequest((current) => current + 1);
              },
              onEditLink: () => document.getElementById("inspector-link-href")?.focus() ?? document.getElementById("inspector-url")?.focus(),
              onRevert: (root) => contentCommand("Reverted to published", (current) => revertField(current, root)),
              onRequestChange: (path) => requestChange(path),
            }}
            onSelectImage={(path) => selectPath(path, false)}
            onDropImage={(path, file) => void attachImage(path, file)}
            formEditorHref={formEditorHref}
            siteName={site.name}
            hint={hint}
            olderKit={isStaff && protocol === 1}
            sheetRef={sheetRef}
            dragging={drag !== null}
            elementOverlays={
              builder ? (
                <ElementOverlays
                  store={geometry}
                  scale={scale}
                  state={builderView}
                  slug={pageSlug}
                  selectedId={selectedId}
                  device={modelDevice(device)}
                  isStaff={isStaff}
                  canEdit={builder}
                  editing={editingElement !== null}
                  drag={drag}
                  changedIds={changedIds}
                  actions={{
                    onSelect: (id) => selectElement(id, false),
                    onEdit: (id) => send({ type: "armature:element:edit:start", id }),
                    onDuplicate: duplicate,
                    onDelete: deleteElement,
                    onAddInside: (id) => {
                      selectElement(id, false);
                      setBuilderTab("elements");
                    },
                    onAddSection: (index) => setStructureAt({ index }),
                    onBeginMove: (event, id) => {
                      if (isLockedForMe(id)) return;
                      beginDrag(event, { kind: "move", id, slug: pageSlug, label: widgetLabel(findElement(builderView, id, pageSlug)?.element.type ?? "") });
                    },
                    onSelectParent: (id) => {
                      const parent = findElement(builderView, id, pageSlug)?.parentId;
                      if (parent) selectElement(parent);
                    },
                  }}
                />
              ) : null
            }
          />
          {drag && (
            <div className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-control bg-ink px-3 py-1.5 text-[12px] font-semibold text-white shadow-dark" style={{ left: drag.clientX, top: drag.clientY - 12 }} data-testid="drag-ghost">
              {drag.source.label}
              {drag.overCanvas && !drag.target && <span className="ml-2 text-red-soft">Not here</span>}
            </div>
          )}
          <RequestBar agencyName={agencyName} onSubmit={(text) => requestChange(selectedPath ?? "", text)} />
          <Tour active={tourOpen} onDone={() => setTourOpen(false)} />
        </div>
        <Inspector
          schema={schema}
          baseline={published}
          draft={draft}
          selectedPath={selectedPath}
          selectedOnCanvas={selectedOnCanvas}
          liveUrl={site.live_url}
          replaceRequest={replaceRequest}
          agencyName={agencyName}
          elementPanel={
            builder && selectedId && currentLayout ? (
              <ElementInspector
                state={builderView}
                slug={pageSlug}
                id={selectedId}
                locked={lockedIn(builderView, selectedId)}
                agencyName={agencyName}
                requestChange={() => requestChange("")}
                device={modelDevice(device)}
                onDevice={onModelDevice}
                kit={builderView.kit}
                isStaff={isStaff}
                actions={inspectorActions}
              />
            ) : undefined
          }
          actions={{
            onText: (path, text) => contentCommand("Edited text", (current) => setText(current, published, path, text), `typing:${path}`),
            onHref: (root, href) => contentCommand("Edited link", (current) => setLinkHref(current, published, root, href), `typing:${root}.href`),
            onValue: (root, value) => contentCommand("Edited field", (current) => setFieldValue(current, published, root, value), `typing:${root}`),
            onImageFile: (path, file) => void attachImage(path, file),
            onClearImage: (path) => contentCommand("Kept current picture", (current) => clearImage(current, path)),
            onRevert: (root) => contentCommand("Reverted to published", (current) => revertField(current, root)),
            onEditInline: (path) => send({ type: "armature:edit:start", path }),
            onListAdd: (root, item) => contentCommand("Added item", (current) => addListItem(current, published, root, item)),
            onListDuplicate: (root, index) => contentCommand("Duplicated item", (current) => duplicateListItem(current, published, root, index)),
            onListRemove: (root, index) => {
              contentCommand("Deleted item", (current) => removeListItem(current, published, root, index));
              toast.show(`Item ${index + 1} deleted. ${mod}+Z to undo.`, "info");
            },
            onListMove: (root, from, to) => contentCommand("Moved item", (current) => moveListItem(current, published, root, from, to)),
            onShowOnPage: (path) => selectPath(path),
            onRequestChange: (path) => requestChange(path),
          }}
        />
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />}
      <StructurePicker open={structureAt !== null} onClose={() => setStructureAt(null)} onPick={(structure) => addStructure(structure, structureAt && structureAt.index >= 0 ? structureAt.index : null)} />

      <PublishDialog
        open={publishOpen}
        state={publishState}
        summary={summary}
        siteName={site.name}
        onClose={() => setPublishOpen(false)}
        onPublish={() => publish.mutate()}
        onReloadKeepRest={() => {
          const failure = publishState.step === "conflict" ? publishState.failure : null;
          const roots = rootsForLabels(schema, failure?.fields ?? []);
          contentCommand("Reloaded conflicting fields", (current) => dropRoots(current, roots));
          setPublishOpen(false);
          void refetchContent();
          toast.show(`Reloaded. ${roots.length} ${roots.length === 1 ? "field" : "fields"} now show the other person's version; the rest of your draft is kept.`, "info");
        }}
        onDiscardAndReload={() => {
          contentCommand("Discarded changes", discardAll);
          setPublishOpen(false);
          void refetchContent();
        }}
        layoutChanges={layoutChanges.length}
      />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} builder={builder} />
      <RestorePrompt
        open={pendingRestore !== null}
        savedAt={pendingRestore?.savedAt ?? ""}
        count={pendingRestore ? Object.keys(pendingRestore.content.fields).length + Object.keys(pendingRestore.content.images).length + Object.keys(pendingRestore.layouts).length + (pendingRestore.kit ? 1 : 0) : 0}
        onKeep={() => {
          if (pendingRestore) setHistory(reset(restoreEditorDraft(pendingRestore, baseline, published, schema)));
          setPendingRestore(null);
        }}
        onDiscard={() => {
          try {
            localStorage.removeItem(storageKey);
            localStorage.removeItem(legacyDraftKey(site.id, userId));
          } catch {
            // ignore
          }
          setPendingRestore(null);
        }}
      />
      <Modal
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        title="Leave the editor?"
        footer={
          <>
            <Button variant="secondary" onClick={() => blocker.reset?.()}>
              Keep editing
            </Button>
            <Button onClick={() => blocker.proceed?.()}>Leave</Button>
          </>
        }
      >
        <p className="text-[14px] leading-relaxed text-text">
          You have {count} unpublished {count === 1 ? "change" : "changes"}. They are saved in this browser and will be here when you come back, but nothing is live until you publish.
        </p>
      </Modal>
      <span className="sr-only" data-testid="history-steps">
        {history.past.length}
      </span>
    </div>
  );
}

/** Schema fields not shown by any builder element on this page (the header, the SEO fields), so nothing is unreachable. */
function OffPageFields({
  page,
  sharedPage,
  canvasFields,
  connected,
  changed,
  selectedPath,
  onSelect,
}: {
  page: PageDefinition | undefined;
  sharedPage: PageDefinition | undefined;
  canvasFields: MappedField[];
  connected: boolean;
  changed: Set<FieldPath>;
  selectedPath: FieldPath | null;
  onSelect: (path: FieldPath) => void;
}) {
  const owned = new Set(canvasFields.filter((field) => field.owner).map((field) => fieldRoot(field.path)));
  const onCanvas = new Set(canvasFields.map((field) => fieldRoot(field.path)));
  const groups: { label: string; slug: string; sections: PageSection[] }[] = [];
  if (page) groups.push({ label: page.label, slug: page.slug, sections: page.sections });
  if (sharedPage) groups.push({ label: sharedPage.label, slug: sharedPage.slug, sections: sharedPage.sections });
  const rows = groups.flatMap((group) =>
    group.sections.flatMap((section) =>
      section.fields
        .map((field) => ({ path: fieldPath(group.slug, section.key, field.key), label: field.label, section: section.label, group: group.label }))
        .filter((row) => !owned.has(row.path)),
    ),
  );
  if (rows.length === 0) return null;
  return (
    <div className="px-2 pb-3">
      <div className="mt-2 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Content fields</div>
      {rows.map((row) => {
        const visible = !connected || onCanvas.has(row.path);
        const active = selectedPath !== null && fieldRoot(selectedPath) === row.path;
        return (
          <button key={row.path} type="button" data-testid={`layer-${row.path}`} aria-pressed={active} onClick={() => onSelect(row.path)} className={`flex h-8 w-full items-center justify-between gap-2 rounded-sm px-2 text-left text-[13px] ${active ? "bg-blue-soft font-semibold text-blue" : "text-text hover:bg-ground"}`}>
            <span className="min-w-0 truncate">
              {row.label} <span className="text-muted">· {row.section}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {!visible && <span className="text-[11px] text-muted">off page</span>}
              {changed.has(row.path) && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Unpublished change" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
