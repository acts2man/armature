// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { Modal, Pill, Segmented, Toggle, monogram } from "./ui.tsx";

afterEach(cleanup);

describe("monogram", () => {
  it("takes the initials of the first two words, or two letters of a single word", () => {
    expect(monogram("Harbor Bakery")).toBe("HB");
    expect(monogram("Cedar Roofing Co.")).toBe("CR");
    expect(monogram("Acme")).toBe("AC");
    expect(monogram("  ")).toBe("?");
  });
});

describe("Pill", () => {
  it("maps every tone to a soft background and readable text", () => {
    render(
      <MemoryRouter>
        <Pill tone="green">Live</Pill>
        <Pill tone="amber">Draft</Pill>
        <Pill tone="blue">New</Pill>
        <Pill tone="grey">None</Pill>
      </MemoryRouter>,
    );
    expect(screen.getByText("Live").className).toContain("bg-green-soft");
    expect(screen.getByText("Draft").className).toContain("bg-amber-soft");
    expect(screen.getByText("New").className).toContain("bg-blue-soft");
    expect(screen.getByText("None").className).toContain("bg-grey-soft");
  });
});

describe("Toggle", () => {
  it("is a real switch with a name, and reports the new value", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Turn on Media" />);
    const toggle = screen.getByRole("switch", { name: "Turn on Media" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Segmented", () => {
  it("marks the active option pressed and switches on click", () => {
    const onChange = vi.fn();
    render(<Segmented label="Show" value="open" onChange={onChange} options={[{ value: "open", label: "Open" }, { value: "all", label: "All" }]} />);
    expect(screen.getByRole("button", { name: "Open" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenCalledWith("all");
  });
});

describe("Modal", () => {
  it("renders a labelled dialog, closes on Escape, and renders nothing when closed", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="Remove this person?">
        Body
      </Modal>,
    );
    expect(screen.getByRole("dialog", { name: "Remove this person?" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    rerender(
      <Modal open={false} onClose={onClose} title="Remove this person?">
        Body
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
