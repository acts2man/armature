/**
 * The editor's side of the bridge: owns the iframe handshake, verifies every message
 * (origin, source window, nonce), times the handshake out after 10 seconds and then
 * explains what went wrong, and hands typed events to the workspace.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { callFunction } from "@/lib/functions.ts";
import type { EmbedCheckResponse } from "@shared/publishTypes.ts";
import {
  BUILDER_PROTOCOL_VERSION,
  HANDSHAKE_TIMEOUT_MS,
  VISUAL_PROTOCOL_VERSION,
  editUrl,
  isBridgeMessage,
  type BridgeToEditor,
  type EditorToBridge,
  type ProtocolVersion,
  type SiteSectionInfo,
  type SlotInfo,
} from "@shared/visualProtocol.ts";

export type ConnectionErrorKind = "no_live_url" | "bad_url" | "timeout" | "blocked" | "unreachable" | "protocol";

export type Connection =
  | { status: "loading" }
  | { status: "connecting" }
  | {
      status: "ready";
      bridgeVersion: string;
      /** 1: a v1.1 bridge (content editing only). 2: a v2 kit (the page builder). */
      protocol: ProtocolVersion;
      kitVersion: string | null;
      sections: SiteSectionInfo[];
      slots: SlotInfo[];
      /** Slugs of the layouts the site was built with. */
      layouts: string[];
    }
  | { status: "error"; kind: ConnectionErrorKind; title: string; message: string; fix?: string; snippet?: string };

const HELLO_INTERVAL_MS = 250;

/** Omit that distributes over a union, so each message keeps its own payload. */
type WithoutNonce<T> = T extends unknown ? Omit<T, "nonce"> : never;
export type OutgoingMessage = WithoutNonce<EditorToBridge>;

export type BridgeHandlers = {
  onMessage: (message: BridgeToEditor) => void;
};

