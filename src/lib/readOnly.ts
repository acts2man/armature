/**
 * "View as client" must never save anything. Rather than teaching every screen about it,
 * the one Supabase client the browser uses (src/lib/supabase.ts) runs every request through
 * `blocksWrite` while a view-as session is on: reads go through untouched, writes are
 * answered locally with a readable refusal, and the person's own session is never touched
 * (auth calls always pass, so tokens still refresh and sign-out still works).
 */

/** Edge functions that only read, even though every function is called with POST. */
const READ_ONLY_FUNCTIONS = new Set(["content-get", "site-embed-check"]);

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** True when a request would change something and so must not leave the browser in a read-only view. */
export function blocksWrite(url: string, method: string): boolean {
  if (READ_METHODS.has(method.toUpperCase())) return false;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return true;
  }
  // The person's own session: token refresh, sign-out.
  if (path.startsWith("/auth/v1/")) return false;
  if (path.startsWith("/functions/v1/")) {
    const name = path.slice("/functions/v1/".length).split("/")[0] ?? "";
    return !READ_ONLY_FUNCTIONS.has(name);
  }
  // Signed URLs for attachments are a read.
  if (path.startsWith("/storage/v1/object/sign/")) return false;
  return true;
}

/** The refusal a blocked write is answered with: the same envelope the edge functions use, so every screen renders `message`. */
export function readOnlyResponse(message: string): Response {
  return new Response(JSON.stringify({ ok: false, code: "forbidden", message, fields: [] }), {
    status: 403,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
