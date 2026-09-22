/**
 * Why the visual editor cannot show a site: fetch the live URL and read the two
 * headers that stop a page from being framed. Pure apart from the one fetch, which
 * is passed in so it can be tested.
 *
 * SERVER ONLY, but it uses no secrets: the live URL is public, and the request
 * carries no credentials.
 */
import type { EmbedCheckResponse } from "../../../shared/publishTypes.ts";
import { ArmatureError } from "./errors.ts";

/** The frame-ancestors directive of a Content-Security-Policy header, or null. */
export function frameAncestorsOf(csp: string | null): string | null {
  if (!csp) return null;
  for (const directive of csp.split(";")) {
    const trimmed = directive.trim();
    if (/^frame-ancestors\b/i.test(trimmed)) return trimmed.replace(/^frame-ancestors\s*/i, "").trim() || "'none'";
  }
  return null;
}

/** Only public http(s) addresses may be fetched. Refuses loopback, link-local and private ranges. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ArmatureError("invalid", `"${raw}" is not a valid site address.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ArmatureError("invalid", `The site address must start with https:// or http://, got "${url.protocol}".`);
  }
  const host = url.hostname.toLowerCase();
  const blocked = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "0.0.0.0" || host === "::1" || host === "[::1]" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^\[?f[cd][0-9a-f]{2}:/i.test(host) || /^\[?fe80:/i.test(host);
  if (blocked) {
    throw new ArmatureError("invalid", `The site address "${host}" is a private or local address, which the dashboard will not fetch.`);
  }
  return url;
}

export async function checkEmbed(
  liveUrl: string,
  fetchImpl: (url: string, init: RequestInit) => Promise<Response> = fetch,
  timeoutMs = 8000,
): Promise<EmbedCheckResponse> {
  const url = assertPublicUrl(liveUrl).toString();
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "text/html", "user-agent": "Armature embed check" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // The body is not needed; let the connection go.
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    return {
      ok: true,
      url,
      reachable: true,
      status: response.status,
      xFrameOptions: response.headers.get("x-frame-options"),
      frameAncestors: frameAncestorsOf(response.headers.get("content-security-policy")),
    };
  } catch (error) {
    return {
      ok: true,
      url,
      reachable: false,
      status: null,
      xFrameOptions: null,
      frameAncestors: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
