/**
 * The editor's side of the engine bridge (engine/bridge/engineBridge.ts): owns the iframe
 * handshake (a fresh nonce per document load, hello every 250ms until the bridge answers,
 * a 10 second timeout that becomes an error state), checks origin, source window and
 * nonce on every message, and hands typed events to the workspace. Modelled on
 * src/visual/useBridge.ts, plus the engine's own messages: the NodeRef map behind every
 * element id, the selected element's computed style, and the stylesheet refresh.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { BRIDGE_MESSAGE_TYPES, BUILDER_PROTOCOL_VERSION, VISUAL_PROTOCOL_VERSION, editUrl, type BridgeToEditor, type EditorToBridge, type RichTextState, type SlotInfo } from "../../shared/visualProtocol.ts";
import type { Connection } from "../../src/visual/useBridge.ts";
import type { NodeRef, RichRun } from "../shared/types.ts";

/** The first page of a freshly started Vite dev server compiles on demand, which can take well over ten seconds. */
const ENGINE_HANDSHAKE_TIMEOUT_MS = 90_000;

/** What the bridge knows about one element: its NodeRef plus the DOM facts the panel shows before the server answers. */
export type EngineNodeInfo = NodeRef & { text: string; src: string | null; alt: string | null; href: string | null; className: string };

export type EngineNodesMessage = { type: "armature:engine:nodes"; nonce: string; nodes: Record<string, EngineNodeInfo> };
export type EngineComputedMessage = { type: "armature:engine:computed"; nonce: string; id: string | null; computed: Record<string, string> };
/** The engine bridge sends rich runs for inline editing, never a string. */
export type EngineEditMessage = { type: "armature:element:edit:start" | "armature:element:edit:input" | "armature:element:edit:commit"; nonce: string; id: string; value: RichRun[] };
export type EngineReadyExtras = { tailwind?: boolean; slots?: SlotInfo[] };

/** Every message the engine bridge can send. The kit's shapes are reused where they match. */
export type EngineBridgeMessage = Exclude<BridgeToEditor, { type: "armature:element:edit:start" | "armature:element:edit:input" | "armature:element:edit:commit" }> | EngineEditMessage | EngineNodesMessage | EngineComputedMessage;

type WithoutNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
export type EngineOutgoing = WithoutNonce<EditorToBridge> | { type: "armature:engine:css"; path: string } | { type: "armature:engine:refresh" };

export type { Connection, RichTextState };

const HELLO_INTERVAL_MS = 250;
const ENGINE_TYPES = ["armature:engine:nodes", "armature:engine:computed"] as const;

function isEngineMessage(value: unknown): value is EngineBridgeMessage {
  if (!value || typeof value !== "object") return false;
  const record = value as { type?: unknown; nonce?: unknown };
  if (typeof record.type !== "string" || typeof record.nonce !== "string") return false;
  return (BRIDGE_MESSAGE_TYPES as readonly string[]).includes(record.type) || (ENGINE_TYPES as readonly string[]).includes(record.type);
}

