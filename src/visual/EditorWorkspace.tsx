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
import { flushSync } from "react-dom";
import { useBlocker, useNavigate } from "react-router";
import { BuilderPanel } from "@/builder/BuilderPanel.tsx";
import { readPanelCollapsed, writePanelCollapsed } from "@/builder/panelState.ts";
import { PageSettingsPanel } from "@/builder/PageSettingsPanel.tsx";
import { takenAddresses } from "@/builder/pageAddress.ts";
import { pastedElement, readClipboard, writeClipboard } from "@/builder/clipboard.ts";
import { ContextMenu, type MenuItem } from "@/builder/ContextMenu.tsx";
import type { DropTarget } from "@/builder/dnd.ts";
import { ElementInspector } from "@/builder/ElementInspector.tsx";
import { ElementOverlays } from "@/builder/ElementOverlays.tsx";
import { ElementsPanel } from "@/builder/ElementsPanel.tsx";
import { readAt } from "@/builder/controls/path.ts";
import type { HandleActions } from "@/builder/Handles.tsx";
import { apply, breakGroup, canRedo, canUndo, createHistory, dropGroup, jumpTo, redo, reset, undo, type Command, type EditorHistory, type EditorState } from "@/builder/history.ts";
import { HistoryPanel } from "@/builder/HistoryPanel.tsx";
import { draftChangeCount, draftKey, isEmptyEditorDraft, legacyDraftKey, parseEditorDraft, restoreEditorDraft, serializeEditorDraft, type StoredEditorDraft } from "@/builder/persistence.ts";
import {
  changedElementIds,
  changedPages,
  deletePage,
  findElement,
  insertElement,
  kitChanged,
  mediaChanged,
  setMediaAlt,
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
import { NewPageDialog, type PagesPanelActions } from "@/builder/PagesPanel.tsx";
import { describeTree, useTemplateActions, useTemplates, type TemplateKind, type TemplateRow } from "@/builder/templates.ts";
import { SaveTemplateDialog, TemplateLibrary } from "@/builder/TemplatesUI.tsx";
import { StructurePicker } from "@/builder/StructurePicker.tsx";
import { withKitFont } from "@/builder/fonts.ts";
import { useDrag, type DragSource } from "@/builder/useDrag.ts";
import { applyStructure } from "@/builder/structure.ts";
import { createStructure, STRUCTURES, widgetLabel, type Structure } from "@/builder/widgets/registry.ts";
import { mediaEntries, mediaUsage } from "@/builder/media.ts";
import { restoreRevision, useRevisions, type Revision, type RevisionSnapshot } from "@/builder/revisions.ts";
import { deleteServerDraft, fetchServerDraft, newerDraft, saveServerDraft, SERVER_AUTOSAVE_MS, type DraftSource } from "@/builder/serverDrafts.ts";
import { MediaPicker } from "@/builder/MediaPanel.tsx";
import "@/builder/widgets/library.ts";
import { IconCopy, IconEraser, IconEye, IconEyeOff, IconLock, IconPaste, IconPencil, IconTemplate, IconTrash, IconUnlock } from "@/components/icons.tsx";
import { siteQueryKey } from "@/components/SiteLayout.tsx";
import { Button, Modal, useToast } from "@/components/ui.tsx";
import { relativeTime } from "@/lib/format.ts";
import { callFunction, type Failure } from "@/lib/functions.ts";
import { fileToBase64, prepareImage } from "@/lib/resizeImage.ts";
import type { Agency, Site } from "@/lib/types.ts";
import { defaultSiteKit, setAt, validateSiteKit, withFreshIds, type Element, type LayoutDoc, type RichDoc } from "@shared/builder/index.ts";
import { layoutPermissionErrors } from "@shared/builder/permissions.ts";
import type { ContentValue } from "@shared/contentFile.ts";
import type { BuilderPublishRequest, BuilderPublishResponse, ContentGetResponse, PublishBatchResponse } from "@shared/publishTypes.ts";
import type { Resolution } from "@shared/builder/merge.ts";
import type { PageDefinition, SiteSchema } from "@shared/schema.ts";
import { fieldPath, fieldRoot, parseFieldPath, type BridgeToEditor, type FieldPath, type RichTextState, type ShortcutKey } from "@shared/visualProtocol.ts";
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
import { FieldEditor, Inspector, type InspectorActions } from "./Inspector.tsx";
import { LeftPanel, type LeftTab } from "./LeftPanel.tsx";
import { defaultPage, deviceWidthFor, editablePages, modKey, modelDevice, normalizePath, pageForRoute, tourSeen, type Device } from "./pages.ts";
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

const initialState = (baseline: BuilderBaseline): EditorState => ({ content: emptyDraft(), builder: { layouts: baseline.layouts, deletedPages: [], kit: baseline.kit, media: baseline.media } });

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
  const baseline = useMemo<BuilderBaseline>(
    () => ({ layouts: content.layouts ?? {}, kit: content.siteKit ?? defaultSiteKit(), media: Object.fromEntries((content.media ?? []).filter((file) => file.alt).map((file) => [file.path, { alt: file.alt }])) }),
    [content.layouts, content.siteKit, content.media],
  );
  const editingLevel = content.editingLevel ?? "content";
  const canBuild = isStaff || editingLevel === "builder";
  /** The style level: the builder's canvas and inspector, but nothing added, moved or removed. */
  const styleOnly = !isStaff && editingLevel === "style";

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
  const codedSlugs = useMemo(() => new Set(schema.pages.map((item) => item.slug)), [schema.pages]);
  /** At the style level, the same check the publish function makes: why this change is not allowed, or null. */
  const styleProblem = useCallback(
    (next: BuilderState, slug: string): string | null => {
      if (!styleOnly) return null;
      const slugs = new Set([slug, ...Object.keys(next.layouts)]);
      for (const each of slugs) {
        const theirs = baseline.layouts[each] ?? null;
        const mine = next.deletedPages.includes(each) ? null : (next.layouts[each] ?? null);
        if (!mine && !theirs) continue;
        const problem = layoutPermissionErrors(theirs, mine, { staff: false, level: "style" }, { coded: codedSlugs.has(each) })[0];
        if (problem) return problem;
      }
      return null;
    },
    [styleOnly, baseline.layouts, codedSlugs],
  );
  const builderCommand = useCallback(
    (label: string, slug: string, fn: (builder: BuilderState) => BuilderState | null, group?: string) => {
      if (styleOnly) {
        // Checked up front so the person hears why; the command itself checks again.
        const next = fn(materialize(builderRef.current, slug));
        const problem = next ? styleProblem(next, slug) : null;
        if (problem) {
          toast.show(problem.replace(/^[^:]+: /, "").replace(/^your account/, "Your account"), "info");
          return;
        }
      }
      run({
        label,
        group,
        run: (current) => {
          const next = fn(materialize(current.builder, slug));
          return next && !styleProblem(next, slug) ? { ...current, builder: next } : null;
        },
      });
    },
    [run, materialize, styleOnly, styleProblem, toast],
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

  // The draft saved to the person's account, so it follows them to another browser. On
  // opening, the newer of the two drafts is offered back (only while nothing is edited yet);
  // after that the account copy is kept in step every couple of seconds.
  const [restoreSource, setRestoreSource] = useState<DraftSource>("browser");
  const [serverChecked, setServerChecked] = useState(false);
  const serverHasDraft = useRef(false);
  const pendingRef = useRef(pendingRestore);
  const historyRef = useRef(history);
  useLayoutEffect(() => {
    pendingRef.current = pendingRestore;
    historyRef.current = history;
  });
  useEffect(() => {
    let cancelled = false;
    void fetchServerDraft(site.id, userId).then((account) => {
      if (cancelled) return;
      serverHasDraft.current = !!account;
      setServerChecked(true);
      if (!account || historyRef.current.past.length > 0) return;
      const pick = newerDraft(pendingRef.current, account);
      if (pick && pick.draft !== pendingRef.current) {
        setRestoreSource(pick.source);
        setPendingRestore(pick.draft);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [site.id, userId]);
  const lastServerState = useRef<EditorState | null>(null);
  useEffect(() => {
    if (!serverChecked || pendingRestore || lastServerState.current === state) return;
    const timer = window.setTimeout(() => {
      lastServerState.current = state;
      if (isEmptyEditorDraft(state, baseline)) {
        if (serverHasDraft.current) {
          serverHasDraft.current = false;
          void deleteServerDraft(site.id, userId);
        }
        return;
      }
      void saveServerDraft({ siteId: site.id, userId, serialized: serializeEditorDraft(state, baseline), baseCommit: content.commitSha, changeCount: draftChangeCount(state, baseline) }).then((saved) => {
        if (saved) serverHasDraft.current = true;
      });
    }, SERVER_AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [state, baseline, serverChecked, pendingRestore, site.id, userId, content.commitSha]);

  // Fresh content (after a publish or a reload) may already carry some of the draft: rebase it.
  const [seen, setSeen] = useState({ commit: content.commitSha, baseline });
  // The commit a builder publish just made: when it arrives, the published state is the new baseline.
  const [publishedCommit, setPublishedCommit] = useState<string | null>(null);
  if (seen.commit !== content.commitSha) {
    const stored = parseEditorDraft(serializeEditorDraft(state, seen.baseline));
    setSeen({ commit: content.commitSha, baseline });
    if (publishedCommit && publishedCommit === content.commitSha) {
      setPublishedCommit(null);
      setHistory(reset(initialState(baseline)));
    } else {
      setHistory(reset(stored ? restoreEditorDraft(stored, baseline, published, schema) : initialState(baseline)));
    }
    setSeeds({});
  }

  // --- page, device, mode, selection -----------------------------------------------------------------
  // Builder-only pages (a layout for a slug the schema does not declare) are pages too:
  // no Stage 1 fields, just their layout. They come and go with the draft.
  const builderPages = useMemo<PageDefinition[]>(
    () =>
      Object.values(builderView.layouts)
        .filter((layout) => !schema.pages.some((item) => item.slug === layout.pageSlug))
        .map((layout) => ({ slug: layout.pageSlug, label: layout.label || layout.pageSlug, path: layout.path, sections: [] }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [builderView.layouts, schema.pages],
  );
  const allPages = useMemo(() => [...schema.pages, ...builderPages], [schema.pages, builderPages]);
  const [pageSlug, setPageSlug] = useState<string>(() => (initialSlug && (schema.pages.some((page) => page.slug === initialSlug) || !!content.layouts?.[initialSlug]) ? initialSlug : (defaultPage(schema)?.slug ?? "")));
  const page = allPages.find((item) => item.slug === pageSlug);
  const [device, setDevice] = useState<Device>("desktop");
  const [preview, setPreview] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("layers");
  // The single left panel's mode. "auto" follows the selection (Edit when something is
  // selected, Elements when not); "elements" forces Elements (the + and "add inside");
  // "history" and "page-settings" are opened from the top bar.
  const [panelView, setPanelView] = useState<"auto" | "elements" | "history" | "page-settings">("auto");
  const [panelCollapsed, setPanelCollapsed] = useState<boolean>(() => readPanelCollapsed());
  const togglePanel = useCallback((collapsed: boolean) => {
    setPanelCollapsed(collapsed);
    writePanelCollapsed(collapsed);
  }, []);
  const [selection, setSelection] = useState<Selection>(null);
  const selectedPath = selection?.kind === "field" ? selection.path : null;
  const selectedId = selection?.kind === "element" ? selection.id : null;
  const [editingPath, setEditingPath] = useState<FieldPath | null>(null);
  const [editingElement, setEditingElement] = useState<string | null>(null);
  const [richState, setRichState] = useState<RichTextState | null>(null);
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
  const builder = protocol === 2 && (canBuild || styleOnly);
  const sections = useMemo(() => (connection.status === "ready" ? connection.sections : []), [connection]);

  const loadedOnce = useRef(false);
  useEffect(() => {
    if (loadedOnce.current || !page) return;
    loadedOnce.current = true;
    bridge.load(page.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.path]);

  // A published version shown on the canvas instead of the draft (History → Published versions).
  const [revision, setRevision] = useState<(RevisionSnapshot & { at: string }) | null>(null);
  const bridgeContent = useMemo(() => (revision ? contentForBridge(schema, revision.content, emptyDraft()) : contentForBridge(schema, published, draft)), [schema, published, draft, revision]);
  useEffect(() => {
    if (!ready) return;
    send({ type: "armature:draft:apply", fields: bridgeContent });
  }, [ready, bridgeContent, send]);
  useEffect(() => {
    if (!ready) return;
    send({ type: "armature:mode", mode: preview || revision ? "preview" : "edit" });
  }, [ready, preview, revision, send]);
  useEffect(() => {
    if (!ready) geometry.reset();
  }, [ready, geometry]);
  // Site contract v2: the kit renders the draft layouts and kit.
  const layoutsForBridge = useMemo(() => {
    if (revision) {
      const out: Record<string, LayoutDoc | null> = { ...revision.layouts };
      for (const slug of Object.keys(builderView.layouts)) if (!revision.layouts[slug]) out[slug] = null;
      return out;
    }
    const out: Record<string, LayoutDoc | null> = { ...builderView.layouts };
    for (const slug of builderView.deletedPages) out[slug] = null;
    return out;
  }, [builderView, revision]);
  const kitForBridge = revision ? (revision.kit ?? defaultSiteKit()) : builderView.kit;
  useEffect(() => {
    if (!ready || protocol !== 2) return;
    send({ type: "armature:layout:apply", layouts: layoutsForBridge, kit: kitForBridge });
  }, [ready, protocol, layoutsForBridge, kitForBridge, send]);

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
      // A selection returns the panel to Edit (auto); deselecting elsewhere shows Elements.
      if (next) setPanelView("auto");
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
    (slug: string, override?: PageDefinition) => {
      const target = override ?? allPages.find((item) => item.slug === slug);
      if (!target) return;
      setPageSlug(slug);
      setSelection(null);
      if (ready) send({ type: "armature:navigate", path: target.path });
      else bridge.load(target.path);
    },
    [allPages, ready, send, bridge],
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
      onPickImage: (onPick: (src: string, alt: string) => void) => setPicker({ onPick }),
      onRename: (id: string, label: string) => builderCommand("Renamed element", pageSlug, (current) => setElementPath(current, id, pageSlug, ["label"], label || undefined), `rename:${id}`),
      onBackToElements: () => {
        selectElement(null);
        setPanelView("elements");
      },
      onApplyStructure: (id: string, structureId: string) => {
        const structure = STRUCTURES.find((item) => item.id === structureId);
        if (!structure || isLockedForMe(id)) return;
        builderCommand("Changed the structure", pageSlug, (current) => applyStructure(current, id, pageSlug, structure));
      },
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

  // A press anywhere in the editor outside the formatting toolbar ends an edit on the page
  // (a rich-text edit stays open while its toolbar is used).
  useEffect(() => {
    if (!editingElement) return;
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-testid='richtext-toolbar']")) return;
      send({ type: "armature:element:edit:stop", commit: true });
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [editingElement, send]);

  /** Handles on the canvas: each pointer frame is one command in the drag's group (one undo step per drag). */
  const handleActions = useMemo<HandleActions>(
    () => ({
      onWrite: (writes, label, group) =>
        builderCommand(
          label,
          pageSlug,
          (current) => {
            let next: BuilderState = current;
            for (const write of writes) {
              if (isLockedForMe(write.id)) return null;
              const entry = findElement(next, write.id, pageSlug);
              if (!entry) return null;
              const value = write.responsive ? setAt(readAt(entry.element, write.path) as never, modelDevice(device), write.value as never) : write.value;
              // A write that changes nothing (the value is already there) is skipped, not fatal.
              next = setElementPath(next, write.id, pageSlug, write.path, value) ?? next;
            }
            return next === current ? null : next;
          },
          group,
        ),
      onCancel: (group) => setHistory((current) => dropGroup(current, group)),
    }),
    [builderCommand, device, isLockedForMe, pageSlug],
  );

  const insertAt = useCallback(
    (element: Element, target: { parentId: string | null; index: number }, label: string) => {
      builderCommand(`Added ${label}`, pageSlug, (current) => insertElement(current, element, { slug: pageSlug, ...target }, userName));
      setSelection({ kind: "element", id: element.id, slug: pageSlug });
      setPanelView("auto");
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
        else if (panelView !== "auto") setPanelView("auto");
      } else if (event.key === "Tab" && !meta && !event.altKey && (event.target === document.body || (event.target as HTMLElement | null)?.dataset?.["testid"] === "canvas")) {
        event.preventDefault();
        shortcut("next");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut, selection, select, selectedId, builder, shortcutsOpen, publishOpen, menu, structureAt, panelView]);

  // --- messages from the bridge -------------------------------------------------------------------------------
  const onBridgeMessage = (message: BridgeToEditor) => {
    switch (message.type) {
      case "armature:ready": {
        const target = pageForRoute(schema, message.route) ?? builderPages.find((item) => normalizePath(item.path) === normalizePath(message.route));
        if (target && target.slug !== pageSlug) setPageSlug(target.slug);
        {
          const builderTour = message.protocolVersion === 2 && (canBuild || styleOnly);
          if (!tourSeen(builderTour ? "builder" : "content") && !pendingRestore) setTourOpen(true);
        }
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
          if (message.field) {
            setSelection({ kind: "field", path: message.field.path });
            setPanelView("auto"); // a click on a content field opens its editor in the panel
          } else if (selection?.kind === "field") setSelection(null);
          if (message.field?.kind === "link" && message.field.href) setHint(`Hold ${mod} and click to follow this link`);
        }
        return;
      case "armature:element:select":
        if (message.source === "canvas") {
          // Committed at once: a shortcut pressed right after the click arrives as the next
          // message and must already see this selection.
          const id = message.id;
          if (id)
            flushSync(() => {
              setSelection({ kind: "element", id, slug: pageSlug });
              setPanelView("auto"); // a click on the page opens that element's Edit panel
            });
          else if (selection?.kind === "element") flushSync(() => setSelection(null));
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
      case "armature:richtext:state":
        setRichState(message.state);
        return;
      case "armature:element:edit:start":
        setRichState(null);
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
        const target = pageForRoute(schema, message.route) ?? builderPages.find((item) => normalizePath(item.path) === normalizePath(message.route));
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
  useLayoutEffect(() => {
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
    mutationFn: async (resolutions: Record<string, Resolution> = {}): Promise<PublishBatchResponse | BuilderPublishResponse | Failure> => {
      setPublishState({ step: "publishing", stage: "Checking your changes against the site's rules…" });
      const request = toPublishRequest(draft, schema, site.id, content.commitSha);
      window.setTimeout(() => setPublishState((current) => (current.step === "publishing" ? { step: "publishing", stage: "Committing to the site's repository…" } : current)), 900);
      // Layouts, the kit or media metadata changed: the builder publish carries everything in one commit.
      const builderChanges = layoutChanges.length > 0 || kitChanged(state.builder, baseline) || mediaChanged(state.builder, baseline);
      if (protocol === 2 && builderChanges) {
        const layouts: Record<string, LayoutDoc | null> = {};
        for (const change of layoutChanges) layouts[change.slug] = change.kind === "deleted" ? null : (state.builder.layouts[change.slug] ?? null);
        const builderRequest: BuilderPublishRequest = {
          site_id: site.id,
          baseCommitSha: content.commitSha,
          pages: request.pages,
          layouts,
          kit: kitChanged(state.builder, baseline) ? state.builder.kit : null,
          media: mediaChanged(state.builder, baseline) ? state.builder.media : null,
          resolutions,
        };
        return callFunction<BuilderPublishResponse>("builder-publish", builderRequest);
      }
      return callFunction<PublishBatchResponse>("content-publish-batch", request);
    },
    onSuccess: async (result) => {
      if (result.ok) {
        const publishedCount = count;
        if ("layouts" in result) setPublishedCommit(result.commitSha);
        setHistory((current) => reset({ ...current.present, content: emptyDraft() }));
        setPublishState({ step: "done", commitSha: result.commitSha, commitUrl: result.commitUrl, count: publishedCount, merged: "merged" in result && result.merged });
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
  useEffect(() => {
    return geometry.subscribe(() => {
      const fields = geometry.get().fields;
      const roots = new Set<FieldPath>();
      for (const field of fields) roots.add(fieldRoot(field.path));
      setCanvasRoots((current) => (current.size === roots.size && [...roots].every((root) => current.has(root)) ? current : roots));
    });
  }, [geometry]);
  const selectedOnCanvas = selectedPath !== null && canvasRoots.has(fieldRoot(selectedPath));
  const currentLayout = builderView.layouts[pageSlug];
  const changedIds = useMemo(() => changedElementIds(builderView.layouts[pageSlug], baseline.layouts[pageSlug]), [builderView.layouts, baseline.layouts, pageSlug]);
  const sectionsInUse = useMemo(() => new Set((currentLayout?.root ?? []).flatMap((element) => (element.type === "site-section" ? [String(element.props["key"])] : []))), [currentLayout]);

  // --- pages and templates ------------------------------------------------------------------------------
  const templatesQuery = useTemplates(site.id, site.agency_id);
  const templateActions = useTemplateActions(site.id);
  const templates = useMemo(() => (builder ? (templatesQuery.data ?? []) : []), [builder, templatesQuery.data]);
  const [saveTemplate, setSaveTemplate] = useState<{ kind: TemplateKind; name: string; content: TemplateRow["content"] } | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const canStructure = isStaff || editingLevel === "builder";

  const pageActions: PagesPanelActions = {
    onOpen: (slug) => goToPage(slug),
    onCreate: (layout) => {
      builderCommand(`Created the page "${layout.label ?? layout.pageSlug}"`, layout.pageSlug, (current) => setLayout(current, layout));
      goToPage(layout.pageSlug, { slug: layout.pageSlug, label: layout.label ?? layout.pageSlug, path: layout.path, sections: [] });
    },
    onSettings: (slug, patch) => {
      builderCommand("Changed page settings", slug, (current) => {
        const layout = current.layouts[slug];
        if (!layout) return null;
        const next: LayoutDoc = { ...layout, ...patch };
        for (const key of ["seo", "pageSettings"] as const) if (next[key] === undefined) delete next[key];
        return setLayout(current, next);
      });
      if (patch.path && slug === pageSlug) goToPage(slug, { slug, label: patch.label ?? page?.label ?? slug, path: patch.path, sections: [] });
    },
    onDuplicate: (slug) => {
      const layout = builderView.layouts[slug];
      if (!layout) return;
      const taken = new Set(allPages.map((item) => item.slug));
      let copySlug = `${slug}-copy`;
      let n = 2;
      while (taken.has(copySlug)) copySlug = `${slug}-copy-${n++}`;
      const copy: LayoutDoc = { ...layout, pageSlug: copySlug, path: `/${copySlug}/`, label: `${layout.label ?? slug} (copy)`, root: layout.root.map((element) => withFreshIds(element)) };
      builderCommand(`Duplicated the page "${layout.label ?? slug}"`, copySlug, (current) => setLayout(current, copy));
      goToPage(copySlug, { slug: copySlug, label: copy.label ?? copySlug, path: copy.path, sections: [] });
    },
    onDelete: (slug) => {
      const label = builderView.layouts[slug]?.label ?? slug;
      builderCommand(`Deleted the page "${label}"`, slug, (current) => deletePage(current, slug));
      if (slug === pageSlug) {
        const fallback = defaultPage(schema);
        if (fallback) goToPage(fallback.slug);
      }
    },
    onSaveTemplate: (slug) => {
      const layout = builderView.layouts[slug];
      if (!layout) return;
      setSaveTemplate({ kind: "page", name: layout.label ?? slug, content: { root: layout.root, label: layout.label, seo: layout.seo, pageSettings: layout.pageSettings } });
    },
  };
  const sectionTemplates = useMemo(
    () =>
      templates
        .filter((row) => row.kind === "section" && row.content.root[0])
        .map((row) => ({ id: row.id, name: row.name, count: row.element_count, create: () => withFreshIds(row.content.root[0] as Element) })),
    [templates],
  );

  // --- the context menu -------------------------------------------------------------------------------------------------
  // --- the media library ------------------------------------------------------------------------------------------------
  const mediaList = useMemo(() => mediaEntries(content.media ?? [], builderView.layouts), [content.media, builderView.layouts]);
  const mediaUses = useMemo(() => mediaUsage(published, builderView.layouts, (slug) => allPages.find((item) => item.slug === slug)?.label ?? slug), [published, builderView.layouts, allPages]);
  const [picker, setPicker] = useState<{ onPick: (src: string, alt: string) => void } | null>(null);
  /** A picture from this computer, resized in the browser; it travels in the draft as a data: URL until publish. */
  const uploadPicture = useCallback(
    async (file: File): Promise<string | null> => {
      try {
        const prepared = await prepareImage(file);
        URL.revokeObjectURL(prepared.previewUrl);
        return `data:${prepared.file.type};base64,${await fileToBase64(prepared.file)}`;
      } catch (error) {
        toast.show(error instanceof Error ? error.message : String(error), "danger");
        return null;
      }
    },
    [toast],
  );
  // --- published versions ----------------------------------------------------------------------------------------------
  const revisionsQuery = useRevisions(site.id, builder && panelView === "history");
  const previewRevision = async (item: Revision) => {
    if (revision?.sha === item.sha) return setRevision(null);
    const result = await callFunction<ContentGetResponse>("content-get", { site_id: site.id, ref: item.sha });
    if (!result.ok) return toast.show(result.message, "danger");
    send({ type: "armature:element:edit:stop", commit: true });
    setSelection(null);
    setRevision({ sha: item.sha, at: item.at, content: result.content, layouts: result.layouts ?? {}, kit: result.siteKit });
  };
  const restoreShownRevision = () => {
    if (!revision) return;
    const snapshot = revision;
    run({ label: `Restored the version from ${new Date(snapshot.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`, run: (current) => restoreRevision(snapshot, current, published, baseline) });
    setRevision(null);
    toast.show("That version is now your draft. Publish to put it live.", "success");
  };

  // --- the context menu -------------------------------------------------------------------------------------------------
  const menuItems = (id: string): MenuItem[] => {
    const entry = findElement(builderView, id, pageSlug);
    const locked = lockedIn(builderView, id);
    const which = modelDevice(device);
    const hidden = entry?.element.advanced.hidden?.[which] === true;
    const editable = entry && (entry.element.type === "heading" || entry.element.type === "text" || entry.element.type === "button");
    return [
      { key: "edit", label: "Edit", icon: <IconPencil size={14} />, disabled: !editable || locked, onSelect: () => send({ type: "armature:element:edit:start", id }) },
      { key: "duplicate", label: "Duplicate", icon: <IconCopy size={14} />, shortcut: `${mod}+D`, disabled: locked || styleOnly, onSelect: () => duplicate(id) },
      { key: "copy", label: "Copy", icon: <IconCopy size={14} />, shortcut: `${mod}+C`, onSelect: () => void copyElement(id) },
      { key: "paste", label: "Paste", icon: <IconPaste size={14} />, shortcut: `${mod}+V`, disabled: styleOnly, onSelect: () => void pasteElement() },
      { key: "paste-style", label: "Paste style", icon: <IconPaste size={14} />, shortcut: `${mod}+Shift+V`, disabled: locked, onSelect: () => void pasteStyle() },
      { key: "reset-style", label: "Reset style", icon: <IconEraser size={14} />, disabled: locked, onSelect: () => resetStyle(id) },
      { key: "s1", separator: true },
      {
        key: "template",
        label: "Save as template",
        icon: <IconTemplate size={14} />,
        disabled: !entry || !isContainerType(entry.element.type),
        onSelect: () => entry && setSaveTemplate({ kind: "section", name: entry.element.label || describeTree([entry.element]).heading || widgetLabel(entry.element.type), content: { root: [entry.element] } }),
      },
      ...(isStaff ? [{ key: "lock", label: entry?.element.locked ? "Unlock for clients" : "Lock for clients", icon: entry?.element.locked ? <IconUnlock size={14} /> : <IconLock size={14} />, onSelect: () => toggleLock(id) } satisfies MenuItem] : []),
      { key: "hide", label: hidden ? `Show on ${which}` : `Hide on ${which}`, icon: hidden ? <IconEye size={14} /> : <IconEyeOff size={14} />, disabled: locked, onSelect: () => toggleHidden(id) },
      { key: "s2", separator: true },
      { key: "delete", label: "Delete", icon: <IconTrash size={14} />, shortcut: "Delete", danger: true, disabled: locked || styleOnly, onSelect: () => deleteElement(id) },
    ];
  };

  // Stage-1 content field editing, shared by the right inspector (content-only sites) and
  // the builder's left panel (a field inside a coded site section).
  const fieldActions: InspectorActions = {
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
        builder={
          builder
            ? {
                onHistory: () => setPanelView((current) => (current === "history" ? "auto" : "history")),
                historyOpen: panelView === "history",
                onOpenElements: () => {
                  setPanelView("elements");
                  if (panelCollapsed) togglePanel(false);
                },
                onPageSettings: () => {
                  setPanelView("page-settings");
                  if (panelCollapsed) togglePanel(false);
                },
                pageSettingsOpen: panelView === "page-settings",
                onShortcuts: () => setShortcutsOpen(true),
                onNewPage: canStructure ? () => setCreating(true) : undefined,
                onSaveTemplate: page && builderPages.some((item) => item.slug === pageSlug) ? () => pageActions.onSaveTemplate?.(pageSlug) : undefined,
                onSaveDraft: () => toast.show(saveState === "saved" ? "Draft saved." : "Saving your draft…", "info"),
                viewPageHref: page && site.live_url ? `${site.live_url.replace(/\/+$/, "")}${page.path}` : null,
              }
            : undefined
        }
      />
      <div className="flex min-h-0 flex-1">
        {!builder && <IconRail siteId={site.id} isStaff={isStaff} />}
        {builder ? (
          <BuilderPanel collapsed={panelCollapsed} onToggle={togglePanel}>
            {panelView === "history" ? (
              <HistoryPanel
                history={history}
                onJump={(steps) => setHistory((current) => jumpTo(current, steps))}
                versions={{
                  revisions: revisionsQuery.data ?? [],
                  loading: revisionsQuery.isLoading,
                  previewing: revision?.sha ?? null,
                  pageLabel: (slug) => allPages.find((item) => item.slug === slug)?.label ?? slug,
                  who: (id) => (id === userId ? "You" : "Someone else"),
                  onPreview: (item) => void previewRevision(item),
                }}
              />
            ) : panelView === "page-settings" && page ? (
              <PageSettingsPanel
                page={page}
                layout={builderView.layouts[pageSlug]}
                isBuilderPage={builderPages.some((item) => item.slug === pageSlug)}
                taken={takenAddresses(allPages, pageSlug)}
                onClose={() => setPanelView("auto")}
                onSave={(patch) => {
                  pageActions.onSettings(pageSlug, patch);
                  setPanelView("auto");
                }}
                onDuplicate={canStructure ? () => pageActions.onDuplicate(pageSlug) : undefined}
                onDelete={
                  canStructure
                    ? () => {
                        pageActions.onDelete(pageSlug);
                        setPanelView("auto");
                      }
                    : undefined
                }
              />
            ) : panelView === "auto" && selectedId && currentLayout ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <ElementInspector
                  state={builderView}
                  slug={pageSlug}
                  id={selectedId}
                  locked={lockedIn(builderView, selectedId)}
                  agencyName={agencyName}
                  siteUrl={site.live_url}
                  requestChange={() => requestChange("")}
                  device={modelDevice(device)}
                  onDevice={onModelDevice}
                  kit={builderView.kit}
                  isStaff={isStaff}
                  actions={inspectorActions}
                />
              </div>
            ) : panelView === "auto" && selectedPath ? (
              <div className="min-h-0 flex-1 overflow-y-auto" data-testid="field-editor">
                <FieldEditor schema={schema} baseline={published} draft={draft} selectedPath={selectedPath} selectedOnCanvas={selectedOnCanvas} liveUrl={site.live_url} actions={fieldActions} replaceRequest={replaceRequest} />
              </div>
            ) : (
              <ElementsPanel
                isStaff={isStaff}
                sections={sections}
                sectionsInUse={sectionsInUse}
                onBeginDrag={beginDrag}
                onInsert={(element, label) => insertAt(element, insertionPoint(), label)}
                onStructure={() => setStructureAt({ index: -1 })}
                templates={sectionTemplates}
                onOpenLibrary={() => setLibraryOpen(true)}
                showGlobals={isStaff || editingLevel !== "content"}
                canAdd={!styleOnly}
                globals={<SiteSettingsPanel kit={builderView.kit} write={writeKit} device={modelDevice(device)} onDevice={onModelDevice} isStaff={isStaff} />}
              />
            )}
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
          {revision && (
            <div role="status" className="absolute inset-x-0 top-0 z-30 flex flex-wrap items-center justify-center gap-3 border-b border-line bg-panel px-4 py-2 text-[13px] text-text shadow-segment" data-testid="revision-banner">
              <span>
                Previewing the version published {relativeTime(revision.at)}. Nothing here is editable.
              </span>
              <Button size="sm" variant="secondary" onClick={() => setRevision(null)}>
                Back to your draft
              </Button>
              <Button size="sm" onClick={restoreShownRevision} data-testid="revision-restore">
                Restore as a draft
              </Button>
            </div>
          )}
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
                  handleActions={handleActions}
                  richText={{
                    state: richState,
                    kit: builderView.kit,
                    onCommand: (command, value) => send({ type: "armature:richtext:command", command, value }),
                    onDone: () => send({ type: "armature:element:edit:stop", commit: true }),
                  }}
                  actions={{
                    onSelect: (id) => selectElement(id, false),
                    onEdit: (id) => send({ type: "armature:element:edit:start", id }),
                    onDuplicate: duplicate,
                    onDelete: deleteElement,
                    onAddInside: (id) => {
                      selectElement(id, false);
                      setPanelView("elements");
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
          <Tour active={tourOpen} kind={builder ? (styleOnly ? "style" : "builder") : "content"} onDone={() => setTourOpen(false)} />
        </div>
        {!builder && (
          <Inspector
            schema={schema}
            baseline={published}
            draft={draft}
            selectedPath={selectedPath}
            selectedOnCanvas={selectedOnCanvas}
            liveUrl={site.live_url}
            replaceRequest={replaceRequest}
            agencyName={agencyName}
            builder={builder}
            actions={fieldActions}
          />
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={() => setMenu(null)} />}
      {saveTemplate && (
        <SaveTemplateDialog
          open
          kind={saveTemplate.kind}
          defaultName={saveTemplate.name}
          isStaff={isStaff}
          onClose={() => setSaveTemplate(null)}
          onSave={async (name, scope) => {
            const problem = await templateActions.save({ agencyId: site.agency_id, siteId: scope === "agency" && isStaff ? null : site.id, name, kind: saveTemplate.kind, content: saveTemplate.content, userId });
            if (!problem) toast.show(`Saved "${name}" as a template.`, "success");
            return problem;
          }}
        />
      )}
      <TemplateLibrary
        open={libraryOpen}
        templates={templates}
        canDelete={(row) => isStaff || (row.site_id === site.id && row.created_by === userId)}
        onClose={() => setLibraryOpen(false)}
        onInsert={(row) => {
          const first = row.content.root[0];
          if (first) insertAt(withFreshIds(first), insertionPoint(), `the template "${row.name}"`);
          setLibraryOpen(false);
        }}
        onDelete={(row) => void templateActions.remove(row.id).then((problem) => toast.show(problem ?? `Deleted "${row.name}".`, problem ? "danger" : "info"))}
      />
      <MediaPicker
        open={!!picker}
        entries={mediaList}
        usage={mediaUses}
        alts={builderView.media ?? {}}
        siteUrl={site.live_url}
        onAlt={(src, alt) => builderCommand("Changed alt text", pageSlug, (current) => setMediaAlt(current, src, alt), `alt:${src}`)}
        onClose={() => setPicker(null)}
        onChoose={(entry) => {
          picker?.onPick(entry.src, builderView.media?.[entry.src]?.alt ?? "");
          setPicker(null);
        }}
        onUpload={async (file) => {
          const src = await uploadPicture(file);
          if (src) picker?.onPick(src, "");
          setPicker(null);
        }}
      />
      <StructurePicker open={structureAt !== null} onClose={() => setStructureAt(null)} onPick={(structure) => addStructure(structure, structureAt && structureAt.index >= 0 ? structureAt.index : null)} />
      {builder && (
        <NewPageDialog
          open={creating}
          taken={takenAddresses(allPages)}
          existingSlugs={new Set(allPages.map((item) => item.slug))}
          pageTemplates={templates.filter((row) => row.kind === "page")}
          onClose={() => setCreating(false)}
          onCreate={(layout) => {
            setCreating(false);
            pageActions.onCreate(layout);
          }}
        />
      )}

      <PublishDialog
        open={publishOpen}
        state={publishState}
        summary={summary}
        siteName={site.name}
        onClose={() => setPublishOpen(false)}
        onPublish={() => publish.mutate({})}
        onPublishWithChoices={(choices: Record<string, Resolution>) => publish.mutate(choices)}
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
          setHistory(reset(initialState(baseline)));
          setPublishOpen(false);
          void refetchContent();
        }}
        builder={
          protocol === 2
            ? {
                pages: layoutChanges.map((change) => ({ ...change, label: builderView.layouts[change.slug]?.label ?? schema.pages.find((item) => item.slug === change.slug)?.label ?? baseline.layouts[change.slug]?.label ?? change.slug })),
                kit: kitChanged(state.builder, baseline),
                media: mediaChanged(state.builder, baseline),
              }
            : undefined
        }
      />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} builder={builder} />
      <RestorePrompt
        open={pendingRestore !== null}
        savedAt={pendingRestore?.savedAt ?? ""}
        source={restoreSource}
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
          if (serverHasDraft.current) {
            serverHasDraft.current = false;
            void deleteServerDraft(site.id, userId);
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
