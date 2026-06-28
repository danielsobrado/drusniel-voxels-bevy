import { describe, expect, it } from "vitest";
import { DEFAULT_ISLAND_SHAPE_CONFIG, applyIslandShape, resolveIslandShapeConfig, sampleIslandMask } from "./island_shape.js";

describe("island shape config", () => {
  it("sanitizes non-finite numeric config instead of leaking NaN", () => {
    const resolved = resolveIslandShapeConfig({
      seaLevel: Number.NaN,
      seed: Number.NaN,
      spacingM: Number.NaN,
      radiusM: Number.NaN,
      blendM: Number.NaN,
      warpStrengthM: Number.NaN,
      beachWidthM: Number.NaN,
      cliffWidthM: Number.NaN,
      worldRadiusM: Number.NaN,
      oceanRimDropM: Number.NaN,
    });

    expect(resolved.seaLevel).toBe(DEFAULT_ISLAND_SHAPE_CONFIG.seaLevel);
    expect(resolved.seed).toBe(DEFAULT_ISLAND_SHAPE_CONFIG.seed);
    expect(resolved.spacingM).toBe(DEFAULT_ISLAND_SHAPE_CONFIG.spacingM);
    expect(resolved.radiusM).toBe(DEFAULT_ISLAND_SHAPE_CONFIG.radiusM);
    expect(resolved.blendM).toBe(DEFAULT_ISLAND_SHAPE_CONFIG.blendM);
    expect(resolved.warpStrengthM).toBe(DEFAULT_ISLAND_SHAPE_CONFIG.warpStrengthM);
    expect(resolved.beachWidthM).toBe(DEFAULT_ISLAND_SHAPE_CONFIG.beachWidthM);
    expect(resolved.cliffWidthM).toBe(DEFAULT_ISLAND_SHAPE_CONFIG.cliffWidthM);
    expect(resolved.worldRadiusM).toBe(DEFAULT_ISLAND_SHAPE_CONFIG.worldRadiusM);
    expect(resolved.oceanRimDropM).toBe(DEFAULT_ISLAND_SHAPE_CONFIG.oceanRimDropM);
  });

  it("clamps positive distance fields to safe minimums", () => {
    const resolved = resolveIslandShapeConfig({
      spacingM: -1,
      radiusM: -1,
      blendM: -1,
      warpStrengthM: -1,
      beachWidthM: -1,
      cliffWidthM: -1,
      worldRadiusM: -1,
      oceanRimDropM: -1,
    });

    expect(resolved.spacingM).toBe(64);
    expect(resolved.radiusM).toBe(16);
    expect(resolved.blendM).toBe(1);
    expect(resolved.warpStrengthM).toBe(0);
    expect(resolved.beachWidthM).toBe(1);
    expect(resolved.cliffWidthM).toBe(1);
    expect(resolved.worldRadiusM).toBe(1);
    expect(resolved.oceanRimDropM).toBe(1);
  });

  it("keeps mask and shaped height finite with hostile config", () => {
    const hostile = {
      enabled: true,
      oceanRim: true,
      spacingM: Number.NaN,
      radiusM: Number.NaN,
      blendM: Number.NaN,
      warpStrengthM: Number.NaN,
      beachWidthM: Number.NaN,
      cliffWidthM: Number.NaN,
      worldRadiusM: Number.NaN,
      oceanRimDropM: Number.NaN,
    };

    const mask = sampleIslandMask(100, -200, hostile);
    expect(Number.isFinite(mask.mask)).toBe(true);
    expect(Number.isFinite(mask.shoreDistanceM)).toBe(true);
    expect(Number.isFinite(mask.nearestCenterX)).toBe(true);
    expect(Number.isFinite(mask.nearestCenterZ)).toBe(true);
    expect(Number.isFinite(mask.cliffWeight)).toBe(true);
    expect(Number.isFinite(applyIslandShape(100, -200, 64, hostile))).toBe(true);
  });
});
