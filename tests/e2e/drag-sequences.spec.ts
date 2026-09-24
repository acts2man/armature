/**
 * Drag and drop that stays put. A long chain of drags on one page, each one asserting that:
 *   - the ghost names the target and the drop line sits on the edge it names;
 *   - after the drop the store holds exactly that order (the autosaved draft is the store),
 *     and the page shows it;
 *   - the dragged element is still the selection;
 *   - the next drag of it starts at once, with nothing clicked in between.
 *
 * Drags start three ways: by the element itself on the canvas (a movement threshold keeps
 * plain clicks and double-clicks working), by the toolbar handle of a widget, and by the
 * grip in a container's tab or an empty area of the container. When the target is off
 * screen the drag holds the pointer at the sheet's edge and the editor scrolls the frame.
 *
 * Runs against examples/demo-site (a production build, see playwright.config.ts) and,
 * when REAL_SITE_DIR or REAL_SITE_URL is set, against the real Tree Test Prep site too.
 */
import { expect, test, type FrameLocator, type Locator, type Page } from "@playwright/test";
import { SITE_ID, STAFF_ID, demoLayouts, editorUrl, installMocks, realLayouts } from "./mocks.ts";

type Node = { id: string; type: string; label?: string; children?: Node[] };
type Layout = { root: Node[] };
/** Parent id ("root" for the page) to its children's ids in order. */
type Tree = Record<string, string[]>;
type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

const siteFrame = (page: Page): FrameLocator => page.frameLocator(`iframe[title$="live site"]`);
const el = (frame: FrameLocator, id: string): Locator => frame.locator(`[data-ae-id="${id}"]`);

// Wide enough for the tablet canvas (1024 px) to render at scale 1, so frame pixels are page pixels.
test.use({ viewport: { width: 1800, height: 1000 } });

const treeOf = (nodes: Node[], parent = "root", out: Tree = {}): Tree => {
  out[parent] = nodes.map((node) => node.id);
  for (const node of nodes) if (node.children) treeOf(node.children, node.id, out);
  return out;
};
const TYPE_LABELS: Record<string, string> = { heading: "Heading", text: "Text Editor", button: "Button", image: "Image", container: "Container", grid: "Grid", "site-section": "Section", video: "Video", accordion: "Accordion" };
const labelOf = (nodes: Node[], id: string): string => {
  for (const node of nodes) {
    if (node.id === id) return node.label ?? TYPE_LABELS[node.type] ?? node.type;
    const inner = node.children ? labelOf(node.children, id) : "";
    if (inner) return inner;
  }
  return "";
};

type Target = { before: string } | { after: string } | { into: string };
type Step = {
  name: string;
  /** The element to drag. */
  drag: string;
  /** How the drag starts: the element on the canvas, the toolbar handle / container grip, or an empty area of a container. */
  by: "body" | "handle" | "empty-area";
  to: Target;
  /**
   * Where to aim for a drop next to a container: "band" is inside its outer 8 px (a column in a
   * row, a cell in a grid); "outside" is just past its edge, in its parent's padding, which is
   * the way past a child that shares the edge when both flow the same way (a stacked row on a
   * phone: its bottom edge is also its last column's and that column's last widget's).
   */
  aim?: "band" | "outside";
  /** For a band aim: which edge of the target (default: the edge named, on the flow axis). In a grid a side band draws a vertical line. */
  bandEdge?: "left" | "right" | "top" | "bottom";
  /** Switch the canvas to this view first (scale stays 1). */
  view?: "phone" | "tablet";
  /** Where on the element a body drag starts (frame pixels from its top-left); default the centre. */
  grab?: Point;
  /** Undo (Ctrl/Cmd+Z) before this step, then drag. */
  undoFirst?: boolean;
  /** A click that selects `drag` first (then arrow keys: left to a parent, down to a next sibling), for a handle drag of something not yet selected. */
  select?: { id: string; position?: Point; thenLeft?: number; thenDown?: number };
};

/** Where a move lands in the tree model. */
function applyMove(tree: Tree, id: string, to: Target): { tree: Tree; parent: string; index: number } {
  const next: Tree = Object.fromEntries(Object.entries(tree).map(([parent, ids]) => [parent, ids.filter((child) => child !== id)]));
  if ("into" in to) {
    const list = next[to.into] ?? [];
    next[to.into] = [...list, id];
    return { tree: next, parent: to.into, index: list.length };
  }
  const sibling = "before" in to ? to.before : to.after;
  const parent = Object.keys(next).find((key) => next[key]!.includes(sibling));
  if (!parent) throw new Error(`${sibling} is not in the tree`);
  const list = next[parent]!;
  const index = list.indexOf(sibling) + ("before" in to ? 0 : 1);
  next[parent] = [...list.slice(0, index), id, ...list.slice(index)];
  return { tree: next, parent, index };
}

