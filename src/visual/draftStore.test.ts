import { describe, expect, it } from "vitest";
import exampleContent from "@shared/example/pages.json";
import exampleSchema from "@shared/example/schema.json";
import type { ContentTree } from "@shared/contentFile.ts";
import type { SiteSchema } from "@shared/schema.ts";
import {
  addListItem,
  canRedo,
  canUndo,
  changeCount,
  changedRoots,
  currentText,
  discardAll,
  draftForBridge,
  dropRoots,
  duplicateListItem,
  emptyHistory,
  fieldMeta,
  moveListItem,
  parseStoredDraft,
  reconcile,
  redo,
  removeListItem,
  revertField,
  serializeDraft,
  setImage,
  setLinkHref,
  setText,
  setFieldValue,
  summarizeDraft,
  toPublishRequest,
  undo,
  type ImageDraft,
} from "./draftStore.ts";

const baseline = exampleContent as ContentTree;
const schema = exampleSchema as SiteSchema;
const image: ImageDraft = { name: "photo.webp", type: "image/webp", width: 10, height: 10, bytes: 3, dataUrl: "data:image/webp;base64,QUJD" };

describe("draft values", () => {
  it("records only fields that differ from the published content", () => {
    let history = emptyHistory();
    history = setText(history, baseline, "home.hero.title", "New headline");
    expect(history.present.fields).toEqual({ "home.hero.title": "New headline" });
    history = setText(history, baseline, "home.hero.title", "Keep your site current");
    expect(history.present.fields).toEqual({});
    expect(changeCount(history.present)).toBe(0);
  });

  it("edits link labels, link hrefs and list item fields through text paths", () => {
    let history = emptyHistory();
    history = setText(history, baseline, "home.hero.cta", "Call us");
    history = setLinkHref(history, baseline, "home.hero.cta", "tel:+15551234");
    expect(history.present.fields["home.hero.cta"]).toEqual({ label: "Call us", href: "tel:+15551234" });
    history = setText(history, baseline, "home.faq.items[1].question", "Where are you?");
    expect(currentText(history.present, baseline, "home.faq.items[1].question")).toBe("Where are you?");
    expect(currentText(history.present, baseline, "home.faq.items[0].question")).toBe("Can I try it first?");
    expect(setText(history, baseline, "home.faq.items[9].question", "x")).toBe(history);
    expect(setText(history, baseline, "not a path", "x")).toBe(history);
  });

  it("groups a run of keystrokes into one undo step, and splits after a pause", () => {
    let history = emptyHistory();
    history = setText(history, baseline, "home.hero.title", "K", { group: "typing:home.hero.title", now: 1000 });
    history = setText(history, baseline, "home.hero.title", "Ke", { group: "typing:home.hero.title", now: 1200 });
    history = setText(history, baseline, "home.hero.title", "Kee", { group: "typing:home.hero.title", now: 1400 });
    expect(history.past.length).toBe(1);
    history = setText(history, baseline, "home.hero.title", "Keep!", { group: "typing:home.hero.title", now: 9000 });
    expect(history.past.length).toBe(2);
    history = undo(history);
    expect(history.present.fields["home.hero.title"]).toBe("Kee");
    history = undo(history);
    expect(history.present.fields["home.hero.title"]).toBeUndefined();
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(true);
    history = redo(history);
    expect(history.present.fields["home.hero.title"]).toBe("Kee");
    // A new change after undo clears the redo stack.
    history = setText(history, baseline, "home.hero.body", "B");
    expect(canRedo(history)).toBe(false);
  });
});

describe("images", () => {
  it("attach, count as a change on their field, revert with it and follow list items", () => {
    let history = emptyHistory();
    history = setImage(history, "home.hero.image", image);
    expect(changedRoots(history.present)).toEqual(new Set(["home.hero.image"]));
    history = revertField(history, "home.hero.image");
    expect(history.present.images).toEqual({});

    history = setImage(history, "shared.header.nav[1].href", image);
    history = addListItem(history, baseline, "shared.header.nav", { label: "New", href: "/new/" }, 0);
    // The list now has 3 items; the picture still belongs to the same item, which moved to index 2? No:
    // addListItem does not re-key (the item at 1 is still "Contact" at 2 only after a move). Check move + remove.
    history = moveListItem(history, baseline, "shared.header.nav", 1, 2);
    expect(Object.keys(history.present.images)).toEqual(["shared.header.nav[2].href"]);
    history = removeListItem(history, baseline, "shared.header.nav", 0);
    expect(Object.keys(history.present.images)).toEqual(["shared.header.nav[1].href"]);
    history = removeListItem(history, baseline, "shared.header.nav", 1);
    expect(history.present.images).toEqual({});
  });
});

