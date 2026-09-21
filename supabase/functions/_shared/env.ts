/**
 * Environment access. Functions read `Deno.env` once at request time and pass a
 * plain object down, so every module below this one is testable with a literal.
 */
export type Env = Record<string, string | undefined>;

export function denoEnv(): Env {
  return Deno.env.toObject();
}

/** Trimmed value or empty string. Never throws. */
export function envValue(env: Env, key: string): string {
  return env[key]?.trim() ?? "";
}
