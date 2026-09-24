/**
 * The code engine is a proof of concept behind a flag, so the product stays unchanged
 * for everyone else. Turn it on with ?engine=1 on any dashboard URL (which remembers it
 * in localStorage) or by setting localStorage "armature:engine" to "1". The engine
 * server's address can be overridden with localStorage "armature:engine:url".
 */
import { DEFAULT_ENGINE_URL } from "./shared/api.ts";

export const ENGINE_FLAG_KEY = "armature:engine";
export const ENGINE_URL_KEY = "armature:engine:url";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** True when the engine editor may be shown. A ?engine=1 in the URL switches it on for good. */
export function isEngineEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("engine") === "1") {
      try {
        localStorage.setItem(ENGINE_FLAG_KEY, "1");
      } catch {
        // storage unavailable: the flag holds for this URL only
      }
      return true;
    }
  } catch {
    // an odd URL: fall back to the stored flag
  }
  return read(ENGINE_FLAG_KEY) === "1";
}

/** The engine server's base URL, without a trailing slash. */
export function engineUrl(): string {
  const stored = read(ENGINE_URL_KEY)?.trim();
  return (stored && stored.length > 0 ? stored : DEFAULT_ENGINE_URL).replace(/\/+$/, "");
}
