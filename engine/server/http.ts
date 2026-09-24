/**
 * Small helpers over node:http: CORS for the editor origins, JSON bodies with a size
 * cap (image uploads travel as base64, so the cap is generous), and JSON replies.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_BODY_BYTES = 25 * 1024 * 1024;

export class BodyError extends Error {}

/** Set the CORS headers when the request's Origin is one of the allowed editor origins. */
export function applyCors(request: IncomingMessage, response: ServerResponse, origins: string[]): void {
  const origin = request.headers.origin;
  if (!origin) return;
  const allowed = origins.some((candidate) => candidate === origin || candidate === "*");
  if (!allowed) return;
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  response.setHeader("Access-Control-Max-Age", "600");
}

export function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  const text = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(text));
  response.end(text);
}

/** Read and parse a JSON body. An empty body is {}. Throws BodyError on bad or oversized input. */
export function readJson(request: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyError(`The request body is larger than ${Math.round(limit / 1024 / 1024)} MB.`));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", (error) => reject(new BodyError(error.message)));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return reject(new BodyError("The request body must be a JSON object."));
        resolve(parsed as Record<string, unknown>);
      } catch (error) {
        reject(new BodyError(`The request body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

/** A required string field of a JSON body, or a BodyError naming it. */
export function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || !value) throw new BodyError(`"${name}" is required.`);
  return value;
}