export function useBridge(opts: { liveUrl: string | null; siteId: string; handlers: BridgeHandlers }) {
  const { liveUrl, siteId } = opts;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handlersRef = useRef(opts.handlers);
  useEffect(() => {
    handlersRef.current = opts.handlers;
  });

  const siteOrigin = useMemo(() => {
    if (!liveUrl) return null;
    try {
      return new URL(liveUrl).origin;
    } catch {
      return null;
    }
  }, [liveUrl]);

  const initialConnection: Connection = !liveUrl
    ? {
        status: "error",
        kind: "no_live_url",
        title: "This site has no live address yet",
        message: "The visual editor shows the live website, and this site does not have a live URL on record.",
        fix: "The agency adds the live URL under Projects. Until then, the page editor works as usual.",
      }
    : !siteOrigin
      ? {
          status: "error",
          kind: "bad_url",
          title: "The site's live address is not a valid URL",
          message: `"${liveUrl}" cannot be opened. It should look like https://www.example.com.`,
          fix: "The agency can correct it under Projects.",
        }
      : { status: "loading" };

  const [connection, setConnection] = useState<Connection>(initialConnection);
  const nonceRef = useRef<string>("");
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
    (message: OutgoingMessage) => {
      const target = iframeRef.current?.contentWindow;
      if (!target || !siteOrigin || !nonceRef.current) return;
      target.postMessage({ ...message, nonce: nonceRef.current } as EditorToBridge, siteOrigin);
    },
    [siteOrigin],
  );

  /** Turn a handshake timeout into a precise explanation. */
  const diagnose = useCallback(async () => {
    let check: EmbedCheckResponse | null = null;
    try {
      const result = await callFunction<EmbedCheckResponse>("site-embed-check", { site_id: siteId });
      if (result.ok) check = result;
    } catch {
      check = null;
    }
    const allowsUs = (ancestors: string | null) => ancestors !== null && ancestors.split(/\s+/).some((token) => token === editorOrigin || token === "*" || token === `${editorOrigin}/`);
    if (check && !check.reachable) {
      setConnection({
        status: "error",
        kind: "unreachable",
        title: "The site did not answer",
        message: `The dashboard could not reach ${check.url}${check.error ? ` (${check.error})` : ""}.`,
        fix: "Check that the site is online and that its live URL is right. Until then, use the page editor.",
      });
      return;
    }
    if (check && check.reachable && check.status !== null && check.status >= 400) {
      setConnection({
        status: "error",
        kind: "unreachable",
        title: `The site answered with HTTP ${check.status}`,
        message: `${check.url} did not return a page.`,
        fix: "Check the site's live URL. Until then, use the page editor.",
      });
      return;
    }
    if (check && (check.xFrameOptions || (check.frameAncestors && !allowsUs(check.frameAncestors)))) {
      const header = check.xFrameOptions ? `X-Frame-Options: ${check.xFrameOptions}` : `Content-Security-Policy: frame-ancestors ${check.frameAncestors}`;
      setConnection({
        status: "error",
        kind: "blocked",
        title: "The site refuses to be shown inside the editor",
        message: `It sends the header "${header}", which tells browsers not to display it in a frame.`,
        fix: `Ask the site's developer to ${check.xFrameOptions ? "remove X-Frame-Options and " : ""}send this header instead:`,
        snippet: `Content-Security-Policy: frame-ancestors 'self' ${editorOrigin}`,
      });
      return;
    }
    setConnection({
      status: "error",
      kind: "timeout",
      title: "This site isn't set up for visual editing yet",
      message: "The site loaded but did not answer the editor within 10 seconds. Either it does not include the visual-editing bridge, or its list of allowed editor origins does not include this dashboard.",
      fix: `Use the page editor instead. To enable visual editing, the site's developer adds the bridge file and allows the origin ${editorOrigin} (docs/SITE_CONTRACT.md, "Site contract v1.1").`,
    });
  }, [siteId, editorOrigin]);

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
      void diagnose();
    }, HANDSHAKE_TIMEOUT_MS);
  }, [siteOrigin, diagnose]);

  useEffect(() => {
    if (!siteOrigin) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== siteOrigin) return;
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (!isBridgeMessage(event.data) || event.data.nonce !== nonceRef.current) return;
      const message = event.data;
      if (message.type === "armature:ready") {
        clearTimers();
        if (message.protocolVersion !== VISUAL_PROTOCOL_VERSION && message.protocolVersion !== BUILDER_PROTOCOL_VERSION) {
          setConnection({
            status: "error",
            kind: "protocol",
            title: "The site's bridge is a different version",
            message: `The site speaks visual-editing protocol ${message.protocolVersion} (bridge ${message.bridgeVersion}); this editor speaks ${VISUAL_PROTOCOL_VERSION}.`,
            fix: "Ask the site's developer to update bridge/armature-bridge.ts from the Armature repository. Until then, use the page editor.",
          });
          return;
        }
        setConnection({
          status: "ready",
          bridgeVersion: message.bridgeVersion,
          protocol: message.protocolVersion === BUILDER_PROTOCOL_VERSION ? 2 : 1,
          kitVersion: message.kitVersion ?? null,
          sections: message.sections ?? [],
          slots: message.slots ?? [],
          layouts: message.layouts ?? [],
        });
      } else if (message.type === "armature:error" && message.code === "protocol_mismatch") {
        clearTimers();
        setConnection({
          status: "error",
          kind: "protocol",
          title: "The site's bridge is a different version",
          message: message.message,
          fix: "Ask the site's developer to update bridge/armature-bridge.ts from the Armature repository. Until then, use the page editor.",
        });
        return;
      }
      handlersRef.current.onMessage(message);
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
      if (!liveUrl || !siteOrigin) return;
      clearTimers();
      nonceRef.current = "";
      setConnection({ status: "loading" });
      setSrc(editUrl(liveUrl, pagePath));
      setAttempt((count) => count + 1);
    },
    [liveUrl, siteOrigin],
  );

  return { iframeRef: iframeRef as RefObject<HTMLIFrameElement>, connection, src, attempt, send, load, beginHandshake, siteOrigin, editorOrigin };
}
