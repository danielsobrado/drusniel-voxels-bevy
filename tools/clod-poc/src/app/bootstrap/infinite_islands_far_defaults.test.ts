import { describe, expect, it } from "vitest";
import { applyInfiniteIslandsFarDefaults } from "./infinite_islands_far_defaults.js";

describe("infinite-islands far defaults", () => {
  it("promotes unified summary and single far-clipmap ownership", () => {
    const params = new URLSearchParams("scene=infinite-islands");

    expect(applyInfiniteIslandsFarDefaults(params)).toBe(true);
    expect(params.get("farSummaryLayout")).toBe("2");
    expect(params.get("farClipmap")).toBe("1");
    expect(params.get("farClipmapMode")).toBe("replace");
  });

  it("preserves the explicit legacy summary path", () => {
    const params = new URLSearchParams("scene=infinite-islands&farSummaryLayout=1");

    applyInfiniteIslandsFarDefaults(params);

    expect(params.get("farSummaryLayout")).toBe("1");
    expect(params.has("farClipmap")).toBe(false);
    expect(params.has("farClipmapMode")).toBe(false);
  });

  it("preserves explicit far-clipmap opt-outs", () => {
    const disabled = new URLSearchParams("scene=infinite-islands&farClipmap=0");
    const legacyMode = new URLSearchParams("scene=infinite-islands&farClipmapMode=legacy");

    applyInfiniteIslandsFarDefaults(disabled);
    applyInfiniteIslandsFarDefaults(legacyMode);

    expect(disabled.get("farSummaryLayout")).toBe("2");
    expect(disabled.get("farClipmap")).toBe("0");
    expect(disabled.has("farClipmapMode")).toBe(false);
    expect(legacyMode.get("farClipmap")).toBe("1");
    expect(legacyMode.get("farClipmapMode")).toBe("legacy");
  });

  it("does not change other scenes", () => {
    const params = new URLSearchParams("scene=continent");

    expect(applyInfiniteIslandsFarDefaults(params)).toBe(false);
    expect(params.toString()).toBe("scene=continent");
  });
});
