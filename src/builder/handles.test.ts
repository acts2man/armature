/**
 * The maths behind the canvas handles, and how a drag lands in the history: one step
 * however slowly the pointer moves, dropped entirely by Esc.
 */
import { describe, expect, it } from "vitest";
import { apply, createHistory, dropGroup, GROUP_MS, undo, type EditorState } from "./history.ts";
import { dragHeight, dragSpacing, inwardDelta, keyDelta, resizeColumns, resizeImage, snapPercent } from "./handles.ts";

const measured = { top: 40, right: 20, bottom: 40, left: 20 };

describe("spacing handles", () => {
  it("grows padding as the handle moves inward and margin as it moves outward", () => {
    expect(inwardDelta("top", 0, 12)).toBe(12);
    expect(inwardDelta("bottom", 0, 12)).toBe(-12);
    expect(inwardDelta("left", 8, 0)).toBe(8);
    expect(inwardDelta("right", 8, 0)).toBe(-8);
    expect(dragSpacing(undefined, measured, "top", 10, { kind: "padding" })).toEqual({ top: { value: 50, unit: "px" } });
    expect(dragSpacing(undefined, measured, "top", -100, { kind: "padding" })).toEqual({ top: { value: 0, unit: "px" } });
    expect(dragSpacing(undefined, measured, "top", -100, { kind: "margin" })).toEqual({ top: { value: -60, unit: "px" } });
  });

  it("keeps the other sides, moves the opposite side with Alt and all four with Shift, adding up from the element's own value", () => {
    const current = { left: { value: 2, unit: "rem" as const }, top: { value: 30, unit: "px" as const } };
    expect(dragSpacing(current, measured, "top", 5, { kind: "padding", mode: "opposite" })).toEqual({ left: { value: 2, unit: "rem" }, top: { value: 35, unit: "px" }, bottom: { value: 35, unit: "px" } });
    const all = dragSpacing(current, measured, "top", 5, { kind: "padding", mode: "all" });
    expect([all.top, all.right, all.bottom, all.left]).toEqual(Array(4).fill({ value: 35, unit: "px" }));
    // A side set in rem starts from what the page measured and becomes pixels.
    expect(dragSpacing(current, measured, "left", 4, { kind: "padding" }).left).toEqual({ value: 24, unit: "px" });
  });
});

describe("resize handles", () => {
  it("moves the boundary between two columns, keeping their total and a 5% minimum", () => {
    expect(resizeColumns(400, 400, 800, 80)).toEqual([60, 40]);
    expect(resizeColumns(400, 400, 800, -1000)).toEqual([5, 95]);
    expect(resizeColumns(400, 400, 800, 80, 5, [33.3, 66.7])).toEqual([43.3, 56.7]);
    expect(resizeColumns(400, 400, 0, 80)).toEqual([400, 400]);
    // Near a usual split it snaps: 66% of the pair becomes two thirds.
    expect(resizeColumns(400, 400, 800, 130)).toEqual([66.7, 33.3]);
    expect(snapPercent(49)).toBe(50);
    expect(snapPercent(47)).toBe(47);
    expect(snapPercent(34)).toBe(33.3);
  });

  it("resizes an image in percent by default and in pixels when it already uses pixels", () => {
    expect(resizeImage(undefined, 600, 800, -200)).toEqual({ value: 50, unit: "%" });
    expect(resizeImage({ value: 100, unit: "%" }, 800, 800, -80)).toEqual({ value: 90, unit: "%" });
    expect(resizeImage({ value: 300, unit: "px" }, 300, 800, 50)).toEqual({ value: 350, unit: "px" });
    expect(resizeImage({ value: 300, unit: "px" }, 300, 800, 5000)).toEqual({ value: 800, unit: "px" });
    expect(resizeImage({ value: 10, unit: "%" }, 80, 800, -1000)).toEqual({ value: 5, unit: "%" });
    expect(resizeImage({ value: 100, unit: "%" }, 800, 800, -205)).toEqual({ value: 75, unit: "%" });
  });

  it("drags heights from the measured size, or the element's own pixels, within limits", () => {
    expect(dragHeight(50, 40)).toEqual({ value: 90, unit: "px" });
    expect(dragHeight(50, -100, 1)).toEqual({ value: 1, unit: "px" });
    expect(dragHeight(120, 10, 0, 2000, { value: 60, unit: "px" })).toEqual({ value: 70, unit: "px" });
    expect(dragHeight(120, 10, 0, 2000, "screen")).toEqual({ value: 130, unit: "px" });
  });

  it("maps arrow keys to a one-pixel nudge, ten with Shift, on the handle's axis only", () => {
    expect(keyDelta({ key: "ArrowDown", shiftKey: false }, "y")).toBe(1);
    expect(keyDelta({ key: "ArrowUp", shiftKey: true }, "y")).toBe(-10);
    expect(keyDelta({ key: "ArrowLeft", shiftKey: false }, "x")).toBe(-1);
    expect(keyDelta({ key: "ArrowLeft", shiftKey: false }, "y")).toBeNull();
  });
});

describe("a drag in the history", () => {
  const state = (n: number) => ({ n }) as unknown as EditorState;
  const step = (n: number, group: string) => ({ label: "Padding top", group, run: () => state(n) });

  it("is one step however long the pointer rests, and Esc removes it without a redo", () => {
    let history = createHistory(state(0));
    history = apply(history, step(1, "drag:padding-top:abc:1"), 1000);
    history = apply(history, step(2, "drag:padding-top:abc:1"), 1000 + GROUP_MS * 5);
    expect(history.past).toHaveLength(1);
    expect(history.present).toEqual(state(2));
    // A second drag is a second step.
    history = apply(history, step(3, "drag:padding-top:abc:2"), 1000 + GROUP_MS * 6);
    expect(history.past).toHaveLength(2);
    const dropped = dropGroup(history, "drag:padding-top:abc:2");
    expect(dropped.present).toEqual(state(2));
    expect(dropped.past).toHaveLength(1);
    expect(dropped.future).toHaveLength(0);
    expect(dropGroup(dropped, "drag:other")).toBe(dropped);
    expect(undo(dropped).present).toEqual(state(0));
  });

  it("keyboard groups still split after a pause", () => {
    let history = createHistory(state(0));
    history = apply(history, step(1, "key:padding-top:abc"), 1000);
    history = apply(history, step(2, "key:padding-top:abc"), 1000 + GROUP_MS + 1);
    expect(history.past).toHaveLength(2);
  });
});
