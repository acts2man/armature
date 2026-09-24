/**
 * Environment variables for the preview. A site lists the public values it needs in
 * .env.example (Supabase URL and anon key, say); Armature keeps a per-site list of
 * values; the preview gets the union of the site's committed .env, the per-site values
 * and the process environment, and reports plainly which required keys are still missing.
 */
import { envKeys } from "./detect.ts";

export type EnvReport = { required: string[]; missing: string[]; values: Record<string, string> };

/** Only public, VITE_-style keys and the ones the example names are handed to the preview. */
export function resolveEnv(opts: { example: string; committed: string; provided: Record<string, string> }): EnvReport {
  const required = envKeys(opts.example);
  const values: Record<string, string> = {};
  for (const line of opts.committed.split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match && match[1]) values[match[1]] = unquote(match[2] ?? "");
  }
  for (const [key, value] of Object.entries(opts.provided)) {
    if (value.trim()) values[key] = value.trim();
  }
  const missing = required.filter((key) => !values[key]);
  return { required, missing, values };
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

export function missingEnvMessage(missing: string[], siteName: string): string {
  const list = missing.join(", ");
  return missing.length === 1
    ? `The preview needs one environment value that is not set: ${list}. Add it under the site's Preview settings (it is a public value the site's own .env.example lists) and open the editor again. Site: ${siteName}.`
    : `The preview needs ${missing.length} environment values that are not set: ${list}. Add them under the site's Preview settings (they are public values the site's own .env.example lists) and open the editor again. Site: ${siteName}.`;
}
