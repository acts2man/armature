/**
 * GitHub App authentication, with no dependencies beyond Web Crypto.
 *
 * SERVER ONLY. This is the only module that ever sees GITHUB_APP_PRIVATE_KEY.
 *
 * Flow: the App's private key signs a short-lived RS256 JWT (the "app JWT"); the
 * app JWT asks GitHub which installation covers a repository and mints an
 * installation access token for it (valid one hour, scoped here to one repository
 * and to Contents read/write + Metadata read). Everything that touches a
 * repository then uses that installation token.
 */
import { base64ToBytes, bytesToBase64Url, utf8ToBase64Url } from "../../../shared/base64.ts";
import { ArmatureError } from "./errors.ts";
import { envValue, type Env } from "./env.ts";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_API_VERSION = "2022-11-28";
export const USER_AGENT = "armature-dashboard";

export type AppConfig = {
  appId: string;
  /** PEM text, PKCS#1 ("BEGIN RSA PRIVATE KEY") or PKCS#8 ("BEGIN PRIVATE KEY"). */
  privateKeyPem: string;
  slug: string;
};

/** What is known about the App environment, with no secret values. */
export type AppEnvReport = {
  appIdPresent: boolean;
  privateKeyPresent: boolean;
  privateKeyLength: number;
  slugPresent: boolean;
  missing: string[];
};

export function describeAppEnv(env: Env): AppEnvReport {
  const appId = envValue(env, "GITHUB_APP_ID");
  const key = envValue(env, "GITHUB_APP_PRIVATE_KEY");
  const slug = envValue(env, "GITHUB_APP_SLUG");
  const missing: string[] = [];
  if (!appId) missing.push("GITHUB_APP_ID");
  if (!key) missing.push("GITHUB_APP_PRIVATE_KEY");
  if (!slug) missing.push("GITHUB_APP_SLUG");
  return {
    appIdPresent: appId.length > 0,
    privateKeyPresent: key.length > 0,
    privateKeyLength: key.length,
    slugPresent: slug.length > 0,
    missing,
  };
}

/** Read the three GitHub App secrets, naming the missing one instead of failing silently. */
export function loadAppConfig(env: Env): AppConfig {
  const report = describeAppEnv(env);
  if (report.missing.length > 0) {
    throw new ArmatureError(
      "not_configured",
      `GitHub publishing is not configured: missing ${report.missing.join(", ")}. Add it under Edge Functions → Secrets in Supabase (docs/SETUP.md, part B).`,
    );
  }
  return {
    appId: envValue(env, "GITHUB_APP_ID"),
    privateKeyPem: normalizePrivateKey(envValue(env, "GITHUB_APP_PRIVATE_KEY")),
    slug: envValue(env, "GITHUB_APP_SLUG"),
  };
}

// --- PEM handling ---------------------------------------------------------------

/**
 * Accept the key as GitHub downloads it, as a base64-encoded copy of that file, or
 * with literal "\n" sequences (which some secret stores produce). Returns PEM text.
 */
export function normalizePrivateKey(raw: string): string {
  let text = raw.trim();
  if (!text.includes("-----BEGIN")) {
    try {
      text = new TextDecoder().decode(base64ToBytes(text)).trim();
    } catch {
      throw new ArmatureError(
        "not_configured",
        "GITHUB_APP_PRIVATE_KEY is not a PEM private key (it should start with -----BEGIN RSA PRIVATE KEY-----) and is not base64 of one.",
      );
    }
  }
  text = text.replace(/\\n/g, "\n").replace(/\r/g, "");
  if (!text.includes("-----BEGIN")) {
    throw new ArmatureError(
      "not_configured",
      "GITHUB_APP_PRIVATE_KEY does not look like a PEM private key.",
    );
  }
  return text;
}

const PEM_PATTERN = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/;

