import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLOD_RUNTIME_CONFIG,
  parseClodRuntimeConfig,
  resolveSlowFrameMsThreshold,
} from "./runtime_config.js";

describe("parseClodRuntimeConfig", () => {
  it("parses bundled clod_runtime.yaml defaults", () => {
    const config = parseClodRuntimeConfig();
    expect(config.runtime.worldOptions).toEqual([2, 4, 8, 16, 32]);
    expect(config.webgpuSelection.errorMaxAgeFrames).toBe(6);
    expect(config.webgpuSelection.dispatchIntervalFrames).toBe(2);
    expect(config.webgpuSelection.parityIntervalFrames).toBe(60);
    expect(config.webgpuSelection.errorTolerancePx).toBe(0.02);
    expect(config.terrainTextures.textureArraySize).toBe(512);
    expect(config.nearField.chunkGroupBuildBudget).toBe(1);
    expect(config.digging.holdIntervalMs).toBe(400);
    expect(config.profiling.slowFrameMs).toBe(24);
  });

  it("falls back to defaults on invalid yaml", () => {
    expect(parseClodRuntimeConfig("not: [valid")).toEqual(DEFAULT_CLOD_RUNTIME_CONFIG);
  });
});

describe("resolveSlowFrameMsThreshold", () => {
  it("uses profileMs query param when positive", () => {
    const params = new URLSearchParams("profileMs=16");
    expect(resolveSlowFrameMsThreshold(params, 24)).toBe(16);
  });

  it("falls back to configured default", () => {
    const params = new URLSearchParams();
    expect(resolveSlowFrameMsThreshold(params, 24)).toBe(24);
  });
});
