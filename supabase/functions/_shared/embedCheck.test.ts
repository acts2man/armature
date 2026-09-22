import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { ArmatureError } from "./errors.ts";
import { assertPublicUrl, checkEmbed, frameAncestorsOf } from "./embedCheck.ts";

Deno.test("frameAncestorsOf reads the directive out of a CSP header", () => {
  assertEquals(frameAncestorsOf(null), null);
  assertEquals(frameAncestorsOf("default-src 'self'"), null);
  assertEquals(frameAncestorsOf("default-src 'self'; frame-ancestors 'self' https://armature-sites.netlify.app; img-src *"), "'self' https://armature-sites.netlify.app");
  assertEquals(frameAncestorsOf("frame-ancestors"), "'none'");
});

Deno.test("assertPublicUrl refuses private and non-http addresses", () => {
  assertEquals(assertPublicUrl("https://example.com/").hostname, "example.com");
  for (const bad of ["ftp://example.com", "http://localhost:3000", "http://127.0.0.1", "http://10.0.0.5", "http://192.168.1.1", "http://172.16.0.1", "http://169.254.169.254/", "not a url", "http://[::1]/"]) {
    let threw = false;
    try {
      assertPublicUrl(bad);
    } catch (error) {
      threw = error instanceof ArmatureError;
    }
    assertEquals(threw, true, bad);
  }
});

Deno.test("checkEmbed reports the framing headers, and unreachable sites without throwing", async () => {
  const blocked = await checkEmbed("https://example.com", () =>
    Promise.resolve(new Response("", { status: 200, headers: { "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" } })));
  assertEquals(blocked.reachable, true);
  assertEquals(blocked.status, 200);
  assertEquals(blocked.xFrameOptions, "DENY");
  assertEquals(blocked.frameAncestors, "'none'");

  const open = await checkEmbed("https://example.com", () => Promise.resolve(new Response("", { status: 200 })));
  assertEquals(open.xFrameOptions, null);
  assertEquals(open.frameAncestors, null);

  const down = await checkEmbed("https://example.com", () => Promise.reject(new Error("connection refused")));
  assertEquals(down.reachable, false);
  assertEquals(down.error, "connection refused");

  await assertRejects(() => checkEmbed("http://localhost:5174"), ArmatureError, "private or local");
});
