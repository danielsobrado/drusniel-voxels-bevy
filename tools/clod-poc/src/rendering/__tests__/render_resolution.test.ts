import { describe, expect, it } from "vitest";
import { resolveRenderResolution } from "../render_resolution.js";
import { DEFAULT_RENDER_RESOLUTION_CONFIG } from "../render_resolution_config.js";

const baseConfig = DEFAULT_RENDER_RESOLUTION_CONFIG;

describe("resolveRenderResolution", () => {
  it("caps browser DPR before applying render scale", () => {
    const result = resolveRenderResolution(baseConfig, {
      cssWidth: 1920,
      cssHeight: 1080,
      devicePixelRatio: 2.0,
      overrideDprCap: 1.5,
      overrideRenderScale: 1.0,
    });

    expect(result.effectivePixelRatio).toBe(1.5);
    expect(result.physicalWidth).toBe(2880);
    expect(result.physicalHeight).toBe(1620);
  });

  it("applies performance100 render scale", () => {
    const result = resolveRenderResolution(baseConfig, {
      cssWidth: 1920,
      cssHeight: 1080,
      devicePixelRatio: 2.0,
      presetName: "performance100",
    });

    expect(result.effectivePixelRatio).toBe(0.85);
    expect(result.physicalWidth).toBe(1632);
    expect(result.physicalHeight).toBe(918);
  });

  it("lets manual override beat preset", () => {
    const result = resolveRenderResolution(baseConfig, {
      cssWidth: 1920,
      cssHeight: 1080,
      devicePixelRatio: 2.0,
      presetName: "high",
      overrideDprCap: 1.0,
      overrideRenderScale: 0.75,
    });

    expect(result.effectivePixelRatio).toBe(0.75);
  });

  it("clamps to the minimum effective pixel ratio", () => {
    const result = resolveRenderResolution(baseConfig, {
      cssWidth: 1920,
      cssHeight: 1080,
      devicePixelRatio: 1.0,
      overrideDprCap: 1.0,
      overrideRenderScale: 0.1,
    });

    expect(result.effectivePixelRatio).toBe(0.5);
  });

  it("clamps to the maximum effective pixel ratio", () => {
    const result = resolveRenderResolution(baseConfig, {
      cssWidth: 1920,
      cssHeight: 1080,
      devicePixelRatio: 4.0,
      overrideDprCap: 4.0,
      overrideRenderScale: 1.0,
    });

    expect(result.effectivePixelRatio).toBe(2.0);
  });

  it("handles invalid browser DPR safely", () => {
    const result = resolveRenderResolution(baseConfig, {
      cssWidth: 1920,
      cssHeight: 1080,
      devicePixelRatio: Number.NaN,
    });

    expect(result.rawDevicePixelRatio).toBe(1.0);
    expect(result.effectivePixelRatio).toBe(1.0);
  });

  it("keeps aspect inputs in CSS pixels", () => {
    const result = resolveRenderResolution(baseConfig, {
      cssWidth: 1280,
      cssHeight: 720,
      devicePixelRatio: 2.0,
      presetName: "high",
    });

    expect(result.cssWidth / result.cssHeight).toBe(1280 / 720);
    expect(result.physicalWidth).toBe(1920);
    expect(result.physicalHeight).toBe(1080);
  });
});
