// deno-lint-ignore-file require-await -- fake fetch stubs return responses synchronously
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { base64ToBytes, utf8ToBase64 } from "../../../shared/base64.ts";
import { ArmatureError } from "./errors.ts";
import {
  createAppJwt,
  describeAppEnv,
  findInstallationForRepo,
  installUrl,
  loadAppConfig,
  normalizePrivateKey,
  pemToPkcs8,
  redact,
  requestInstallationToken,
  type AppConfig,
} from "./githubApp.ts";
import { generateTestKeyPair } from "./testKeys.ts";

const keys = await generateTestKeyPair();
const config: AppConfig = { appId: "12345", privateKeyPem: keys.pkcs1Pem, slug: "armature-test" };

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return base64ToBytes(padded);
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.test("describeAppEnv / loadAppConfig name what is missing and never the key", () => {
  const report = describeAppEnv({ GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "x" });
  assertEquals(report.missing, ["GITHUB_APP_PRIVATE_KEY"]);
  assertEquals(report.privateKeyPresent, false);
  try {
    loadAppConfig({ GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "x" });
    throw new Error("should have thrown");
  } catch (error) {
    assert(error instanceof ArmatureError);
    assertEquals(error.code, "not_configured");
    assertStringIncludes(error.message, "GITHUB_APP_PRIVATE_KEY");
  }
  const full = loadAppConfig({
    GITHUB_APP_ID: " 12345 ",
    GITHUB_APP_SLUG: "armature-test",
    GITHUB_APP_PRIVATE_KEY: keys.pkcs1Pem,
  });
  assertEquals(full.appId, "12345");
  assertStringIncludes(full.privateKeyPem, "BEGIN RSA PRIVATE KEY");
});

Deno.test("normalizePrivateKey accepts PEM, base64-of-PEM and literal \\n sequences", () => {
  assertEquals(normalizePrivateKey(keys.pkcs1Pem), keys.pkcs1Pem.trim());
  assertEquals(normalizePrivateKey(utf8ToBase64(keys.pkcs1Pem)), keys.pkcs1Pem.trim());
  const escaped = keys.pkcs1Pem.trim().replace(/\n/g, "\\n");
  assertEquals(normalizePrivateKey(escaped), keys.pkcs1Pem.trim());
  try {
    normalizePrivateKey("definitely not a key");
    throw new Error("should have thrown");
  } catch (error) {
    assert(error instanceof ArmatureError);
    assertEquals(error.code, "not_configured");
  }
});

Deno.test("pemToPkcs8 passes PKCS#8 through and wraps PKCS#1 into identical bytes", () => {
  assertEquals(pemToPkcs8(keys.pkcs8Pem), keys.pkcs8Der);
  // The PKCS#1 → PKCS#8 wrapper must reproduce exactly what Web Crypto exported.
  assertEquals(pemToPkcs8(keys.pkcs1Pem), keys.pkcs8Der);
  try {
    pemToPkcs8("-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----");
    throw new Error("should have thrown");
  } catch (error) {
    assert(error instanceof ArmatureError);
    assertStringIncludes(error.message, "CERTIFICATE");
  }
});

Deno.test("createAppJwt signs an RS256 token GitHub would accept", async () => {
  const now = 1_700_000_000_000;
  const jwt = await createAppJwt(config, now);
  const [header, payload, signature] = jwt.split(".");
  assert(header && payload && signature);
  assertEquals(JSON.parse(new TextDecoder().decode(base64UrlToBytes(header))), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
  assertEquals(claims.iss, "12345");
  assertEquals(claims.iat, 1_700_000_000 - 60);
  assertEquals(claims.exp, 1_700_000_000 + 540);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    keys.publicKey,
    base64UrlToBytes(signature) as BufferSource,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  assertEquals(verified, true);
  // The PKCS#8 form signs identically.
  const jwt2 = await createAppJwt({ ...config, privateKeyPem: keys.pkcs8Pem }, now);
  assertEquals(jwt2, jwt);
});

Deno.test("requestInstallationToken scopes the token and sends the app JWT", async () => {
  let seen: { url: string; method: string; auth: string; body: unknown } | undefined;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen = {
      url: String(url),
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("Authorization") ?? "",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    return jsonResponse({ token: "ghs_fake", expires_at: "2026-01-01T00:00:00Z" }, 201);
  }) as unknown as typeof fetch;

  const result = await requestInstallationToken(config, 42, "site-repo", fakeFetch);
  assertEquals(result.token?.token, "ghs_fake");
  assert(seen);
  assertEquals(seen.method, "POST");
  assertStringIncludes(seen.url, "/app/installations/42/access_tokens");
  assert(seen.auth.startsWith("Bearer ey"), "app JWT sent as bearer");
  assertEquals(seen.body, {
    repositories: ["site-repo"],
    permissions: { contents: "write", metadata: "read" },
  });
});

Deno.test("requestInstallationToken explains 401, 404 and 422 in plain English", async () => {
  for (const [status, needle] of [
    [401, "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY"],
    [404, "no installation 42"],
    [422, 'scope a token to "site-repo"'],
  ] as const) {
    const fakeFetch = (async () => jsonResponse({ message: "nope" }, status)) as unknown as typeof fetch;
    const result = await requestInstallationToken(config, 42, "site-repo", fakeFetch);
    assertEquals(result.token, undefined);
    assertEquals(result.status, status);
    assertStringIncludes(result.message, needle);
  }
});

Deno.test("findInstallationForRepo reads the installation or reports the status", async () => {
  const ok = (async () =>
    jsonResponse({
      id: 7,
      account: { login: "acme", type: "Organization" },
      repository_selection: "selected",
      permissions: { contents: "write" },
    })) as unknown as typeof fetch;
  const found = await findInstallationForRepo(config, "acme", "site", ok);
  assertEquals(found.installation?.id, 7);
  assertEquals(found.installation?.account.login, "acme");
  assertEquals(found.installation?.suspended, false);

  const missing = (async () => jsonResponse({ message: "Not Found" }, 404)) as unknown as typeof fetch;
  const notFound = await findInstallationForRepo(config, "acme", "site", missing);
  assertEquals(notFound.installation, undefined);
  assertEquals(notFound.status, 404);

  const down = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
  const unreachable = await findInstallationForRepo(config, "acme", "site", down);
  assertEquals(unreachable.status, 0);
  assertStringIncludes(unreachable.message, "network down");
});

Deno.test("installUrl and redact", () => {
  assertEquals(
    installUrl(config, "agency uuid"),
    "https://github.com/apps/armature-test/installations/new?state=agency%20uuid",
  );
  assertEquals(redact("token ghs_secret here", "ghs_secret"), "token [redacted] here");
  assertEquals(redact("nothing", ""), "nothing");
});

Deno.test("an unreadable key is reported as not_configured, not as a crash", async () => {
  await assertRejects(
    () => createAppJwt({ ...config, privateKeyPem: "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----" }),
    ArmatureError,
    "could not be read",
  );
});
