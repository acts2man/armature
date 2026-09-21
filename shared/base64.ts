/**
 * Base64 helpers that work identically in the browser, Node and Deno.
 * Pure module.
 */

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}

export function isValidBase64(value: string): boolean {
  const clean = stripWhitespace(value);
  return clean.length % 4 === 0 && BASE64_PATTERN.test(clean);
}

/** Decoded byte length of a base64 string, without decoding it. */
export function base64ByteLength(value: string): number {
  const clean = stripWhitespace(value);
  if (clean.length === 0) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return (clean.length / 4) * 3 - padding;
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(stripWhitespace(value));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToUtf8(value: string): string {
  return new TextDecoder("utf-8").decode(base64ToBytes(value));
}

export function utf8ToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

/** URL-safe base64 without padding, as used in JWTs and invite tokens. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}
