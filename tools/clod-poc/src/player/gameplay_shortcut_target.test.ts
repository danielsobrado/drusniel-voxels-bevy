import { describe, expect, it } from "vitest";
import { consumesGameplayShortcut } from "./gameplay_shortcut_target.js";

describe("gameplay shortcut target", () => {
  it("allows gameplay shortcuts while non-text controls have focus", () => {
    expect(consumesGameplayShortcut("input", "checkbox", false)).toBe(false);
    expect(consumesGameplayShortcut("input", "range", false)).toBe(false);
    expect(consumesGameplayShortcut("button", "", false)).toBe(false);
  });

  it("protects text entry targets", () => {
    expect(consumesGameplayShortcut("input", "text", false)).toBe(true);
    expect(consumesGameplayShortcut("textarea", "", false)).toBe(true);
    expect(consumesGameplayShortcut("div", "", true)).toBe(true);
  });
});