function derLength(length: number): number[] {
  if (length < 0x80) return [length];
  const bytes: number[] = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

/** Wrap a PKCS#1 RSAPrivateKey in the PKCS#8 PrivateKeyInfo envelope Web Crypto needs. */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  const algorithm = [
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ];
  const octetString = [0x04, ...derLength(pkcs1.length)];
  const bodyLength = version.length + algorithm.length + octetString.length + pkcs1.length;
  const header = [0x30, ...derLength(bodyLength)];
  const out = new Uint8Array(header.length + bodyLength);
  let offset = 0;
  for (const part of [header, version, algorithm, octetString]) {
    out.set(part, offset);
    offset += part.length;
  }
  out.set(pkcs1, offset);
  return out;
}

/** PEM text → PKCS#8 DER bytes, converting from PKCS#1 when needed. */
export function pemToPkcs8(pem: string): Uint8Array {
  const match = PEM_PATTERN.exec(pem);
  if (!match) {
    throw new ArmatureError(
      "not_configured",
      "GITHUB_APP_PRIVATE_KEY is not a complete PEM block (BEGIN ... END).",
    );
  }
  const label = match[1] ?? "";
  const body = (match[2] ?? "").replace(/\s+/g, "");
  let der: Uint8Array;
  try {
    der = base64ToBytes(body);
  } catch {
    throw new ArmatureError("not_configured", "GITHUB_APP_PRIVATE_KEY contains invalid base64.");
  }
  if (label === "RSA PRIVATE KEY") return pkcs1ToPkcs8(der);
  if (label === "PRIVATE KEY") return der;
  throw new ArmatureError(
    "not_configured",
    `GITHUB_APP_PRIVATE_KEY is a "${label}" block; expected an RSA PRIVATE KEY (as GitHub downloads it).`,
  );
}

export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const der = pemToPkcs8(pem);
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der as BufferSource,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ArmatureError(
      "not_configured",
      `GITHUB_APP_PRIVATE_KEY could not be read as an RSA key (${detail}). Generate a new private key for the App and paste the whole .pem file.`,
    );
  }
}

// --- App JWT -------------------------------------------------------------------------

/**
 * A GitHub App JWT: RS256, issued a minute in the past to absorb clock skew, valid
 * for nine minutes (GitHub allows at most ten).
 */