export function useEngineBridge(opts: { previewUrl: string | null; onMessage: (message: EngineBridgeMessage) => void }) {
  const { previewUrl } = opts;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handlerRef = useRef(opts.onMessage);
  useEffect(() => {
    handlerRef.current = opts.onMessage;
  });

  const siteOrigin = useMemo(() => {
    if (!previewUrl) return null;
    try {
      return new URL(previewUrl).origin;
    } catch {
      return null;
    }
  }, [previewUrl]);

  const [connection, setConnection] = useState<Connection>(() =>
    !previewUrl || !siteOrigin
      ? { status: "error", kind: "bad_url", title: "The preview has no address", message: `"${previewUrl ?? ""}" is not a URL the editor can open.`, fix: "Restart the engine server and open the site again." }
      : { status: "loading" },
  );
  /** True when the preview's stylesheets come from Tailwind (classes take effect); from the ready message. */
  const [tailwind, setTailwind] = useState<boolean | null>(null);
  const nonceRef = useRef("");
  const timers = useRef<{ hello: number; timeout: number }>({ hello: 0, timeout: 0 });
  const [attempt, setAttempt] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const editorOrigin = typeof window !== "undefined" ? window.location.origin : "";

  const clearTimers = () => {
    window.clearInterval(timers.current.hello);
    window.clearTimeout(timers.current.timeout);
    timers.current = { hello: 0, timeout: 0 };
  };

  const send = useCallback(
    (message: EngineOutgoing) => {
      const target = iframeRef.current?.contentWindow;
      if (!target || !siteOrigin || !nonceRef.current) return;
      target.postMessage({ ...message, nonce: nonceRef.current }, siteOrigin);
    },
    [siteOrigin],
  );

  /** Called by the iframe's onLoad: a fresh nonce and a fresh handshake for this document. */
  const beginHandshake = useCallback(() => {
    if (!siteOrigin) return;
    clearTimers();
    nonceRef.current = crypto.randomUUID();
    setConnection({ status: "connecting" });
    const hello = () => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      target.postMessage({ type: "armature:hello", nonce: nonceRef.current, protocolVersion: VISUAL_PROTOCOL_VERSION, wants: BUILDER_PROTOCOL_VERSION } satisfies EditorToBridge, siteOrigin);
    };
    hello();
    timers.current.hello = window.setInterval(hello, HELLO_INTERVAL_MS);
    timers.current.timeout = window.setTimeout(() => {
      clearTimers();
      setConnection({
        status: "error",
        kind: "timeout",
        title: "The preview did not answer",
        message: "The page loaded but the engine bridge did not answer within 90 seconds. The preview may have failed to start, or the engine server's allowed editor origins do not include this dashboard.",
        fix: `Check the engine server's log. It must allow the origin ${editorOrigin}.`,
      });
    }, ENGINE_HANDSHAKE_TIMEOUT_MS);
  }, [siteOrigin, editorOrigin]);

  useEffect(() => {
    if (!siteOrigin) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== siteOrigin) return;
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (!isEngineMessage(event.data) || event.data.nonce !== nonceRef.current) return;
      const message = event.data;
      if (message.type === "armature:ready") {
        clearTimers();
        if (message.protocolVersion !== VISUAL_PROTOCOL_VERSION && message.protocolVersion !== BUILDER_PROTOCOL_VERSION) {
          setConnection({ status: "error", kind: "protocol", title: "The engine bridge is a different version", message: `The preview speaks protocol ${message.protocolVersion} (bridge ${message.bridgeVersion}); this editor speaks ${BUILDER_PROTOCOL_VERSION}.`, fix: "Update the engine server and the dashboard together." });
          return;
        }
        const extras = message as typeof message & EngineReadyExtras;
        setTailwind(typeof extras.tailwind === "boolean" ? extras.tailwind : null);
        setConnection({ status: "ready", bridgeVersion: message.bridgeVersion, protocol: 2, kitVersion: message.kitVersion ?? null, sections: message.sections ?? [], slots: message.slots ?? [], layouts: message.layouts ?? [] });
      }
      handlerRef.current(message);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimers();
    };
  }, [siteOrigin]);

  /** Load a page path into the frame (a full document load, which restarts the handshake). */
  const load = useCallback(
    (pagePath: string) => {
      if (!previewUrl || !siteOrigin) return;
      clearTimers();
      nonceRef.current = "";
      setConnection({ status: "loading" });
      setSrc(editUrl(previewUrl, pagePath));
      setAttempt((count) => count + 1);
    },
    [previewUrl, siteOrigin],
  );

  return { iframeRef: iframeRef as RefObject<HTMLIFrameElement>, connection, tailwind, src, attempt, send, load, beginHandshake, siteOrigin, editorOrigin };
}
