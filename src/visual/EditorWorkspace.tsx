/**
 * The visual editor workspace: one draft per site across every page, the bridge
 * connection, selection, undo/redo, autosave, publishing, shortcuts and the tour.
 * Layout per docs/1-visual-editor.html: top bar, icon rail, Pages/Layers panel,
 * scaled canvas, inspector, and the "Need something bigger?" bar.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useNavigate } from "react-router";
import { siteQueryKey } from "@/components/SiteLayout.tsx";
import { Button, Modal, useToast } from "@/components/ui.tsx";
import { callFunction, type Failure } from "@/lib/functions.ts";
import { fileToBase64, prepareImage } from "@/lib/resizeImage.ts";
import type { Agency, Site } from "@/lib/types.ts";
import type { ContentValue } from "@shared/contentFile.ts";
import type { ContentGetResponse, PublishBatchResponse } from "@shared/publishTypes.ts";
import type { SiteSchema } from "@shared/schema.ts";
import { fieldPath, fieldRoot, parseFieldPath, type BridgeToEditor, type FieldPath, type ShortcutKey } from "@shared/visualProtocol.ts";
import { Canvas } from "./Canvas.tsx";
import {
  addListItem,
  canRedo,
  canUndo,
  changeCount,
  changedRoots,
  clearImage,
  currentText,
  currentValue,
  discardAll,
  draftForBridge,
  draftStorageKey,
  dropRoots,
  duplicateListItem,
  emptyHistory,
  fieldMeta,
  isEmptyDraft,
  moveListItem,
  parseStoredDraft,
  reconcile,
  redo,
  removeListItem,
  revertField,
  serializeDraft,
  setFieldValue,
  setImage,
  setLinkHref,
  setText,
  summarizeDraft,
  toPublishRequest,
  undo,
  type History,
  type ImageDraft,
  type StoredDraft,
} from "./draftStore.ts";
import { createGeometryStore } from "./geometry.ts";
import { IconRail } from "./IconRail.tsx";
import { Inspector } from "./Inspector.tsx";
import { LeftPanel, type LeftTab } from "./LeftPanel.tsx";
import { defaultPage, deviceWidth, editablePages, modKey, pageForRoute, tourSeen, type Device } from "./pages.ts";
import { PublishDialog, type PublishState } from "./PublishDialog.tsx";
import { RequestBar, RestorePrompt, ShortcutsSheet, Tour } from "./Sheets.tsx";
import { TopBar } from "./TopBar.tsx";
import { useBridge } from "./useBridge.ts";

const AUTOSAVE_MS = 300;
const HINT_MS = 2600;

/** Every field of the site as the bridge should show it: published values with the draft on top. */
function contentForBridge(schema: SiteSchema, baseline: ContentGetResponse["content"], draft: History["present"]): Record<FieldPath, ContentValue> {
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
  const baseline = content.content;
  const pages = useMemo(() => editablePages(schema), [schema]);
  const agencyName = agency?.portal_name?.trim() || agency?.name || "the agency";
  const formEditorHref = `/sites/${site.id}/pages`;

  // --- draft, history, persistence ------------------------------------------------------
  const storageKey = draftStorageKey(site.id, userId);
  const [pendingRestore, setPendingRestore] = useState<StoredDraft | null>(() => {
    try {
      return parseStoredDraft(localStorage.getItem(storageKey));
    } catch {
      return null;
    }
  });
  const [history, setHistory] = useState<History>(() => emptyHistory());
  const draft = history.present;
  const changed = useMemo(() => changedRoots(draft), [draft]);
  const count = changed.size;
  const dirty = count > 0;
  // Autosave to this browser, debounced. `savedDraft` is the last draft written.
  const [savedDraft, setSavedDraft] = useState<History["present"] | null>(null);
  useEffect(() => {
    if (pendingRestore) return;
    const timer = window.setTimeout(() => {
      try {
        if (isEmptyDraft(draft)) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, serializeDraft(draft));
      } catch {
        // storage full or unavailable: the draft still lives in memory
      }
      setSavedDraft(draft);
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, storageKey, pendingRestore]);
  const saveState: "clean" | "saving" | "saved" = isEmptyDraft(draft) ? "clean" : savedDraft === draft ? "saved" : "saving";

  // Fresh content (after a publish or a reload) may already carry some of the draft.
  const [seenCommit, setSeenCommit] = useState(content.commitSha);
  if (seenCommit !== content.commitSha) {
    setSeenCommit(content.commitSha);
    setHistory((current) => emptyHistory(reconcile(current.present, baseline, schema)));
  }

  const update = useCallback((fn: (current: History) => History) => setHistory((current) => fn(current)), []);

  // --- page, device, mode, selection -----------------------------------------------------
  const [pageSlug, setPageSlug] = useState<string>(() => (initialSlug && schema.pages.some((page) => page.slug === initialSlug) ? initialSlug : (defaultPage(schema)?.slug ?? "")));
  const page = schema.pages.find((item) => item.slug === pageSlug);
  const [device, setDevice] = useState<Device>("desktop");
  const [preview, setPreview] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("layers");
  const [selectedPath, setSelectedPath] = useState<FieldPath | null>(null);
  const [editingPath, setEditingPath] = useState<FieldPath | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [replaceRequest, setReplaceRequest] = useState(0);
  const geometry = useMemo(() => createGeometryStore(), []);
  const editStartValue = useRef<string | null>(null);

  useEffect(() => {
    navigate(`/sites/${site.id}/visual/${pageSlug}`, { replace: true });
  }, [pageSlug, site.id, navigate]);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), HINT_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  // --- the bridge ----------------------------------------------------------------------------
  const handleMessage = useRef<(message: BridgeToEditor) => void>(() => undefined);
  const bridge = useBridge({ liveUrl: site.live_url, siteId: site.id, handlers: { onMessage: (message) => handleMessage.current(message) } });
  const { send, connection } = bridge;
  const ready = connection.status === "ready";

  // First load of the frame.
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (loadedOnce.current || !page) return;
    loadedOnce.current = true;
    bridge.load(page.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.path]);

  // Push mode and the full content whenever the bridge is ready and something changed.
  const bridgeContent = useMemo(() => contentForBridge(schema, baseline, draft), [schema, baseline, draft]);
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

  const selectPath = useCallback(
    (path: FieldPath | null, scroll = true) => {
      setSelectedPath(path);
      if (ready) send({ type: "armature:select", path, scroll });
    },
    [ready, send],
  );

  const goToPage = useCallback(
    (slug: string) => {
      const target = schema.pages.find((item) => item.slug === slug);
      if (!target) return;
      setPageSlug(slug);
      setSelectedPath(null);
      if (ready) send({ type: "armature:navigate", path: target.path });
      else bridge.load(target.path);
    },
    [schema, ready, send, bridge],
  );

  // --- shortcuts ----------------------------------------------------------------------------
  const [publishOpen, setPublishOpen] = useState(false);
  const shortcut = useCallback(
    (key: ShortcutKey) => {
      switch (key) {
        case "undo":
          update(undo);
          return;
        case "redo":
          update(redo);
          return;
        case "publish":
          if (dirty && !preview) setPublishOpen(true);
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
      }
    },
    [update, dirty, preview, geometry, selectedPath, selectPath],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      const typing = isTypingTarget(event.target);
      if (meta && event.key.toLowerCase() === "s") {
        event.preventDefault();
        shortcut("publish");
        return;
      }
      if (typing) return;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        shortcut(event.shiftKey ? "redo" : "undo");
      } else if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        shortcut("redo");
      } else if (event.key === "?" && !meta) {
        event.preventDefault();
        shortcut("help");
      } else if (event.key === "Escape") {
        if (shortcutsOpen || publishOpen) return; // the sheets close themselves
        if (selectedPath) selectPath(null);
      } else if (event.key === "Tab" && !meta && !event.altKey && (event.target === document.body || (event.target as HTMLElement | null)?.dataset?.["testid"] === "canvas")) {
        event.preventDefault();
        shortcut("next");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut, selectedPath, selectPath, shortcutsOpen, publishOpen]);

  // --- messages from the bridge ------------------------------------------------------------------
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
      case "armature:viewport":
        geometry.patch({ viewport: message.viewport });
        return;
      case "armature:hover":
        geometry.patch({ hover: message.field });
        return;
      case "armature:select":
        geometry.patch({ selected: message.field });
        if (message.source === "canvas") {
          setSelectedPath(message.field?.path ?? null);
          if (message.field?.kind === "link" && message.field.href) setHint(`Hold ${modKey()} and click to follow this link`);
        }
        return;
      case "armature:edit:start":
        setEditingPath(message.path);
        editStartValue.current = currentText(draft, baseline, message.path);
        return;
      case "armature:edit:input":
        update((current) => setText(current, baseline, message.path, message.value, { group: `typing:${message.path}` }));
        return;
      case "armature:edit:commit":
        update((current) => setText(current, baseline, message.path, message.value, { group: `typing:${message.path}` }));
        setEditingPath(null);
        editStartValue.current = null;
        return;
      case "armature:edit:cancel": {
        const original = editStartValue.current;
        if (original !== null) update((current) => setText(current, baseline, message.path, original, { group: `typing:${message.path}` }));
        setEditingPath(null);
        editStartValue.current = null;
        return;
      }
      case "armature:route:changed": {
        const target = pageForRoute(schema, message.route);
        if (target && target.slug !== pageSlug) {
          setPageSlug(target.slug);
          setSelectedPath(null);
        }
        return;
      }
      case "armature:navigate":
        if (!message.followed) setHint(message.external ? "External links open outside the editor" : `Hold ${modKey()} and click to follow this link`);
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

  // --- images ------------------------------------------------------------------------------------
  const attachImage = useCallback(
    async (path: FieldPath, file: File) => {
      try {
        const prepared = await prepareImage(file);
        URL.revokeObjectURL(prepared.previewUrl);
        const base64 = await fileToBase64(prepared.file);
        const image: ImageDraft = { name: prepared.file.name, type: prepared.file.type, width: prepared.width, height: prepared.height, bytes: prepared.bytes, dataUrl: `data:${prepared.file.type};base64,${base64}` };
        update((current) => setImage(current, path, image));
        setSelectedPath(path);
      } catch (error) {
        toast.show(error instanceof Error ? error.message : String(error), "danger");
      }
    },
    [update, toast],
  );

  // --- publishing ------------------------------------------------------------------------------------
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
        const published = count;
        setHistory(emptyHistory());
        try {
          localStorage.removeItem(storageKey);
        } catch {
          // ignore
        }
        setPublishState({ step: "done", commitSha: result.commitSha, commitUrl: result.commitUrl, count: published });
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

  // --- leaving ------------------------------------------------------------------------------------------
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

  // --- request a change ------------------------------------------------------------------------------------
  const requestChange = (path: FieldPath | "", text = "") => {
    const meta = path ? fieldMeta(schema, path) : null;
    const where = meta ? `${meta.page.label} page, ${meta.section.label} section, "${meta.label}"` : page ? `${page.label} page` : site.name;
    const params = new URLSearchParams();
    params.set("title", text ? text.slice(0, 120) : meta ? `Change to ${meta.label} on the ${meta.page.label} page` : `Change to the ${page?.label ?? ""} page`.trim());
    params.set("details", `${text ? `${text}\n\n` : ""}Where: ${where}${path ? ` (${path})` : ""}\nCurrent text: ${path ? currentText(draft, baseline, path).slice(0, 300) : ""}`.trim());
    navigate(`/sites/${site.id}/requests/new?${params.toString()}`);
  };

  // --- derived ------------------------------------------------------------------------------------------------
  const changedByPage = useMemo(() => {
    const out: Record<string, number> = {};
    for (const root of changed) {
      const slug = parseFieldPath(root)?.slug;
      if (slug) out[slug] = (out[slug] ?? 0) + 1;
    }
    return out;
  }, [changed]);
  const [canvasRoots, setCanvasRoots] = useState<Set<FieldPath>>(() => new Set());
  useEffect(() => {
    return geometry.subscribe(() => {
      const roots = new Set<FieldPath>();
      for (const field of geometry.get().fields) roots.add(fieldRoot(field.path));
      setCanvasRoots((current) => (current.size === roots.size && [...roots].every((root) => current.has(root)) ? current : roots));
    });
  }, [geometry]);
  const selectedOnCanvas = selectedPath !== null && canvasRoots.has(fieldRoot(selectedPath));

  const mod = modKey();

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ground text-text" data-testid="visual-editor">
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
        canUndo={canUndo(history)}
        canRedo={canRedo(history)}
        onUndo={() => update(undo)}
        onRedo={() => update(redo)}
        status={{ kind: saveState, changes: count }}
        preview={preview}
        onPreview={(next) => {
          setPreview(next);
          if (next) selectPath(null);
        }}
        canPublish={dirty && !publish.isPending}
        onPublish={openPublish}
      />
      <div className="flex min-h-0 flex-1">
        <IconRail siteId={site.id} isStaff={isStaff} />
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
        <div className="relative flex min-w-0 flex-1">
          <Canvas
            iframeRef={bridge.iframeRef}
            src={bridge.src}
            attempt={bridge.attempt}
            onLoad={bridge.beginHandshake}
            connection={connection}
            onRetry={() => page && bridge.load(page.path)}
            deviceWidth={deviceWidth(device)}
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
                setSelectedPath(path);
                setReplaceRequest((current) => current + 1);
              },
              onEditLink: () => document.getElementById("inspector-link-href")?.focus() ?? document.getElementById("inspector-url")?.focus(),
              onRevert: (root) => update((current) => revertField(current, root)),
              onRequestChange: (path) => requestChange(path),
            }}
            onSelectImage={(path) => selectPath(path, false)}
            onDropImage={(path, file) => void attachImage(path, file)}
            formEditorHref={formEditorHref}
            siteName={site.name}
            hint={hint}
          />
          <RequestBar agencyName={agencyName} onSubmit={(text) => requestChange(selectedPath ?? "", text)} />
          <Tour active={tourOpen} onDone={() => setTourOpen(false)} />
        </div>
        <Inspector
          schema={schema}
          baseline={baseline}
          draft={draft}
          selectedPath={selectedPath}
          selectedOnCanvas={selectedOnCanvas}
          liveUrl={site.live_url}
          replaceRequest={replaceRequest}
          agencyName={agencyName}
          actions={{
            onText: (path, text) => update((current) => setText(current, baseline, path, text, { group: `typing:${path}` })),
            onHref: (root, href) => update((current) => setLinkHref(current, baseline, root, href, { group: `typing:${root}.href` })),
            onValue: (root, value) => update((current) => setFieldValue(current, baseline, root, value, { group: `typing:${root}` })),
            onImageFile: (path, file) => void attachImage(path, file),
            onClearImage: (path) => update((current) => clearImage(current, path)),
            onRevert: (root) => update((current) => revertField(current, root)),
            onEditInline: (path) => send({ type: "armature:edit:start", path }),
            onListAdd: (root, item) => update((current) => addListItem(current, baseline, root, item)),
            onListDuplicate: (root, index) => update((current) => duplicateListItem(current, baseline, root, index)),
            onListRemove: (root, index) => {
              update((current) => removeListItem(current, baseline, root, index));
              toast.show(`Item ${index + 1} deleted. ${mod}+Z to undo.`, "info");
            },
            onListMove: (root, from, to) => update((current) => moveListItem(current, baseline, root, from, to)),
            onShowOnPage: (path) => selectPath(path),
            onRequestChange: (path) => requestChange(path),
          }}
        />
      </div>

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
          update((current) => dropRoots(current, roots));
          setPublishOpen(false);
          void refetchContent();
          toast.show(`Reloaded. ${roots.length} ${roots.length === 1 ? "field" : "fields"} now show the other person's version; the rest of your draft is kept.`, "info");
        }}
        onDiscardAndReload={() => {
          update(discardAll);
          setPublishOpen(false);
          void refetchContent();
        }}
      />
      <ShortcutsSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <RestorePrompt
        open={pendingRestore !== null}
        savedAt={pendingRestore?.savedAt ?? ""}
        count={pendingRestore ? changeCount(pendingRestore.draft) : 0}
        onKeep={() => {
          if (pendingRestore) setHistory(emptyHistory(reconcile(pendingRestore.draft, baseline, schema)));
          setPendingRestore(null);
        }}
        onDiscard={() => {
          try {
            localStorage.removeItem(storageKey);
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
    </div>
  );
}