describe("lists", () => {
  it("add, duplicate, move and remove, with undo", () => {
    let history = emptyHistory();
    history = addListItem(history, baseline, "home.faq.items", { question: "New?", answer: "Yes." });
    expect((history.present.fields["home.faq.items"] as unknown[]).length).toBe(3);
    history = duplicateListItem(history, baseline, "home.faq.items", 0);
    expect((history.present.fields["home.faq.items"] as { question: string }[])[1]?.question).toBe("Can I try it first?");
    history = moveListItem(history, baseline, "home.faq.items", 3, 0);
    expect((history.present.fields["home.faq.items"] as { question: string }[])[0]?.question).toBe("New?");
    history = removeListItem(history, baseline, "home.faq.items", 0);
    history = removeListItem(history, baseline, "home.faq.items", 0);
    expect(history.present.fields["home.faq.items"]).toBeUndefined(); // back to the published list
    history = undo(history);
    expect((history.present.fields["home.faq.items"] as unknown[]).length).toBe(3);
    expect(moveListItem(history, baseline, "home.faq.items", 0, 9)).toBe(history);
  });
});

describe("persistence", () => {
  it("round-trips through storage and rejects junk", () => {
    let history = emptyHistory();
    history = setText(history, baseline, "home.hero.title", "Saved");
    history = setImage(history, "home.hero.image", image);
    const stored = parseStoredDraft(serializeDraft(history.present, new Date("2026-09-22T10:00:00Z")));
    expect(stored?.savedAt).toBe("2026-09-22T10:00:00.000Z");
    expect(stored?.draft).toEqual(history.present);
    expect(parseStoredDraft(null)).toBeNull();
    expect(parseStoredDraft("{not json")).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ version: 99, savedAt: "x", draft: {} }))).toBeNull();
    expect(parseStoredDraft(JSON.stringify({ version: 1, savedAt: "x", draft: { fields: {}, images: { "a.b.c": { dataUrl: "javascript:alert(1)" } } } }))).toBeNull();
  });

  it("reconciles a restored draft against newly published content", () => {
    let history = emptyHistory();
    history = setText(history, baseline, "home.hero.title", "Already live");
    history = setText(history, baseline, "home.hero.body", "Still a draft");
    history = setFieldValue(history, baseline, "home.gone.field", "orphan");
    const published = JSON.parse(JSON.stringify(baseline)) as ContentTree;
    published.home!.hero!.title = "Already live";
    const draft = reconcile(history.present, published, schema);
    expect(draft.fields).toEqual({ "home.hero.body": "Still a draft" });
  });
});

describe("publishing", () => {
  it("groups the draft by page and sends pictures with their item index", () => {
    let history = emptyHistory();
    history = setText(history, baseline, "home.hero.title", "Batch");
    history = setText(history, baseline, "shared.footer.copyright", "© 2027");
    history = setImage(history, "home.hero.image", image);
    history = setImage(history, "shared.header.nav[1].href", image);
    const request = toPublishRequest(history.present, schema, "site-1", "sha-1");
    expect(request.site_id).toBe("site-1");
    expect(request.baseCommitSha).toBe("sha-1");
    expect(request.pages.map((page) => page.slug)).toEqual(["shared", "home"]);
    const home = request.pages.find((page) => page.slug === "home")!;
    expect(home.fields).toEqual([{ section: "hero", field: "title", value: "Batch" }]);
    expect(home.images).toEqual([{ section: "hero", field: "image", filename: "photo.webp", contentType: "image/webp", dataBase64: "QUJD" }]);
    const shared = request.pages.find((page) => page.slug === "shared")!;
    expect(shared.images[0]).toMatchObject({ section: "header", field: "nav", index: 1, itemKey: "href" });

    const summary = summarizeDraft(history.present, schema);
    expect(summary.map((page) => [page.label, page.items.map((item) => item.label)])).toEqual([
      ["Header & footer", ["Navigation links", "Copyright line"]],
      ["Home", ["Headline", "Hero photo"]],
    ]);
    expect(summary[1]?.items[1]?.images).toBe(1);

    const forBridge = draftForBridge(history.present, baseline);
    expect(forBridge["home.hero.image"]).toBe(image.dataUrl);
    expect((forBridge["shared.header.nav"] as { href: string }[])[1]?.href).toBe(image.dataUrl);

    history = dropRoots(history, ["home.hero.title", "home.hero.image"]);
    expect(changedRoots(history.present)).toEqual(new Set(["shared.footer.copyright", "shared.header.nav"]));
    history = discardAll(history);
    expect(changeCount(history.present)).toBe(0);
  });
});

describe("fieldMeta", () => {
  it("resolves labels for fields and list item fields", () => {
    expect(fieldMeta(schema, "home.hero.title")?.label).toBe("Headline");
    expect(fieldMeta(schema, "home.faq.items[2].answer")?.label).toBe("Answer 3");
    expect(fieldMeta(schema, "home.faq.items[2].nope")).toBeNull();
    expect(fieldMeta(schema, "nope.hero.title")).toBeNull();
  });
});
