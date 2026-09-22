import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import {
  createClientLogin,
  setOwnPassword,
  type AdminAuthPort,
  type AdminDataPort,
  type AuthUserLite,
  type CallerPort,
  type ClientCreateDeps,
} from "./clientAccount.ts";
import { ArmatureError } from "./errors.ts";

const SITE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SITE_ID = "22222222-2222-4222-8222-222222222222";
const AGENCY = "agency-a";
const OTHER_AGENCY = "agency-b";
const STAFF_ID = "user-staff";
const TEMP_PASSWORD = "Blue-Kettle-4291";

/** A fake Supabase: the caller's RLS view, the Admin auth API, and the tables it writes. */
function fakeSupabase(options: { callerRole?: "owner" | "staff" | null; users?: AuthUserLite[] } = {}) {
  const users: AuthUserLite[] = [...(options.users ?? [])];
  const created: { email: string; password: string; fullName: string }[] = [];
  const updates: { userId: string; patch: { password?: string; app_metadata?: Record<string, unknown> } }[] = [];
  const members: { siteId: string; userId: string; role: string }[] = [];
  const profiles: { userId: string; email: string; fullName: string }[] = [];
  const logs: string[] = [];

  const caller: CallerPort = {
    userId: STAFF_ID,
    email: "staff@agency.example",
    loadSite: (siteId) => {
      if (siteId === SITE_ID) return Promise.resolve({ id: SITE_ID, agency_id: AGENCY, name: "Acme Bakery" });
      if (siteId === OTHER_SITE_ID) return Promise.resolve({ id: OTHER_SITE_ID, agency_id: OTHER_AGENCY, name: "Someone else's site" });
      return Promise.resolve(null);
    },
    agencyRole: (agencyId) =>
      Promise.resolve(agencyId === AGENCY ? (options.callerRole === undefined ? "staff" : options.callerRole) : null),
  };

  const auth: AdminAuthPort = {
    findUserByEmail: (email) => Promise.resolve(users.find((user) => user.email === email.toLowerCase()) ?? null),
    createConfirmedUser: ({ email, password, fullName }) => {
      created.push({ email, password, fullName });
      const user: AuthUserLite = { id: `user-${created.length}`, email, app_metadata: { must_change_password: true } };
      users.push(user);
      return Promise.resolve(user);
    },
    getUserById: (userId) => Promise.resolve(users.find((user) => user.id === userId) ?? null),
    updateUser: (userId, patch) => {
      updates.push({ userId, patch });
      return Promise.resolve();
    },
  };

  const data: AdminDataPort = {
    addSiteMember: (siteId, userId, role) => {
      if (members.some((member) => member.siteId === siteId && member.userId === userId)) return Promise.resolve("already_member");
      members.push({ siteId, userId, role });
      return Promise.resolve("added");
    },
    upsertProfile: (userId, email, fullName) => {
      profiles.push({ userId, email, fullName });
      return Promise.resolve();
    },
  };

  const deps: ClientCreateDeps = { caller, auth, data, appBaseUrl: "https://portal.example", log: (line) => logs.push(line) };
  return { deps, auth, users, created, updates, members, profiles, logs };
}

const input = (overrides: Partial<Parameters<typeof createClientLogin>[0]> = {}) => ({
  siteId: SITE_ID,
  fullName: "Sam Client",
  email: "Sam@Bakery.example",
  temporaryPassword: TEMP_PASSWORD,
  role: "client_editor",
  ...overrides,
});

Deno.test("a caller who is not agency staff is rejected before anything is created", async () => {
  const fake = fakeSupabase({ callerRole: null });
  const error = await assertRejects(() => createClientLogin(input(), fake.deps), ArmatureError);
  assertEquals(error.code, "forbidden");
  assertStringIncludes(error.message, "Only agency staff");
  assertEquals(fake.created.length, 0);
  assertEquals(fake.members.length, 0);
});

Deno.test("a site that belongs to another agency is rejected", async () => {
  const fake = fakeSupabase();
  const error = await assertRejects(() => createClientLogin(input({ siteId: OTHER_SITE_ID }), fake.deps), ArmatureError);
  assertEquals(error.code, "forbidden");
  assertEquals(fake.created.length, 0);

  const invisible = await assertRejects(() => createClientLogin(input({ siteId: "33333333-3333-4333-8333-333333333333" }), fake.deps), ArmatureError);
  assertStringIncludes(invisible.message, "does not belong to your agency");
});

Deno.test("weak temporary passwords are rejected with the reason", async () => {
  const fake = fakeSupabase();
  for (const [password, needle] of [
    ["Short1!", "at least 10 characters"],
    ["aaaaaaaaaaaa", "same character"],
    ["MyPassword2026", '"password"'],
    ["sam@bakery.example", "email address"],
  ] as const) {
    const error = await assertRejects(() => createClientLogin(input({ temporaryPassword: password }), fake.deps), ArmatureError);
    assertEquals(error.code, "invalid");
    assertStringIncludes(error.message, needle);
  }
  assertEquals(fake.created.length, 0);
});

