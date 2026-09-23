import { describe, expect, it } from "vitest";
import { fieldNames, formLabel, isUnread, messagePreview, replyLink, senderEmail, senderLabel, senderName, submissionsToCsv } from "./messages.ts";

const entry = (data: Record<string, unknown>, extra: Partial<{ form_name: string | null; page_slug: string; read_at: string | null; created_at: string }> = {}) => ({
  id: "1",
  site_id: "s",
  page_slug: "contact",
  element_id: "abcd1234",
  form_name: "Contact form",
  data,
  email_status: "sent" as const,
  read_at: null,
  created_at: "2026-09-23T10:00:00Z",
  ...extra,
});

describe("reading a form entry", () => {
  it("finds the sender's name and email whatever the field is called", () => {
    expect(senderName({ "Your name": "Sam Alder", Email: "sam@example.com" })).toBe("Sam Alder");
    expect(senderName({ first_name: "Sam", last_name: "Alder" })).toBe("Sam Alder");
    expect(senderName({ message: "hi" })).toBeNull();
    expect(senderEmail({ "e-mail": "sam@example.com" })).toBe("sam@example.com");
    expect(senderEmail({ contact: "sam@example.com", note: "x" })).toBe("sam@example.com");
    expect(senderEmail({ email: "not an address" })).toBeNull();
    expect(senderLabel({ email: "sam@example.com" })).toBe("sam@example.com");
    expect(senderLabel({})).toBe("Someone");
  });

  it("previews the message, or the longest other text, on one line and cut short", () => {
    expect(messagePreview({ name: "Sam", message: "Hello\n\nI would   like a quote." })).toBe("Hello I would like a quote.");
    expect(messagePreview({ name: "Sam", email: "sam@example.com", project: "A new deck for the back garden" })).toBe("A new deck for the back garden");
    expect(messagePreview({ message: "x".repeat(200) }, 20)).toBe(`${"x".repeat(19)}…`);
    expect(messagePreview({})).toBe("");
  });

  it("labels the form, marks unread and builds a reply link", () => {
    expect(formLabel(entry({}))).toBe("Contact form");
    expect(formLabel(entry({}, { form_name: null, page_slug: "home" }))).toBe("Home page form");
    expect(formLabel(entry({}, { form_name: "", page_slug: "about" }))).toBe("about page form");
    expect(isUnread(entry({}))).toBe(true);
    expect(isUnread(entry({}, { read_at: "2026-09-23T11:00:00Z" }))).toBe(false);
    expect(replyLink(entry({ email: "sam@example.com" }), "Alder & Stone")).toBe("mailto:sam%40example.com?subject=Re%3A%20your%20message%20to%20Alder%20%26%20Stone%20(Contact%20form)");
    expect(replyLink(entry({ name: "Sam" }), "Alder & Stone")).toBeNull();
  });

  it("exports a CSV with every field as a column, quoting and neutralising formulas", () => {
    const rows = [entry({ name: "Sam, Jr.", message: 'Said "hi"' }), entry({ name: "=SUM(1)", phone: "01onefive" }, { read_at: "2026-09-23T11:00:00Z", form_name: null })];
    expect(fieldNames(rows)).toEqual(["name", "message", "phone"]);
    const csv = submissionsToCsv(rows);
    expect(csv.startsWith("\uFEFFReceived,Form,Page,Read,name,message,phone\r\n")).toBe(true);
    expect(csv).toContain('2026-09-23T10:00:00Z,Contact form,contact,no,"Sam, Jr.","Said ""hi""",\r\n');
    expect(csv).toContain("2026-09-23T10:00:00Z,,contact,yes,'=SUM(1),,01onefive\r\n");
  });
});
