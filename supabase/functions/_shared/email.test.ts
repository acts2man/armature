/**
 * The email helper: sendAgencyEmail is Resend-optional. When the API key or the from
 * address is missing, or the send fails, it returns a plain-English hint instead of
 * throwing, so the caller (invite-create, client-password-reset, email-test) can still
 * hand the link back to be copied.
 *
 * These tests exercise the helper's decision paths with the agency settings passed in
 * (overrideSettings) so no Supabase call happens. Only the Resend HTTP call is stubbed.
 */
import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { sendAgencyEmail } from "./email.ts";
import type { Env } from "./env.ts";

const AGENCY_ID = "00000000-0000-0000-0000-000000000001";
const noKeyEnv: Env = {};
const withKey = (): Env => ({ RESEND_API_KEY: "re_test" });

function stubResend(handler: (body: unknown) => Response): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("api.resend.com")) return Promise.resolve(handler(init?.body ? JSON.parse(String(init.body)) : {}));
    return Promise.resolve(new Response("not stubbed", { status: 501 }));
  }) as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = original;
  };
}

Deno.test("sendAgencyEmail: no RESEND_API_KEY → not sent, hint says to copy the link", async () => {
  const result = await sendAgencyEmail(noKeyEnv, AGENCY_ID, { to: ["a@b.com"], subject: "x", text: "y" }, { from_name: "Acme", from_address: "hello@acme.com", reply_to: null });
  assertEquals(result.sent, false);
  if (!result.sent) assertEquals(result.reason, "no-key");
});

Deno.test("sendAgencyEmail: no from address → not sent, hint names the settings screen", async () => {
  const result = await sendAgencyEmail(withKey(), AGENCY_ID, { to: ["a@b.com"], subject: "x", text: "y" }, { from_name: null, from_address: null, reply_to: null });
  assertEquals(result.sent, false);
  if (!result.sent) {
    assertEquals(result.reason, "no-from");
    assertMatch(result.hint, /Email sending is not turned on|Settings/);
  }
});

Deno.test("sendAgencyEmail: with a key and a from address, sends through Resend", async () => {
  let seen: unknown = null;
  const restore = stubResend((body) => {
    seen = body;
    return new Response(JSON.stringify({ id: "email_abc" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const result = await sendAgencyEmail(withKey(), AGENCY_ID, { to: ["client@example.com"], subject: "Hello", text: "Body" }, { from_name: "Acme", from_address: "hello@acme.com", reply_to: "reply@acme.com" });
    assertEquals(result.sent, true);
    if (result.sent) {
      assertEquals(result.from, "Acme <hello@acme.com>");
      assertEquals(result.id, "email_abc");
    }
    assertEquals((seen as { from: string }).from, "Acme <hello@acme.com>");
    assertEquals((seen as { subject: string }).subject, "Hello");
    assertEquals((seen as { reply_to: string }).reply_to, "reply@acme.com");
  } finally {
    restore();
  }
});

Deno.test("sendAgencyEmail: a Resend error becomes a send-failed hint, not a throw", async () => {
  const restore = stubResend(() => new Response("bad from address", { status: 400 }));
  try {
    const result = await sendAgencyEmail(withKey(), AGENCY_ID, { to: ["client@example.com"], subject: "Hi", text: "y" }, { from_name: null, from_address: "hello@acme.com", reply_to: null });
    assertEquals(result.sent, false);
    if (!result.sent) {
      assertEquals(result.reason, "send-failed");
      assertMatch(result.hint, /Copy the link/);
    }
  } finally {
    restore();
  }
});

Deno.test("sendAgencyEmail: a bad recipient list is not sent", async () => {
  const result = await sendAgencyEmail(withKey(), AGENCY_ID, { to: ["not-an-email"], subject: "x", text: "y" }, { from_name: null, from_address: "hello@acme.com", reply_to: null });
  assertEquals(result.sent, false);
  if (!result.sent) assertEquals(result.reason, "no-recipient");
});
