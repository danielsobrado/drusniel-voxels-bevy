import { describe, expect, it } from "vitest";
import {
  PROCEDURAL_TERRAIN_DETAIL_SCALE_GAIN,
  resolveTerrainTextureScale,
} from "./terrain_texture_scale.js";

describe("terrain texture scale", () => {
  it("raises procedural texel density without changing external PBR scale", () => {
    expect(resolveTerrainTextureScale(0.06, 1, true)).toBeCloseTo(
      0.06 * PROCEDURAL_TERRAIN_DETAIL_SCALE_GAIN,
    );
    expect(resolveTerrainTextureScale(0.06, 1, false)).toBeCloseTo(0.06);
  });

  it("retains the user multiplier", () => {
    expect(resolveTerrainTextureScale(0.05, 1.5, true)).toBeCloseTo(0.3);
  });

  it("falls back safely for invalid values and clamps extreme scales", () => {
    expect(resolveTerrainTextureScale(Number.NaN, Number.NaN, false)).toBeCloseTo(1 / 64);
    expect(resolveTerrainTextureScale(10, 10, true)).toBe(2);
  });
});
