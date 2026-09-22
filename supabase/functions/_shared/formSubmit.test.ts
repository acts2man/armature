import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import { ArmatureError } from "./errors.ts";
import { buildMail, checkField, findForm, FORM_LIMITS, handleFormSubmit, hashIp, parseFormInput, validateValues, type FormDeps, type FormEntry, type Mail } from "./formSubmit.ts";

const SITE = { id: "00000000-0000-0000-0000-00000000000a", name: "Alder & Stone", status: "connected", agencyId: "x" };
const FORM = {
  id: "form0001",
  type: "form",
  props: {
    name: "Contact",
    success: "Thanks, we'll call you back.",
    fields: [
      { id: "f1", type: "text", label: "Your name", name: "full_name", required: true },
      { id: "f2", type: "email", label: "Email", name: "email", required: true },
      { id: "f3", type: "select", label: "Project", name: "project", options: ["New home", "Remodel"] },
      { id: "f4", type: "textarea", label: "Message", name: "message" },
      { id: "f5", type: "consent", label: "I agree", name: "consent", required: true },
    ],
  },
  style: {},
  advanced: {},
  meta: { createdBy: "t", updatedAt: "2026-09-22" },
};
const LAYOUT = { version: 1, pageSlug: "contact", path: "/contact/", root: [{ id: "sect0001", type: "container", props: {}, style: {}, advanced: {}, meta: FORM.meta, children: [FORM] }] };
const NOW = new Date("2026-09-22T12:00:00Z");
const GOOD = { full_name: "Ada Lovelace", email: "ada@example.com", project: "Remodel", message: "Line one\nLine two", consent: true, extra: "dropped" };

function fakes(overrides: Partial<FormDeps> = {}) {
  const entries: FormEntry[] = [];
  const mails: Mail[] = [];
  const statuses: string[] = [];
  const deps: FormDeps = {
    now: () => NOW,
    site: (id) => Promise.resolve(id === SITE.id ? SITE : null),
    layout: (_site, page) => Promise.resolve(page === "contact" ? LAYOUT : null),
    countSince: () => Promise.resolve(0),
    insert: (entry) => {
      entries.push(entry);
      return Promise.resolve("entry-1");
    },
    setEmailStatus: (_id, status) => {
      statuses.push(status);
      return Promise.resolve();
    },
    delivery: () => Promise.resolve({ to: ["office@example.com"], from: "Website <forms@example.com>" }),
    send: (mail) => {
      mails.push(mail);
      return Promise.resolve(true);
    },
    ...overrides,
  };
  return { deps, entries, mails, statuses };
}

const input = (values: Record<string, unknown> = GOOD, extra: Record<string, unknown> = {}) =>
  parseFormInput({ site_id: SITE.id, page: "contact", element_id: "form0001", values, trap: "", started_at: NOW.getTime() - 20_000, ...extra });

Deno.test("parseFormInput refuses malformed ids and bodies", () => {
  for (const bad of [{ site_id: "x", page: "contact", element_id: "form0001", values: {} }, { site_id: SITE.id, page: "../etc", element_id: "form0001", values: {} }, { site_id: SITE.id, page: "contact", element_id: "form0001", values: [] }]) {
    let threw = false;
    try {
      parseFormInput(bad);
    } catch (error) {
      threw = error instanceof ArmatureError;
    }
    assert(threw);
  }
});

Deno.test("findForm reads the form from the published layout and validates it", () => {
  assertEquals(findForm(LAYOUT, "form0001")?.props.fields.length, 5);
  assertEquals(findForm(LAYOUT, "missing1"), null);
  const broken = { ...LAYOUT, root: [{ ...FORM, props: { fields: [] } }] };
  assertEquals(findForm(broken, "form0001"), null);
});

Deno.test("checkField enforces each type", () => {
  const field = (type: string, extra = {}) => ({ id: "a", type, label: "L", name: "n", ...extra }) as never;
  assertEquals(checkField(field("email"), "not an email").error, "Please enter a valid email address.");
  assertEquals(checkField(field("tel"), "+1 (916) 555-0100").value, "+1 (916) 555-0100");
  assertEquals(checkField(field("tel"), "call me").error, "Please enter a valid phone number.");
  assertEquals(checkField(field("number"), "12.5").value, "12.5");
  assertEquals(checkField(field("date"), "2026-10-01").value, "2026-10-01");
  assertEquals(checkField(field("select", { options: ["A", "B"] }), "C").error?.startsWith("Please choose"), true);
  assertEquals(checkField(field("text"), "two\nlines").error, '"L" must be one line.');
  assertEquals(checkField(field("text"), "x".repeat(FORM_LIMITS.textChars + 1)).error?.includes("too long"), true);
  assertEquals(checkField(field("text", { required: true }), "   ").error, 'Please fill in "L".');
  assertEquals(checkField(field("checkbox"), "on").value, true);
  assertEquals(checkField(field("consent", { required: true }), false).error, "Please tick this box to continue.");
});