export async function createAppJwt(config: AppConfig, now: number = Date.now()): Promise<string> {
  const key = await importPrivateKey(config.privateKeyPem);
  const seconds = Math.floor(now / 1000);
  const header = utf8ToBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = utf8ToBase64Url(
    JSON.stringify({ iat: seconds - 60, exp: seconds + 9 * 60, iss: config.appId }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

// --- calls made with the app JWT ---------------------------------------------------

export type GithubAccount = { login: string; type: string };

export type InstallationInfo = {
  id: number;
  account: GithubAccount;
  suspended: boolean;
  /** "all" or "selected" */
  repositorySelection: string;
  permissions: Record<string, string>;
};

/** Remove a secret from any text before it can reach a log or a user. */
export function redact(text: string, ...secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out;
}

async function githubJson<T>(
  fetchImpl: typeof fetch,
  auth: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ status: number; ok: boolean; body: T | undefined; message: string }> {
  let response: Response;
  try {
    response = await fetchImpl(`${GITHUB_API}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${auth}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": USER_AGENT,
        ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { status: 0, ok: false, body: undefined, message: `Could not reach GitHub: ${redact(detail, auth)}` };
  }
  const raw = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  let message = response.statusText || `HTTP ${response.status}`;
  if (body && typeof body === "object" && "message" in body) {
    message = String((body as { message: unknown }).message);
  }
  return { status: response.status, ok: response.ok, body: body as T, message: redact(message, auth) };
}

function readInstallation(body: unknown): InstallationInfo | undefined {
  if (!body || typeof body !== "object") return undefined;
  const raw = body as Record<string, unknown>;
  if (typeof raw["id"] !== "number") return undefined;
  const account = (raw["account"] ?? {}) as Record<string, unknown>;
  return {
    id: raw["id"],
    account: {
      login: typeof account["login"] === "string" ? account["login"] : "",
      type: typeof account["type"] === "string" ? account["type"] : "",
    },
    suspended: Boolean(raw["suspended_at"]),
    repositorySelection:
      typeof raw["repository_selection"] === "string" ? raw["repository_selection"] : "",
    permissions: (raw["permissions"] ?? {}) as Record<string, string>,
  };
}

/** The installation that covers a repository, or a readable reason there is none. */
export async function findInstallationForRepo(
  config: AppConfig,
  owner: string,
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; installation?: InstallationInfo; message: string }> {
  const jwt = await createAppJwt(config);
  const result = await githubJson(fetchImpl, jwt, `/repos/${owner}/${repo}/installation`);
  if (!result.ok) return { status: result.status, message: result.message };
  const installation = readInstallation(result.body);
  if (!installation) return { status: result.status, message: "GitHub returned an unexpected installation shape." };
  return { status: result.status, installation, message: result.message };
}

export async function getInstallation(
  config: AppConfig,
  installationId: number,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; installation?: InstallationInfo; message: string }> {
  const jwt = await createAppJwt(config);
  const result = await githubJson(fetchImpl, jwt, `/app/installations/${installationId}`);
  if (!result.ok) return { status: result.status, message: result.message };
  const installation = readInstallation(result.body);
  if (!installation) return { status: result.status, message: "GitHub returned an unexpected installation shape." };
  return { status: result.status, installation, message: result.message };
}

export type InstallationToken = {
  token: string;
  expiresAt: string;
  /**
   * The permissions GitHub actually granted the token, from the access_tokens
   * response (for example `{ contents: "write", metadata: "read" }`). This is the
   * reliable signal for what the token can do: the `permissions.push` flag on
   * GET /repos/{owner}/{repo} is not trustworthy for App installation tokens.
   */
  permissions: Record<string, string>;
};

/**
 * Mint a one-hour installation token limited to one repository and to the two
 * permissions the App needs. Throws an ArmatureError the caller can show.
 */
export async function mintInstallationToken(
  config: AppConfig,
  installationId: number,
  repoName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstallationToken> {
  const result = await requestInstallationToken(config, installationId, repoName, fetchImpl);
  if (!result.token) {
    throw new ArmatureError(
      result.status === 401 || result.status === 403 ? "forbidden" : "github_error",
      result.message,
    );
  }
  return result.token;
}

/** Same as mintInstallationToken but reports instead of throwing, for checklists. */
export async function requestInstallationToken(
  config: AppConfig,
  installationId: number,
  repoName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ status: number; token?: InstallationToken; message: string }> {
  const jwt = await createAppJwt(config);
  const result = await githubJson<{
    token?: string;
    expires_at?: string;
    permissions?: Record<string, unknown>;
  }>(
    fetchImpl,
    jwt,
    `/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      body: {
        repositories: [repoName],
        permissions: { contents: "write", metadata: "read" },
      },
    },
  );
  if (!result.ok) {
    let message = `GitHub refused to issue an access token (HTTP ${result.status || "no response"}): ${result.message}`;
    if (result.status === 401) {
      message = `GitHub rejected the App's credentials (HTTP 401): ${result.message}. GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY probably belong to different Apps, or the key was revoked.`;
    } else if (result.status === 404) {
      message = `GitHub has no installation ${installationId} for this App (HTTP 404). The App was uninstalled, or these secrets belong to a different App.`;
    } else if (result.status === 422) {
      message = `GitHub would not scope a token to "${repoName}" (HTTP 422): ${result.message}. The installation does not include that repository, or the App lacks Contents: Read and write.`;
    }
    return { status: result.status, message };
  }
  const token = result.body?.token;
  if (typeof token !== "string" || !token) {
    return { status: result.status, message: "GitHub did not return a token." };
  }
  return {
    status: result.status,
    token: {
      token,
      expiresAt: result.body?.expires_at ?? "",
      permissions: readTokenPermissions(result.body?.permissions),
    },
    message: "ok",
  };
}

/** Keep only the string-valued entries of the token's `permissions` object. */
function readTokenPermissions(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Where an agency installs the App. `state` round-trips to the setup page. */
export function installUrl(config: AppConfig, state: string): string {
  return `https://github.com/apps/${encodeURIComponent(config.slug)}/installations/new?state=${encodeURIComponent(state)}`;
}