Deno.test("bad input is named: email, name and role", async () => {
  const fake = fakeSupabase();
  assertStringIncludes((await assertRejects(() => createClientLogin(input({ email: "nope" }), fake.deps), ArmatureError)).message, "email address");
  assertStringIncludes((await assertRejects(() => createClientLogin(input({ fullName: "  " }), fake.deps), ArmatureError)).message, "name");
  assertStringIncludes((await assertRejects(() => createClientLogin(input({ role: "owner" }), fake.deps), ArmatureError)).message, "Unknown role");
});

Deno.test("a new person gets a confirmed account with the flag, a profile and the membership", async () => {
  const fake = fakeSupabase();
  const result = await createClientLogin(input(), fake.deps);

  assertEquals(result.outcome, "created");
  assertEquals(result.email, "sam@bakery.example");
  assertEquals(result.site_name, "Acme Bakery");
  assertEquals(result.sign_in_url, "https://portal.example/signin");
  assertStringIncludes(result.message, "choose their own password");

  assertEquals(fake.created, [{ email: "sam@bakery.example", password: TEMP_PASSWORD, fullName: "Sam Client" }]);
  assertEquals(fake.users[0]?.app_metadata, { must_change_password: true });
  assertEquals(fake.members, [{ siteId: SITE_ID, userId: "user-1", role: "client_editor" }]);
  assertEquals(fake.profiles, [{ userId: "user-1", email: "sam@bakery.example", fullName: "Sam Client" }]);
});

Deno.test("an existing person gets the membership only; their password is untouched", async () => {
  const existing: AuthUserLite = { id: "user-existing", email: "sam@bakery.example", app_metadata: {} };
  const fake = fakeSupabase({ users: [existing] });
  const result = await createClientLogin(input({ role: "client_owner" }), fake.deps);

  assertEquals(result.outcome, "already_existed");
  assertStringIncludes(result.message, "already has an account");
  assertStringIncludes(result.message, "given access to Acme Bakery");
  assertStringIncludes(result.message, "existing password still applies");
  assertEquals(fake.created.length, 0, "no account created");
  assertEquals(fake.updates.length, 0, "no password or metadata change");
  assertEquals(fake.members, [{ siteId: SITE_ID, userId: "user-existing", role: "client_owner" }]);
  assertEquals(fake.profiles.length, 0, "their profile is left alone");

  // Doing it again keeps the membership (and its role) as it was.
  const again = await createClientLogin(input({ role: "client_editor" }), fake.deps);
  assertStringIncludes(again.message, "already had access");
  assertEquals(fake.members, [{ siteId: SITE_ID, userId: "user-existing", role: "client_owner" }]);
});

Deno.test("the temporary password never appears in the response or the logs", async () => {
  const fake = fakeSupabase();
  const result = await createClientLogin(input(), fake.deps);
  assert(!JSON.stringify(result).includes(TEMP_PASSWORD));
  assert(fake.logs.length > 0, "one log line is written");
  for (const line of fake.logs) assert(!line.includes(TEMP_PASSWORD), `log leaks the password: ${line}`);

  // The same holds for an error path that mentions the password rule.
  const error = await assertRejects(() => createClientLogin(input({ temporaryPassword: "Short1!" }), fake.deps), ArmatureError);
  assert(!error.message.includes("Short1!"));
  assert(!JSON.stringify(fake.logs).includes("Short1!"));
});

Deno.test("setOwnPassword updates the caller's own password and clears the flag", async () => {
  const me: AuthUserLite = { id: "user-me", email: "me@bakery.example", app_metadata: { must_change_password: true, provider: "email" } };
  const fake = fakeSupabase({ users: [me] });
  await setOwnPassword({ userId: "user-me", email: "me@bakery.example", password: "Green-Teapot-77" }, fake.auth);
  assertEquals(fake.updates, [
    { userId: "user-me", patch: { password: "Green-Teapot-77", app_metadata: { must_change_password: false, provider: "email" } } },
  ]);
});

Deno.test("setOwnPassword applies the same rules and refuses an unknown caller", async () => {
  const me: AuthUserLite = { id: "user-me", email: "me@bakery.example", app_metadata: { must_change_password: true } };
  const fake = fakeSupabase({ users: [me] });
  const weak = await assertRejects(() => setOwnPassword({ userId: "user-me", email: "me@bakery.example", password: "me@bakery.example" }, fake.auth), ArmatureError);
  assertEquals(weak.code, "invalid");
  assertEquals(fake.updates.length, 0);

  const missing = await assertRejects(() => setOwnPassword({ userId: "user-gone", email: "x@y.z", password: "Green-Teapot-77" }, fake.auth), ArmatureError);
  assertEquals(missing.code, "forbidden");
});
