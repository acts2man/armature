import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { issuePasswordReset, type PasswordResetDeps, type ResetAuthPort, type ResetCallerPort } from "./clientAccess.ts";
import type { AuthUserLite } from "./clientAccount.ts";
import { ArmatureError } from "./errors.ts";

const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_C = "33333333-3333-4333-8333-333333333333";
const AGENCY_X = "agency-x";
const AGENCY_Y = "agency-y";
const STAFF_ID = "user-staff";
const CLIENT_ID = "user-client";
const OTHER_CLIENT_ID = "user-other-client";
const RESET_LINK = "https://project.supabase.co/auth/v1/verify?token=secret-token&type=recovery&redirect_to=https://portal.example/signin";

/**
 * A fake Supabase. The caller sees, under RLS, the client of site A (agency X) and the
 * client of site C (agency Y); their own standing in each agency is what the option says.
 */
function fakeSupabase(options: { roles?: Record<string, "owner" | "staff" | null>; users?: AuthUserLite[] } = {}) {
  const roles = options.roles ?? { [AGENCY_X]: "staff" };
  const users: AuthUserLite[] = options.users ?? [
    { id: CLIENT_ID, email: "sam@bakery.example", app_metadata: {} },
    { id: OTHER_CLIENT_ID, email: "kim@other.example", app_metadata: {} },
  ];
  const links: { email: string; redirectTo: string }[] = [];
  const logs: string[] = [];

  const caller: ResetCallerPort = {
    userId: STAFF_ID,
    clientSites: (userId) => {
      if (userId === CLIENT_ID) return Promise.resolve([{ siteId: SITE_A, agencyId: AGENCY_X }]);
      if (userId === OTHER_CLIENT_ID) return Promise.resolve([{ siteId: SITE_C, agencyId: AGENCY_Y }]);
      return Promise.resolve([]);
    },
    agencyRole: (agencyId) => Promise.resolve(roles[agencyId] ?? null),
  };

  const auth: ResetAuthPort = {
    getUserById: (userId) => Promise.resolve(users.find((user) => user.id === userId) ?? null),
    recoveryLink: (email, redirectTo) => {
      links.push({ email, redirectTo });
      return Promise.resolve(RESET_LINK);
    },
  };

  const deps: PasswordResetDeps = { caller, auth, appBaseUrl: "https://portal.example", log: (line) => logs.push(line) };
  return { deps, links, logs };
}

Deno.test("agency staff get a recovery link for their client, aimed at the sign-in page", async () => {
  const fake = fakeSupabase();
  const result = await issuePasswordReset({ userId: CLIENT_ID }, fake.deps);
  assertEquals(result, { ok: true, email: "sam@bakery.example", reset_url: RESET_LINK, emailed: false, email_hint: null });
  assertEquals(fake.links, [{ email: "sam@bakery.example", redirectTo: "https://portal.example/signin" }]);
});

Deno.test("a client of another agency's site is refused, and no link is minted", async () => {
  const fake = fakeSupabase();
  const error = await assertRejects(() => issuePasswordReset({ userId: OTHER_CLIENT_ID }, fake.deps), ArmatureError);
  assertEquals(error.code, "forbidden");
  assertStringIncludes(error.message, "not a client of a site your agency looks after");
  assertEquals(fake.links.length, 0);
});

Deno.test("a caller who is not staff anywhere is refused, even for a client they can see", async () => {
  const fake = fakeSupabase({ roles: {} });
  const error = await assertRejects(() => issuePasswordReset({ userId: CLIENT_ID }, fake.deps), ArmatureError);
  assertEquals(error.code, "forbidden");
  assertEquals(fake.links.length, 0);
});

Deno.test("a person with no site membership the caller can see is refused", async () => {
  const fake = fakeSupabase();
  const error = await assertRejects(() => issuePasswordReset({ userId: "user-nobody" }, fake.deps), ArmatureError);
  assertEquals(error.code, "forbidden");
  assertEquals(fake.links.length, 0);
});

Deno.test("the caller cannot reset their own password this way", async () => {
  const fake = fakeSupabase();
  const error = await assertRejects(() => issuePasswordReset({ userId: STAFF_ID }, fake.deps), ArmatureError);
  assertEquals(error.code, "invalid");
  assertStringIncludes(error.message, "Forgot your password?");
  assertEquals(fake.links.length, 0);
});

Deno.test("a membership whose account is gone is named, not a bare error", async () => {
  const fake = fakeSupabase({ users: [] });
  const error = await assertRejects(() => issuePasswordReset({ userId: CLIENT_ID }, fake.deps), ArmatureError);
  assertEquals(error.code, "not_found");
  assertStringIncludes(error.message, "could not be found");
  assertEquals(fake.links.length, 0);
});

Deno.test("the link never appears in the logs", async () => {
  const fake = fakeSupabase();
  await issuePasswordReset({ userId: CLIENT_ID }, fake.deps);
  assert(fake.logs.length > 0, "one log line is written");
  for (const line of fake.logs) {
    assert(!line.includes("secret-token"), `log leaks the link: ${line}`);
    assert(!line.includes(RESET_LINK), `log leaks the link: ${line}`);
  }
});
