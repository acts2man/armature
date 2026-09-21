/**
 * Invite tokens: random, URL-safe, and stored only as a SHA-256 hash.
 */
import { bytesToBase64Url } from "../../../shared/base64.ts";

export function generateInviteToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Where the dashboard lives, for links in invites. APP_URL wins; else the request's Origin. */
export function appBaseUrl(env: Record<string, string | undefined>, req: Request): string {
  const configured = env["APP_URL"]?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const origin = req.headers.get("origin")?.trim();
  if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/+$/, "");
  return "";
}
