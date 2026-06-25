import { describe, expect, it } from "vitest";
import { defaultBorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import { shapeCoastTerrain } from "./coastTerrain.js";
import { buildCoastMaterialWeights } from "./coastMaterials.js";

const palette = { materialIds: ["grass", "dirt", "rock", "snow"] };
const materials = defaultBorderCoastOceanConfig.materials;

function coastWith(
  materialWeights: Partial<ReturnType<typeof shapeCoastTerrain>["materialWeights"]>,
) {
  return {
    height: 0,
    affected: true,
    material: "inland" as const,
    materialWeights: {
      drySand: 0,
      wetSand: 0,
      shallowSeabed: 0,
      duneGrass: 0,
      cliffRock: 0,
      beachRock: 0,
      ...materialWeights,
    },
  };
}

describe("buildCoastMaterialWeights", () => {
  it("keeps inland material weights unchanged outside the coast", () => {
    const coast = { ...coastWith({}), affected: false };
    const result = buildCoastMaterialWeights({
      coast,
      materials,
      palette,
      inlandWeights: [1, 0, 0, 0],
    });

    expect(result.weights).toEqual([1, 0, 0, 0]);
  });

  it("blends inland dunes between sand and grass", () => {
    const result = buildCoastMaterialWeights({
      coast: coastWith({ drySand: 0.5, duneGrass: 0.5 }),
      materials,
      palette,
      inlandWeights: [1, 0, 0, 0],
    });

    expect(result.weights[0]).toBeGreaterThan(0);
    expect(result.weights[1]).toBeGreaterThan(0);
  });

  it("uses darker sand fallback when wet_sand is unavailable", () => {
    const result = buildCoastMaterialWeights({
      coast: coastWith({ wetSand: 1 }),
      materials,
      palette,
      inlandWeights: [1, 0, 0, 0],
    });

    expect(result.wetSandUsesFallback).toBe(true);
    expect(result.weights).toEqual([0, 1, 0, 0]);
  });

  it("blends rocky beaches, coves, and reefs between sand and rock", () => {
    for (const coast of [
      coastWith({ beachRock: 1 }),
      coastWith({ wetSand: 0.5, beachRock: 0.5 }),
      coastWith({ shallowSeabed: 0.5, beachRock: 0.5 }),
    ]) {
      const result = buildCoastMaterialWeights({
        coast,
        materials,
        palette,
        inlandWeights: [1, 0, 0, 0],
      });
      expect(result.weights[1]).toBeGreaterThan(0);
      expect(result.weights[2]).toBeGreaterThan(0);
      expect(result.weights.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    }
  });

  it("keeps cliffs rock-dominant and blends their tops with inland material", () => {
    const face = buildCoastMaterialWeights({
      coast: coastWith({ cliffRock: 1 }),
      materials,
      palette,
      inlandWeights: [1, 0, 0, 0],
    });
    const top = buildCoastMaterialWeights({
      coast: coastWith({ cliffRock: 0.4 }),
      materials,
      palette,
      inlandWeights: [0.5, 0.5, 0, 0],
    });

    expect(face.weights).toEqual([0, 0, 1, 0]);
    expect(top.weights[0]).toBeGreaterThan(0);
    expect(top.weights[1]).toBeGreaterThan(0);
    expect(top.weights[2]).toBeGreaterThan(0);
  });

  it("never resolves a water material into terrain weights", () => {
    const result = buildCoastMaterialWeights({
      coast: coastWith({ shallowSeabed: 1 }),
      materials,
      palette,
      inlandWeights: [1, 0, 0, 0],
    });

    expect(palette.materialIds).not.toContain("water");
    expect(result.weights).toEqual([0, 1, 0, 0]);
  });
});
