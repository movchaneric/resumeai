import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsToggle } from "@/features/shortcuts/ShortcutsToggle";
import { SHORTCUTS_KEY, isTextField, useShortcuts } from "@/features/shortcuts/useShortcuts";
import { expectNoSeriousViolations } from "../../helpers/axe";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("useShortcuts", () => {
  it("is on by default", () => {
    expect(renderHook(() => useShortcuts()).result.current[0]).toBe(true);
  });

  it("keeps the choice in localStorage and shares it between hooks", () => {
    const a = renderHook(() => useShortcuts());
    const b = renderHook(() => useShortcuts());
    act(() => a.result.current[1](false));
    expect(window.localStorage.getItem(SHORTCUTS_KEY)).toBe("off");
    expect(b.result.current[0]).toBe(false);
    expect(renderHook(() => useShortcuts()).result.current[0]).toBe(false);
    act(() => a.result.current[1](true));
    expect(b.result.current[0]).toBe(true);
  });

  it("still works for the visit when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useShortcuts());
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
  });
});

describe("isTextField", () => {
  it("is true for text inputs and textareas, false for radios, buttons and the page", () => {
    const text = document.createElement("input");
    const radio = document.createElement("input");
    radio.type = "radio";
    expect(isTextField(text)).toBe(true);
    expect(isTextField(document.createElement("textarea"))).toBe(true);
    expect(isTextField(radio)).toBe(false);
    expect(isTextField(document.createElement("button"))).toBe(false);
    expect(isTextField(document.body)).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe("ShortcutsToggle", () => {
  it("is a labelled checkbox that switches the shortcuts off and on", async () => {
    const { container } = render(<ShortcutsToggle />);
    const box = screen.getByRole("checkbox", { name: "Keyboard shortcuts" });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(box).not.toBeChecked();
    expect(window.localStorage.getItem(SHORTCUTS_KEY)).toBe("off");
    await expectNoSeriousViolations(container);
  });
});
