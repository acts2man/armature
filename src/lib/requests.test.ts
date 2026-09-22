import { describe, expect, it } from "vitest";
import { requestSteps } from "./requests.ts";

describe("requestSteps", () => {
  it("marks the current status and everything before it", () => {
    const steps = requestSteps({ status: "ready_for_review" });
    expect(steps.map((step) => step.state)).toEqual(["done", "done", "current", "todo"]);
    expect(steps[2]?.detail).toContain("Take a look");
  });

  it("finishes every step when the request is done", () => {
    expect(requestSteps({ status: "done" }).every((step) => step.state === "done")).toBe(true);
  });

  it("shows a declined request as sent, then declined", () => {
    const steps = requestSteps({ status: "declined" });
    expect(steps.map((step) => step.title)).toEqual(["Request sent", "Declined"]);
    expect(steps[1]?.state).toBe("current");
  });
});
