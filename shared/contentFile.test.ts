import { describe, expect, it } from "vitest";
import { cloneContent, deepEqual, serializeContent, sortContentKeys } from "./contentFile.ts";
import {
  base64ByteLength,
  base64ToUtf8,
  isValidBase64,
  utf8ToBase64,
  utf8ToBase64Url,
} from "./base64.ts";
import exampleContent from "./example/pages.json";
import exampleContentText from "./example/pages.json?raw";

describe("serializeContent", () => {
  it("reproduces the documented example file byte for byte", () => {
    expect(serializeContent(exampleContent)).toBe(exampleContentText);
  });

  it("sorts object keys at every depth but never array order", () => {
    const sorted = sortContentKeys({ b: 1, a: 2, list: [{ z: 1, y: 2 }, "second"] });
    expect(Object.keys(sorted as object)).toEqual(["a", "b", "list"]);
    const list = (sorted as { list: unknown[] }).list;
    expect(Object.keys(list[0] as object)).toEqual(["y", "z"]);
    expect(list[1]).toBe("second");
  });

  it("is idempotent", () => {
    const once = serializeContent(exampleContent);
    expect(serializeContent(JSON.parse(once))).toBe(once);
  });
});

describe("deepEqual / cloneContent", () => {
  it("ignores key order and clones deeply", () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    const clone = cloneContent(exampleContent);
    expect(clone).not.toBe(exampleContent);
    expect(deepEqual(clone, exampleContent)).toBe(true);
  });
});

describe("base64 helpers", () => {
  it("round-trips text including non-ASCII content", () => {
    const text = 'Tuesdays · 6:00 – 8:30 PM — "©" 🌳\n';
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });

  it("round-trips the whole example content file", () => {
    const text = serializeContent(exampleContent);
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });

  it("measures decoded byte length without decoding", () => {
    for (const sample of ["", "a", "ab", "abc", "hello world", "Tuesdays · 6:00 – 8:30 PM"]) {
      const encoded = utf8ToBase64(sample);
      expect(base64ByteLength(encoded)).toBe(new TextEncoder().encode(sample).length);
    }
  });

  it("validates base64 and tolerates whitespace", () => {
    expect(isValidBase64("aGVsbG8=")).toBe(true);
    expect(isValidBase64("aGVs\nbG8=")).toBe(true);
    expect(isValidBase64("not base64!")).toBe(false);
    expect(isValidBase64("abc")).toBe(false);
  });

  it("produces URL-safe base64 without padding", () => {
    const value = utf8ToBase64Url("ÿþ???>>>");
    expect(value).not.toMatch(/[+/=]/);
  });
});
