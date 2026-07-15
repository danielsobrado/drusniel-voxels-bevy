import { describe, expect, it } from "vitest";
import { deriveTreeInstanceMorphology } from "./derive.js";
import { MORPHOLOGY_RANGES } from "./constants.js";
import type {
  TreeCompetitionSample,
  TreeEcologySample,
  TreeIdentity,
  TreeTerrainSample,
} from "./types.js";

const identity: TreeIdentity = { stableIdLo: 0x12345678, stableIdHi: 0x9abcdef0 };
const terrain: TreeTerrainSample = {
  slope01: 0.42,
  downhillDirectionXZ: [0.6, 0.8],
  exposure01: 0.35,
  exposedRootPotential: 0.25,
};
const ecology: TreeEcologySample = {
  oldForestBias: 0.3,
  moisture: 0.7,
  moistureSuitability: 0.8,
  temperatureSuitability: 0.65,
  stress: 0.15,
};
const competition: TreeCompetitionSample = {
  crownPressure: 0.45,
  directionalPressure: 0.7,
  openLightDirectionXZ: [-0.8, 0.6],
};

describe("tree instance morphology derivation", () => {
  it("is deterministic for the full two-word identity", () => {
    const first = deriveTreeInstanceMorphology(identity, "oak", terrain, ecology, competition);
    const second = deriveTreeInstanceMorphology(identity, "oak", terrain, ecology, competition);
    expect(second).toEqual(first);
    expect(deriveTreeInstanceMorphology({ ...identity, stableIdHi: identity.stableIdHi + 1 }, "oak", terrain, ecology, competition))
      .not.toEqual(first);
  });

  it("keeps every prescribed channel inside its range", () => {
    const morphology = deriveTreeInstanceMorphology(identity, "willow", {
      slope01: 9,
      downhillDirectionXZ: [99, -99],
      exposure01: 9,
      exposedRootPotential: 9,
    }, {
      oldForestBias: 9,
      moisture: 9,
      moistureSuitability: -9,
      temperatureSuitability: 9,
      stress: 9,
    }, {
      crownPressure: 9,
      directionalPressure: 9,
      openLightDirectionXZ: [99, 99],
    });
    for (const [name, range] of Object.entries(MORPHOLOGY_RANGES)) {
      const value = morphology[name as keyof typeof morphology];
      expect(value, name).toBeGreaterThanOrEqual(range[0]);
      expect(value, name).toBeLessThanOrEqual(range[1]);
    }
    expect(Math.hypot(morphology.leanX, morphology.leanZ)).toBeLessThanOrEqual(0.22 + 1e-9);
    expect(Math.hypot(morphology.crownBiasX, morphology.crownBiasZ)).toBeLessThanOrEqual(0.35 + 1e-9);
  });

  it("applies the exact age equation", () => {
    const morphology = deriveTreeInstanceMorphology(identity, "pine", terrain, ecology, competition);
    expect(morphology.age01).toBeCloseTo(0.567613219022751, 8);
  });
});
