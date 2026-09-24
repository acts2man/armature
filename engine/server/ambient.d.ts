/**
 * The engine imports supabase/functions/_shared/githubRepo.ts, whose neighbours are
 * written for Deno. Only `denoEnv()` touches the Deno global, and the engine never
 * calls it, but the type checker still needs to know the name exists.
 */
declare const Deno: { env: { toObject(): Record<string, string> } };
