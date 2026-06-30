import { describe, expect, it } from "vitest";
import {
  assertWaterOwnershipIsRuntimeOnly,
  createWaterOwnershipStats,
  summarizeWaterOwnership,
  type WaterOwnershipStats,
} from "./waterOwnership.js";

describe("water ownership", () => {
  it("assigns enabled CLOD-POC water to runtime renderers only", () => {
    const stats = createWaterOwnershipStats({
      waterEnabled: true,
      clipmapEnabled: true,
      deepOceanEnabled: true,
    });

    expect(stats.clipmapSurfaces).toBe(1);
    expect(stats.deepOceanSurfaces).toBe(1);
    expect(stats.terrainClodSurfaces).toBe(0);
    expect(() => assertWaterOwnershipIsRuntimeOnly(stats)).not.toThrow();
  });

  it("reports hidden ownership when water is disabled", () => {
    const stats = createWaterOwnershipStats({
      waterEnabled: false,
      clipmapEnabled: true,
      deepOceanEnabled: true,
    });

    expect(stats.hiddenSurfaces).toBe(1);
    expect(stats.clipmapSurfaces).toBe(0);
    expect(stats.deepOceanSurfaces).toBe(0);
    expect(stats.terrainClodSurfaces).toBe(0);
  });

  it("throws if any water surface is assigned to CLOD pages", () => {
    const invalid: WaterOwnershipStats = {
      clipmapSurfaces: 0,
      deepOceanSurfaces: 0,
      hiddenSurfaces: 0,
      fallbackSurfaces: 0,
      terrainClodSurfaces: 1,
    };

    expect(() => assertWaterOwnershipIsRuntimeOnly(invalid)).toThrow(/CLOD terrain pages/);
  });

  it("summarizes owners using stable debug keys", () => {
    const stats = createWaterOwnershipStats({
      waterEnabled: true,
      clipmapEnabled: true,
      deepOceanEnabled: false,
      fallbackUsed: true,
    });

    expect(summarizeWaterOwnership(stats)).toEqual({
      clipmap: 1,
      deep_ocean: 0,
      hidden: 0,
      fallback: 1,
      terrain_clod: 0,
    });
  });
});
