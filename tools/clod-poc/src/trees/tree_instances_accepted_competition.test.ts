import { describe, expect, it } from "vitest";
import { cloneTreeSettings, generateTreeInstances, TREE_SPECIES } from "./index.js";

const flatSampler = {
  surfaceHeight: () => 20,
  surfaceNormal: (): [number, number, number] => [0, 1, 0],
  materialWeights: (): [number, number, number, number] => [1, 0, 0, 0],
};

describe("CPU tree accepted-canopy morphology", () => {
  it("derives morphology from retained neighbors after spacing acceptance", () => {
    const settings = cloneTreeSettings();
    settings.ecology.enabled = false;
    settings.placement.spacingM = 8;
    settings.placement.jitter = 0;
    settings.placement.minGroundWeight = 0;
    settings.placement.minSpacingM = 0;
    for (const species of TREE_SPECIES) {
      settings.species[species].enabled = species === "oak";
      settings.species[species].weight = species === "oak" ? 1 : 0;
    }

    const isolated = generateTreeInstances(
      { minX: 0, minZ: 0, maxX: 8, maxZ: 8 },
      settings,
      100,
      undefined,
      flatSampler,
      256,
    );
    const crowded = generateTreeInstances(
      { minX: 0, minZ: 0, maxX: 24, maxZ: 24 },
      settings,
      100,
      undefined,
      flatSampler,
      256,
    );

    expect(isolated).toHaveLength(1);
    const target = crowded.find((candidate) =>
      candidate.identity.stableIdLo === isolated[0]!.identity.stableIdLo
      && candidate.identity.stableIdHi === isolated[0]!.identity.stableIdHi
    );
    expect(target).toBeDefined();
    expect(target!.morphology.age01).toBeLessThan(isolated[0]!.morphology.age01);
    expect(target!.morphology.crownWidth).toBeLessThan(isolated[0]!.morphology.crownWidth);
    expect(target!.morphology.health01).toBeLessThan(isolated[0]!.morphology.health01);
    expect(target!.morphology.foliageDensity).toBeLessThan(isolated[0]!.morphology.foliageDensity);
  });
});
