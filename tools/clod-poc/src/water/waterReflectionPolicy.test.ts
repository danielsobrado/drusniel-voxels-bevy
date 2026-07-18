import { describe, expect, it } from "vitest";
import { cloneWaterConfig, resolveWaterReflectionPolicy } from "./index.js";

describe("water reflection policy", () => {
  it("keeps the default CLOD-POC reflection path on safe sky/terrain fallback", () => {
    const config = cloneWaterConfig();
    const policy = resolveWaterReflectionPolicy(config.visual.reflection, "webgl");

    expect(policy.requestedMode).toBe("fake");
    expect(policy.activeMode).toBe("sky_terrain_fallback");
    expect(policy.ssrRequested).toBe(false);
    expect(policy.ssrActive).toBe(false);
    expect(policy.fallbackStrength).toBeGreaterThan(0);
  });

  it("activates wired SSR on WebGPU and keeps the miss fallback", () => {
    const config = cloneWaterConfig();
    config.visual.reflection.mode = "ssr";
    config.visual.reflection.ssrEnabled = true;

    const policy = resolveWaterReflectionPolicy(config.visual.reflection, "webgpu");

    expect(policy.ssrRequested).toBe(true);
    expect(policy.ssrActive).toBe(true);
    expect(policy.activeMode).toBe("ssr");
    expect(policy.reason).toContain("screen-space reflection");
    expect(policy.fallbackStrength).toBeGreaterThan(0);
  });

  it("falls back safely when SSR is requested on WebGL", () => {
    const config = cloneWaterConfig();
    config.visual.reflection.mode = "ssr";
    config.visual.reflection.ssrEnabled = true;

    const policy = resolveWaterReflectionPolicy(config.visual.reflection, "webgl");

    expect(policy.ssrRequested).toBe(true);
    expect(policy.ssrActive).toBe(false);
    expect(policy.activeMode).toBe("sky_terrain_fallback");
    expect(policy.reason).toContain("requires WebGPU");
  });

  it("clamps combined fallback strength to the valid debug range", () => {
    const config = cloneWaterConfig();
    config.visual.reflection.skyFallbackStrength = 0.9;
    config.visual.reflection.terrainFallbackStrength = 0.9;

    const policy = resolveWaterReflectionPolicy(config.visual.reflection, "webgl");

    expect(policy.fallbackStrength).toBe(1);
  });
});