/**
 * The site inside the frame reflows as its pictures come in; a point computed before that lands
 * on whatever was there before the shift. Wait for the pictures (a while: a real site's off-site
 * ones may never arrive here) and then for the page height to hold still for a couple of frames.
 */
async function settled(page: Page) {
  const frame = siteFrame(page);
  const started = Date.now();
  await expect.poll(() => frame.locator("img").evaluateAll((nodes) => nodes.every((node) => (node as HTMLImageElement).complete)).then((done) => done || Date.now() - started > 6_000), { timeout: 15_000 }).toBe(true);
  await expect
    .poll(
      () =>
        frame.locator("body").evaluate(
          (body) =>
            new Promise<boolean>((resolve) => {
              const before = `${body.getBoundingClientRect().height}:${window.scrollY}`;
              requestAnimationFrame(() => requestAnimationFrame(() => resolve(`${body.getBoundingClientRect().height}:${window.scrollY}` === before)));
            }),
        ),
      { timeout: 15_000 },
    )
    .toBe(true);
}

async function setView(page: Page, view: "phone" | "tablet") {
  await page.getByRole("button", { name: view === "phone" ? /Phone view/ : /Tablet view/ }).click();
  await expect(page.getByTestId("canvas")).toHaveAttribute("data-scale", "1.000");
  await settled(page);
}

/** The page as the frame shows it: every builder element under its nearest builder ancestor, in DOM order. */
const frameTree = (frame: FrameLocator): Promise<Tree> =>
  frame.locator("body").evaluate((body) => {
    const out: Record<string, string[]> = { root: [] };
    for (const node of Array.from(body.querySelectorAll("[data-ae-id]"))) {
      const id = node.getAttribute("data-ae-id") ?? "";
      const parent = node.parentElement?.closest("[data-ae-id]")?.getAttribute("data-ae-id") ?? "root";
      (out[parent] ??= []).push(id);
    }
    return out;
  });

/** The store: the autosaved draft holds every page whose layout changed; an unchanged page is the fixture. */
async function storeTree(page: Page, slug: string, fixture: Layout): Promise<Tree> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), `armature:builder:draft:${SITE_ID}:${STAFF_ID}`);
  const draft = raw ? (JSON.parse(raw) as { layouts?: Record<string, Layout | null> }) : null;
  const layout = draft?.layouts?.[slug];
  return treeOf((layout ?? fixture).root);
}

/** Only the parents the model knows (the frame also lists chrome parts and site sections' insides). */
const pick = (tree: Tree, keys: string[]): Tree => Object.fromEntries(keys.map((key) => [key, tree[key] ?? []]));

/** Scroll an element to the middle of the frame (at once, whatever the site's scroll-behavior): clear of the editor's request bar over the canvas bottom and of the auto-scroll bands. */
const centre = (locator: Locator) => locator.evaluate((node) => node.scrollIntoView({ block: "center", behavior: "instant" }));

/** An element's box, waiting through a remount (the kit re-keys an element after a layout change). */
async function boxOf(locator: Locator): Promise<Box> {
  let box = await locator.boundingBox();
  const started = Date.now();
  while (!box && Date.now() - started < 5_000) {
    await locator.page().waitForTimeout(50);
    box = await locator.boundingBox();
  }
  if (!box) throw new Error(`${locator.toString()} has no box`);
  return box;
}

/** How far the sheet's auto-scroll band reaches in from its edge (useDrag's EDGE), and a margin inside it. */
const EDGE_BAND = 48;
const SAFE = 70;

