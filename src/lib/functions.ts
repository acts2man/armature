/**
 * Typed, never-throwing calls to the edge functions.
 *
 * Every function answers `{ ok: true, ... }` or `{ ok: false, code, message }`. This
 * wrapper also turns the failures that never reach a function — not deployed,
 * sign-in rejected at the gateway, network down — into the same shape, so a screen
 * can always render `message` and there is no silent state.
 */
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { isFailure, type Failure, type FailureCode } from "@shared/publishTypes.ts";
import { supabase } from "./supabase.ts";

export type { Failure } from "@shared/publishTypes.ts";
export { isFailure } from "@shared/publishTypes.ts";

export type FunctionName =
  | "github-setup"
  | "site-connect"
  | "content-get"
  | "content-publish"
  | "site-diagnose"
  | "invite-create"
  | "invite-accept"
  | "client-create"
  | "password-set"
  | "client-password-reset"
  | "content-publish-batch"
  | "site-embed-check"
  | "builder-publish"
  | "kit-status";

const failure = (code: FailureCode, message: string): Failure => ({ ok: false, code, message });

function readMessage(parsed: unknown): string {
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of ["message", "error", "msg"]) {
      if (typeof record[key] === "string" && record[key]) return record[key] as string;
    }
  }
  return "";
}

export async function callFunction<T extends { ok: true }>(
  name: FunctionName,
  body: unknown,
): Promise<T | Failure> {
  let response: { data: unknown; error: unknown };
  try {
    response = await supabase.functions.invoke<unknown>(name, { body: body as Record<string, unknown> });
  } catch (error) {
    return failure("github_error", `Could not call "${name}": ${error instanceof Error ? error.message : String(error)}`);
  }

  const { data, error } = response;
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context?.status ?? 0;
      let parsed: unknown;
      try {
        parsed = await error.context.json();
      } catch {
        parsed = undefined;
      }
      if (isFailure(parsed)) return parsed;
      const detail = readMessage(parsed);
      if (status === 401) {
        return failure(
          "forbidden",
          `The server did not accept your sign-in${detail ? ` (${detail})` : ""}. Sign out and sign in again.`,
        );
      }
      if (status === 404) {
        return failure(
          "not_configured",
          `The "${name}" function is not deployed to this Supabase project. Deploy the edge functions (docs/SETUP.md, part C).`,
        );
      }
      return failure("github_error", `The "${name}" function answered with HTTP ${status}${detail ? `: ${detail}` : ""}.`);
    }
    if (error instanceof FunctionsRelayError) {
      return failure("github_error", `The Supabase function relay refused the call to "${name}": ${error.message}`);
    }
    if (error instanceof FunctionsFetchError) {
      return failure(
        "github_error",
        `Could not reach the server for "${name}". Check your internet connection, and that VITE_SUPABASE_URL points at the right project.`,
      );
    }
    return failure("github_error", error instanceof Error ? error.message : String(error));
  }

  if (!data || typeof data !== "object") {
    return failure("github_error", `The "${name}" function returned an empty reply.`);
  }
  if (isFailure(data)) return data;
  if ((data as { ok?: unknown }).ok !== true) {
    return failure("github_error", `The "${name}" function returned an unexpected reply.`);
  }
  return data as T;
}
