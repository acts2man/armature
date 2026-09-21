/**
 * Request and response plumbing shared by every edge function.
 */
import { ArmatureError, toFailure } from "./errors.ts";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Parse the request body as a JSON object, or explain what was wrong with it. */
export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    throw new ArmatureError("invalid", "The request body was not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ArmatureError("invalid", "The request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ArmatureError("invalid", `Missing "${key}" in the request.`);
  }
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ArmatureError("invalid", `"${key}" must be text.`);
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUuid(body: Record<string, unknown>, key: string): string {
  const value = requireString(body, key);
  if (!UUID_PATTERN.test(value)) throw new ArmatureError("invalid", `"${key}" is not a valid id.`);
  return value;
}

/**
 * Wrap a handler so that every outcome is an HTTP 200 JSON envelope and CORS
 * preflights are answered. Nothing escapes as an unstructured 500.
 */
export function serveJson(handler: (req: Request) => Promise<unknown>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (req.method !== "POST") {
      return json({ ok: false, code: "invalid", message: "Use POST." }, 405);
    }
    try {
      return json(await handler(req));
    } catch (error) {
      return json(toFailure(error));
    }
  };
}