async function runSteps(page: Page, slug: string, fixture: Layout, steps: Step[]) {
  const frame = siteFrame(page);
  const sheet = page.getByTestId("sheet");
  const selection = page.getByTestId("element-selection");
  const ghost = page.getByTestId("drag-ghost");
  let tree = treeOf(fixture.root);
  /** The tree before each drop, for the undo steps. */
  const history: Tree[] = [];
  const keys = Object.keys(tree);
  const summaries: string[] = [];

  const assertTree = async (expected: Tree, why: string) => {
    await expect.poll(async () => pick(await frameTree(frame), keys), { message: `${why}: the page`, timeout: 5_000 }).toEqual(pick(expected, keys));
    await expect.poll(() => storeTree(page, slug, fixture), { message: `${why}: the store`, timeout: 5_000 }).toEqual(expected);
  };
  /** The selection outline has caught up with the element's box, so the handles sit where the element is. */
  const overlaysSettled = async (id: string) => {
    await expect(selection).toHaveAttribute("data-element-id", id);
    await expect
      .poll(
        async () => {
          const a = await selection.boundingBox();
          const b = await el(frame, id).boundingBox();
          return a && b ? Math.max(Math.abs(a.x + 1 - b.x), Math.abs(a.y + 1 - b.y), Math.abs(a.width - 2 - b.width), Math.abs(a.height - 2 - b.height)) : 99;
        },
        { timeout: 5_000 },
      )
      .toBeLessThan(3);
  };

  for (const [number, step] of steps.entries()) {
    const title = `${number + 1}. ${step.name}`;
    await test.step(title, async () => {
      if (step.view) await setView(page, step.view);
      if (step.undoFirst) {
        const before = history.pop();
        if (!before) throw new Error("nothing to undo");
        await page.keyboard.press("ControlOrMeta+z");
        await assertTree(before, `${title}: after the undo`);
        tree = before;
      }
      if (step.select) {
        await centre(el(frame, step.select.id));
        await settled(page);
        await el(frame, step.select.id).click({ position: step.select.position });
        await expect(selection).toHaveAttribute("data-element-id", step.select.id);
        for (const key of [...Array<string>(step.select.thenLeft ?? 0).fill("ArrowLeft"), ...Array<string>(step.select.thenDown ?? 0).fill("ArrowDown")]) {
          const before = await selection.getAttribute("data-element-id");
          await page.keyboard.press(key);
          await expect(selection).not.toHaveAttribute("data-element-id", before ?? "");
        }
      }

      // What the drop must produce.
      const targetId = "into" in step.to ? step.to.into : "before" in step.to ? step.to.before : step.to.after;
      const edge = "into" in step.to ? "into" : "before" in step.to ? "before" : "after";
      const expected = applyMove(tree, step.drag, step.to);
      const expectedLabel = `${edge} ${labelOf(fixture.root, targetId)}`;
      const targetEl = el(frame, targetId);
      const sourceEl = el(frame, step.drag);

      // The flow at the target: a sibling beside it (the dragged element itself counts) means a row, so the line is vertical.
      const targetBox0 = await boxOf(targetEl);
      let axis: "x" | "y" = "y";
      if (edge !== "into") {
        for (const sibling of (tree[expected.parent] ?? []).filter((id) => id !== targetId)) {
          const box = await el(frame, sibling).boundingBox();
          if (box && Math.abs(box.y - targetBox0.y) < Math.max(box.height, targetBox0.height) / 2 && (box.x >= targetBox0.x + targetBox0.width - 1 || box.x + box.width <= targetBox0.x + 1)) axis = "x";
        }
      }
      /** The band edge to aim at, and the axis of the line it draws. */
      const bandEdge = step.bandEdge ?? (axis === "y" ? (edge === "before" ? "top" : "bottom") : edge === "before" ? "left" : "right");
      const lineAxis: "x" | "y" = step.aim === "band" ? (bandEdge === "left" || bandEdge === "right" ? "x" : "y") : axis;
      /** The drop point for the target's current box (the frame is at scale 1, so frame pixels are page pixels). */
      const dropFor = (box: Box): Point => {
        if (edge === "into") return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        if (step.aim === "band") {
          // Inside the target container's outer 8px, on the edge named.
          if (bandEdge === "top") return { x: box.x + box.width / 2, y: box.y + 3 };
          if (bandEdge === "bottom") return { x: box.x + box.width / 2, y: box.y + box.height - 3 };
          if (bandEdge === "left") return { x: box.x + 3, y: box.y + box.height / 2 };
          return { x: box.x + box.width - 3, y: box.y + box.height / 2 };
        }
        if (step.aim === "outside") {
          // Just past the target's edge, in its parent's padding.
          return axis === "y" ? { x: box.x + box.width / 2, y: edge === "before" ? box.y - 4 : box.y + box.height + 4 } : { x: edge === "before" ? box.x - 4 : box.x + box.width + 4, y: box.y + box.height / 2 };
        }
        // Well inside the target, on the named side of its midpoint (its first pixels may belong to its container's band).
        const size = axis === "y" ? box.height : box.width;
        const off = Math.max(10, Math.min(size * 0.3, 60));
        return axis === "y" ? { x: box.x + box.width / 2, y: edge === "before" ? box.y + off : box.y + box.height - off } : { x: edge === "before" ? box.x + off : box.x + box.width - off, y: box.y + box.height / 2 };
      };

      // The source on screen (a handle drag needs its top edge, where the tab sits, with room above), and its handles where it is.
      if (step.by === "handle") await sourceEl.evaluate((node) => (node.scrollIntoView({ block: "start", behavior: "instant" }), window.scrollBy({ top: -80, behavior: "instant" })));
      else await centre(sourceEl);
      await settled(page);
      let from: Point;
      if (step.by === "handle") {
        await overlaysSettled(step.drag);
        const box = await boxOf(page.getByTestId("element-move"));
        from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      } else if (step.by === "empty-area") {
        // A container by a spot of its own: the gap between its first two children that leave one, else its top-left padding.
        const box = await boxOf(sourceEl);
        from = { x: box.x + 4, y: box.y + 4 };
        const children = tree[step.drag] ?? [];
        for (let i = 0; i + 1 < children.length; i++) {
          const a = await boxOf(el(frame, children[i]!));
          const b = await boxOf(el(frame, children[i + 1]!));
          if (b.y - (a.y + a.height) >= 6) {
            from = { x: box.x + box.width / 2, y: (a.y + a.height + b.y) / 2 };
            break;
          }
        }
      } else {
        const box = await boxOf(sourceEl);
        from = step.grab ? { x: box.x + step.grab.x, y: box.y + step.grab.y } : { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      const sheetBox = await boxOf(sheet);
      expect(from.y, `${title}: the grab point is on screen`).toBeGreaterThan(sheetBox.y);
      expect(from.y, `${title}: the grab point is on screen`).toBeLessThan(sheetBox.y + sheetBox.height);

      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 6, from.y + 6);
      // Starts at once: the ghost is up after the threshold, nothing else clicked.
      await expect(ghost, `${title}: the drag starts`).toBeVisible({ timeout: 2_000 });
      await expect(ghost).toContainText(labelOf(fixture.root, step.drag));

      // A target off screen: hold the pointer in the sheet's edge band and let the editor scroll the frame to it.
      let drop = dropFor(await boxOf(targetEl));
      const onScreen = (point: Point) => point.y > sheetBox.y + SAFE && point.y < sheetBox.y + sheetBox.height - SAFE;
      if (!onScreen(drop)) {
        const edgeY = drop.y > sheetBox.y + sheetBox.height / 2 ? sheetBox.y + sheetBox.height - EDGE_BAND / 2 : sheetBox.y + EDGE_BAND / 2;
        await page.mouse.move(from.x + 6, edgeY, { steps: 4 });
        await expect
          .poll(
            async () => {
              drop = dropFor(await boxOf(targetEl));
              return onScreen(drop);
            },
            { message: `${title}: the frame scrolls the target into view`, timeout: 15_000 },
          )
          .toBe(true);
        // Out of the band, so the scrolling stops; then let the frame hold still before the final approach.
        await page.mouse.move(from.x + 6, sheetBox.y + sheetBox.height / 2, { steps: 2 });
        await expect
          .poll(
            async () => {
              const a = await boxOf(targetEl);
              await page.waitForTimeout(120);
              const b = await boxOf(targetEl);
              return Math.abs(a.y - b.y) < 0.5;
            },
            { message: `${title}: the frame holds still`, timeout: 10_000 },
          )
          .toBe(true);
        drop = dropFor(await boxOf(targetEl));
      }
      await page.mouse.move(drop.x, drop.y, { steps: 10 });
      await expect(page.getByTestId("drop-label"), `${title}: the ghost names the target`).toHaveText(expectedLabel);
      if (edge === "into") {
        await expect(page.getByTestId("drop-inside")).toBeVisible();
      } else {
        const line = page.getByTestId("drop-line");
        await expect(line).toBeVisible();
        if (expected.parent !== "root") await expect(page.getByTestId("drop-parent")).toHaveAttribute("data-element-id", expected.parent);
        // The line sits on the edge the label names.
        const lineBox = await boxOf(line);
        const target = await boxOf(targetEl);
        if (lineAxis === "y") expect(Math.abs(lineBox.y + 2 - (edge === "before" ? target.y : target.y + target.height)), `${title}: the line is on the ${edge} edge`).toBeLessThan(4);
        else expect(Math.abs(lineBox.x + 2 - (edge === "before" ? target.x : target.x + target.width)), `${title}: the line is on the ${edge} edge`).toBeLessThan(4);
      }
      await page.mouse.up();
      await expect(ghost).toHaveCount(0);

      // It landed where the line was, it is still selected, and nothing else moved.
      await assertTree(expected.tree, title);
      await expect(selection, `${title}: still selected`).toHaveAttribute("data-element-id", step.drag);
      history.push(tree);
      tree = expected.tree;
      summaries.push(`${title}: ${expectedLabel} (${expected.parent}[${expected.index}])`);
    });
  }
  return summaries;
}

async function openBuilder(page: Page, slug: string, fixture: "demo" | "treetestprep") {
  await installMocks(page, { fixture });
  await page.addInitScript(() => {
    window.localStorage.setItem("armature:visual:tour:v1", "done");
    window.localStorage.setItem("armature:builder:tour:v1", "done");
  });
  await page.goto(editorUrl(slug));
  await expect(page.getByTestId("visual-editor")).toHaveAttribute("data-builder", "on", { timeout: 30_000 });
  await expect(siteFrame(page).locator("html")).toHaveAttribute("data-armature-mode", "edit", { timeout: 30_000 });
  await expect(page.locator(`iframe[title$="live site"]`)).toHaveCSS("opacity", "1", { timeout: 15_000 });
  await setView(page, "phone");
}

// --- the demo site -------------------------------------------------------------------------------------------

/**
 * Home: hero (site section) · secbuild [hdbuilds, rowbuild [colleft1 [imgbuild], colrigh1 [txtbuild, btnbuild]]] ·
 * services · faq. On phones rowbuild stacks; on tablets it is a row.
 */
const demoSteps: Step[] = [
  { name: "a widget up, before its sibling, by the toolbar handle", drag: "btnbuild", by: "handle", to: { before: "txtbuild" }, select: { id: "btnbuild", position: { x: 4, y: 4 } } },
  { name: "the same widget straight back down, by the handle, nothing clicked", drag: "btnbuild", by: "handle", to: { after: "txtbuild" } },
  { name: "the same widget up again, by its own body", drag: "btnbuild", by: "body", to: { before: "txtbuild" } },
  { name: "a text into the other column, before its picture", drag: "txtbuild", by: "body", to: { before: "imgbuild" } },
  { name: "the picture to the last position of the other column", drag: "imgbuild", by: "body", to: { after: "btnbuild" } },
  { name: "the text out of its column to the section level, after the row (the section padding below it)", drag: "txtbuild", by: "body", to: { after: "rowbuild" }, aim: "outside" },
  { name: "the heading into the now-empty column", drag: "hdbuilds", by: "body", to: { into: "colleft1" } },
  { name: "after an undo, the heading after the text instead (the frame scrolls to it)", drag: "hdbuilds", by: "handle", to: { after: "txtbuild" }, undoFirst: true },
  { name: "the heading back before the row (the section padding above it), by the handle, back-to-back", drag: "hdbuilds", by: "handle", to: { before: "rowbuild" }, aim: "outside" },
  { name: "a column before its empty sibling column (its top band), by the grip in its tab", drag: "colrigh1", by: "handle", to: { before: "colleft1" }, aim: "band", select: { id: "btnbuild", position: { x: 4, y: 4 }, thenLeft: 1 } },
  { name: "the row by an empty area of it (the gap between its columns), after the text", drag: "rowbuild", by: "empty-area", to: { after: "txtbuild" } },
  { name: "a section to the first position of the page, by its grip", drag: "secbuild", by: "handle", to: { before: "sechero1" }, select: { id: "hdbuilds", thenLeft: 1 } },
  { name: "the picture up to the section level, before the heading, by the handle", drag: "imgbuild", by: "handle", to: { before: "hdbuilds" }, select: { id: "imgbuild" } },
  { name: "on a tablet the row is a row: the empty column to the left of its sibling (the left band)", drag: "colleft1", by: "handle", to: { before: "colrigh1" }, aim: "band", view: "tablet", select: { id: "btnbuild", position: { x: 4, y: 4 }, thenLeft: 1, thenDown: 1 } },
  { name: "the column back to the right (the right band), back-to-back", drag: "colleft1", by: "handle", to: { after: "colrigh1" }, aim: "band" },
  { name: "a widget into the row beside the columns, by its body: right of the empty column", drag: "btnbuild", by: "body", to: { after: "colleft1" }, aim: "band" },
  { name: "the same widget into the empty column, by its body", drag: "btnbuild", by: "body", to: { into: "colleft1" } },
  { name: "the picture down into the emptied right column, by the body", drag: "imgbuild", by: "body", to: { into: "colrigh1" } },
  { name: "back on the phone: after an undo the picture goes after the text instead", drag: "imgbuild", by: "handle", to: { after: "txtbuild" }, view: "phone", undoFirst: true },
  { name: "the row to the third position of the section, after the text, by the grip", drag: "rowbuild", by: "handle", to: { after: "txtbuild" }, select: { id: "btnbuild", position: { x: 4, y: 4 }, thenLeft: 2 } },
  { name: "the heading to the last position of the section, after the picture, by its body", drag: "hdbuilds", by: "body", to: { after: "imgbuild" } },
  { name: "the heading back to the first position, before the text, by the handle, back-to-back", drag: "hdbuilds", by: "handle", to: { before: "txtbuild" } },
];

test.describe("drag sequences on the demo site", () => {
  test("22 drags in a row: each lands at its line, stays selected and drags again at once", async ({ page }) => {
    test.setTimeout(240_000);
    await openBuilder(page, "home", "demo");
    const summary = await runSteps(page, "home", demoLayouts["home"] as Layout, demoSteps);
    expect(summary.length).toBe(demoSteps.length);
  });
});

// --- the real site -------------------------------------------------------------------------------------------

/**
 * Tree Test Prep home: hmhero00 · hmcourse (grid) [hmccopy0 [hmch2000, hmcmimg0, hmcwklst, hmcwknin, hmcexnot, hmcbtn00],
 * hmcimg00] · hmfaq000 [hmfqgrid (grid) [hmfqimg0, hmfqcont [hmfqh200, hmfqmimg, hmfqeye0, hmfqacc0]]].
 */
const realSteps: Step[] = [
  { name: "the course button above the course heading, by the handle", drag: "hmcbtn00", by: "handle", to: { before: "hmch2000" }, select: { id: "hmcbtn00", position: { x: 4, y: 4 } } },
  { name: "the same button back to the bottom, by the handle, nothing clicked", drag: "hmcbtn00", by: "handle", to: { after: "hmcexnot" } },
  { name: "the button between two texts, by its body", drag: "hmcbtn00", by: "body", to: { after: "hmcwklst" } },
  { name: "the course picture up before the heading, by its body", drag: "hmcmimg0", by: "body", to: { before: "hmch2000" } },
  { name: "the last text up to the first position, by its body", drag: "hmcexnot", by: "body", to: { before: "hmcmimg0" } },
  { name: "after an undo, that text after the button instead", drag: "hmcexnot", by: "handle", to: { after: "hmcbtn00" }, undoFirst: true },
  { name: "the heading out of its column to the grid level, after the column (the column's right band: a vertical line)", drag: "hmch2000", by: "body", to: { after: "hmccopy0" }, aim: "band", bandEdge: "right" },
  { name: "the heading back into the column, before the picture, by the handle, back-to-back", drag: "hmch2000", by: "handle", to: { before: "hmcmimg0" } },
  { name: "the FAQ eyebrow text out to the FAQ grid, after its column (the right band)", drag: "hmfqeye0", by: "body", to: { after: "hmfqcont" }, aim: "band", bandEdge: "right" },
  { name: "the FAQ mobile picture up before its heading, by its body (the desktop picture is hidden on phones)", drag: "hmfqmimg", by: "body", to: { before: "hmfqh200" } },
  { name: "the FAQ column by its grip, before the eyebrow text", drag: "hmfqcont", by: "handle", to: { before: "hmfqeye0" }, select: { id: "hmfqmimg", thenLeft: 1 } },
  { name: "the FAQ section before the course grid (the grid's top band, in its padding), by its grip", drag: "hmfaq000", by: "handle", to: { before: "hmcourse" }, aim: "band", select: { id: "hmfqmimg", thenLeft: 3 } },
];

test.describe("drag sequences on the real site", () => {
  test.skip(!process.env["REAL_SITE_DIR"] && !process.env["REAL_SITE_URL"], "needs the real site: REAL_SITE_DIR=<clone of acts2man/treetestprep at armature/git-content>");
  test("12 drags on Tree Test Prep's home page", async ({ page }) => {
    test.setTimeout(240_000);
    await openBuilder(page, "home", "treetestprep");
    const summary = await runSteps(page, "home", realLayouts["home"] as Layout, realSteps);
    expect(summary.length).toBe(realSteps.length);
  });
});
