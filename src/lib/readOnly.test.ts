import { describe, expect, it } from "vitest";
import { blocksWrite, readOnlyResponse } from "./readOnly.ts";

const base = "https://mock.supabase.test";

describe("blocksWrite", () => {
  it("lets every read through", () => {
    expect(blocksWrite(`${base}/rest/v1/sites?select=*`, "GET")).toBe(false);
    expect(blocksWrite(`${base}/rest/v1/change_requests?select=id`, "HEAD")).toBe(false);
    expect(blocksWrite(`${base}/functions/v1/content-get`, "OPTIONS")).toBe(false);
  });

  it("blocks table writes, uploads and every function that changes something", () => {
    expect(blocksWrite(`${base}/rest/v1/change_requests`, "POST")).toBe(true);
    expect(blocksWrite(`${base}/rest/v1/site_members?site_id=eq.1`, "PATCH")).toBe(true);
    expect(blocksWrite(`${base}/rest/v1/invites?id=eq.1`, "DELETE")).toBe(true);
    expect(blocksWrite(`${base}/storage/v1/object/change-request-attachments/x.png`, "POST")).toBe(true);
    expect(blocksWrite(`${base}/functions/v1/builder-publish`, "POST")).toBe(true);
    expect(blocksWrite(`${base}/functions/v1/content-publish-batch`, "post")).toBe(true);
    expect(blocksWrite(`${base}/functions/v1/invite-create`, "POST")).toBe(true);
    expect(blocksWrite("not a url", "POST")).toBe(true);
  });

  it("knows the functions and storage calls that only read, and never touches the person's own session", () => {
    expect(blocksWrite(`${base}/functions/v1/content-get`, "POST")).toBe(false);
    expect(blocksWrite(`${base}/functions/v1/site-embed-check`, "POST")).toBe(false);
    expect(blocksWrite(`${base}/storage/v1/object/sign/change-request-attachments`, "POST")).toBe(false);
    expect(blocksWrite(`${base}/auth/v1/token?grant_type=refresh_token`, "POST")).toBe(false);
    expect(blocksWrite(`${base}/auth/v1/logout`, "POST")).toBe(false);
  });
});

describe("readOnlyResponse", () => {
  it("answers with the functions' failure envelope so the message reaches the screen", async () => {
    const response = readOnlyResponse("Nothing is saved in this view.");
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, code: "forbidden", message: "Nothing is saved in this view.", fields: [] });
  });
});