Deno.test("a good entry is stored (unknown fields dropped) and emailed with reply-to the visitor", async () => {
  const { deps, entries, mails, statuses } = fakes();
  const result = await handleFormSubmit(input(), { ipHash: "a".repeat(64), userAgent: "Test" }, deps);
  assertEquals(result, { ok: true, message: "Thanks, we'll call you back.", redirect: undefined });
  assertEquals(entries.length, 1);
  assertEquals(entries[0]?.data, { full_name: "Ada Lovelace", email: "ada@example.com", project: "Remodel", message: "Line one\nLine two", consent: true });
  assertEquals(entries[0]?.formName, "Contact");
  assertEquals(mails[0]?.to, ["office@example.com"]);
  assertEquals(mails[0]?.replyTo, "ada@example.com");
  assertStringIncludes(mails[0]?.subject ?? "", "Contact on Alder & Stone");
  assertStringIncludes(mails[0]?.text ?? "", "Project:\nRemodel");
  assertEquals(statuses, ["sent"]);
});

Deno.test("field errors come back per field and nothing is stored", async () => {
  const { deps, entries } = fakes();
  const result = await handleFormSubmit(input({ ...GOOD, email: "nope", consent: false }), { ipHash: "a".repeat(64), userAgent: null }, deps);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(Object.keys(result.fieldErrors).sort(), ["consent", "email"]);
  assertEquals(entries.length, 0);
});

Deno.test("bots (honeypot or too fast) get a quiet success and nothing is stored", async () => {
  const { deps, entries } = fakes();
  assertEquals((await handleFormSubmit(input(GOOD, { trap: "http://spam" }), { ipHash: "a".repeat(64), userAgent: null }, deps)).ok, true);
  assertEquals((await handleFormSubmit(input(GOOD, { started_at: NOW.getTime() - 500 }), { ipHash: "a".repeat(64), userAgent: null }, deps)).ok, true);
  assertEquals(entries.length, 0);
});

Deno.test("rate limits per visitor and per site, and unknown or changed forms are refused", async () => {
  const busyVisitor = fakes({ countSince: (filter) => Promise.resolve(filter.ipHash ? FORM_LIMITS.perVisitorShort.count : 0) });
  await assertRejects(() => handleFormSubmit(input(), { ipHash: "a".repeat(64), userAgent: null }, busyVisitor.deps), ArmatureError, "several times");
  const busySite = fakes({ countSince: (filter) => Promise.resolve(filter.siteId ? FORM_LIMITS.perSiteHour.count : 0) });
  await assertRejects(() => handleFormSubmit(input(), { ipHash: "a".repeat(64), userAgent: null }, busySite.deps), ArmatureError, "busy");
  const { deps } = fakes();
  await assertRejects(() => handleFormSubmit(parseFormInput({ site_id: SITE.id, page: "about", element_id: "form0001", values: GOOD, started_at: NOW.getTime() - 20_000 }), { ipHash: "a".repeat(64), userAgent: null }, deps), ArmatureError, "changed");
  await assertRejects(() => handleFormSubmit(parseFormInput({ site_id: "00000000-0000-0000-0000-0000000000ff", page: "contact", element_id: "form0001", values: GOOD, started_at: NOW.getTime() - 20_000 }), { ipHash: "a".repeat(64), userAgent: null }, deps), ArmatureError, "not accepting");
});

Deno.test("without email set up the entry is still stored; a failed send is recorded", async () => {
  const noMail = fakes({ send: undefined });
  assertEquals((await handleFormSubmit(input(), { ipHash: "a".repeat(64), userAgent: null }, noMail.deps)).ok, true);
  assertEquals(noMail.entries.length, 1);
  assertEquals(noMail.statuses, []);
  const failing = fakes({ send: () => Promise.reject(new Error("down")) });
  assertEquals((await handleFormSubmit(input(), { ipHash: "a".repeat(64), userAgent: null }, failing.deps)).ok, true);
  assertEquals(failing.statuses, ["failed"]);
});

Deno.test("hashIp is a salted SHA-256 and buildMail lists every field", async () => {
  const one = await hashIp("203.0.113.9", "salt");
  assertEquals(one.length, 64);
  assert(one !== (await hashIp("203.0.113.9", "other")));
  assertEquals(validateValues(findForm(LAYOUT, "form0001")!.props, GOOD).errors, {});
  const mail = buildMail(SITE, findForm(LAYOUT, "form0001")!.props, "contact", { full_name: "Ada", consent: true }, { to: ["a@b.co"], from: "x@y.co" });
  assertStringIncludes(mail.text, "I agree:\nYes");
  assertStringIncludes(mail.text, "Email:\n(empty)");
  assertEquals(mail.replyTo, undefined);
});
