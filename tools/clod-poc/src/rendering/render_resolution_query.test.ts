import { describe, expect, it } from "vitest";
import { resolveRenderResolutionQueryOverrides } from "./render_resolution.js";

describe("render resolution query", () => {
  it("uses performance render preset for perf quality", () => {
    expect(resolveRenderResolutionQueryOverrides(new URLSearchParams({ quality: "perf" })).presetName)
      .toBe("performance100");
  });

  it("keeps explicit render preset above quality", () => {
    expect(resolveRenderResolutionQueryOverrides(new URLSearchParams({ quality: "perf", renderPreset: "high" })).presetName)
      .toBe("high");
  });
});
