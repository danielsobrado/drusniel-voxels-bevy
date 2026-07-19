import { describe, expect, it } from "vitest";
import { consumesConstructionShortcut } from "./construction_controller_ui.js";

describe("construction shortcut focus filtering", () => {
  it("does not suppress build shortcuts for focused non-text inputs", () => {
    expect(consumesConstructionShortcut("input", "checkbox", false)).toBe(false);
    expect(consumesConstructionShortcut("input", "radio", false)).toBe(false);
    expect(consumesConstructionShortcut("input", "range", false)).toBe(false);
  });

  it("suppresses build shortcuts while editing text", () => {
    expect(consumesConstructionShortcut("input", "text", false)).toBe(true);
    expect(consumesConstructionShortcut("textarea", "", false)).toBe(true);
    expect(consumesConstructionShortcut("div", "", true)).toBe(true);
  });
});
