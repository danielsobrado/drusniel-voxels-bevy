import { describe, expect, it } from "vitest";
import { DEFAULT_RENDER_RESOLUTION_CONFIG } from "./render_resolution_config.js";
import { resolveRenderResolution, resolveRenderResolutionQueryOverrides } from "./render_resolution.js";

describe("render resolution query", () => {
  it("uses the performance preset by default", () => {
    const resolution = resolveRenderResolution(DEFAULT_RENDER_RESOLUTION_CONFIG, {
      cssWidth: 1920,
      cssHeight: 1080,
      devicePixelRatio: 2,
    });

    expect(resolution.presetName).toBe("performance100");
    expect(resolution.dprCap).toBe(1.0);
    expect(resolution.renderScale).toBe(0.85);
    expect(resolution.effectivePixelRatio).toBe(0.85);
  });

  it("uses performance render preset for perf quality", () => {
    expect(resolveRenderResolutionQueryOverrides(new URLSearchParams({ quality: "perf" })).presetName)
      .toBe("performance100");
  });

  it("keeps explicit render preset above quality", () => {
    expect(resolveRenderResolutionQueryOverrides(new URLSearchParams({ quality: "perf", renderPreset: "high" })).presetName)
      .toBe("high");
  });
});
