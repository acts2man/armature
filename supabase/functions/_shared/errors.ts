/**
 * The one error type the edge functions throw on purpose. Every handler catches
 * it and answers HTTP 200 with `{ ok: false, code, message }`, so the browser
 * always has something readable to show. Messages never contain a secret.
 */
import type { ConflictItem, Failure, FailureCode } from "../../../shared/publishTypes.ts";

export class ArmatureError extends Error {
  readonly code: FailureCode;
  /** For conflicts: the human labels of the fields someone else changed. */
  readonly fields: string[];
  /** For builder conflicts: each element or value both sides changed, for the person to choose. */
  readonly conflicts: ConflictItem[];

  constructor(code: FailureCode, message: string, fields: string[] = [], conflicts: ConflictItem[] = []) {
    super(message);
    this.name = "ArmatureError";
    this.code = code;
    this.fields = fields;
    this.conflicts = conflicts;
  }
}

/** Narrow an unknown thrown value into the failure envelope. */
export function toFailure(error: unknown): Failure {
  if (error instanceof ArmatureError) {
    return { ok: false, code: error.code, message: error.message, fields: error.fields, ...(error.conflicts.length > 0 ? { conflicts: error.conflicts } : {}) };
  }
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  console.error("[armature] unexpected failure:", message);
  return {
    ok: false,
    code: "github_error",
    message: `Unexpected error: ${message}. Use "Check connection" for details.`,
    fields: [],
  };
}
