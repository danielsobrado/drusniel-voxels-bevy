import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS, TREE_LODS, TREE_SPECIES } from "./tree_config.js";
import { treeRingShadowCasterGroupCount } from "./tree_ring_shadow_casters.js";
import { generateTreeRingValidationCounts } from "./tree_ring_lighting_proxies.js";
import type { TreeTerrainSampler } from "./tree_instances.js";

const flatSampler: TreeTerrainSampler = {
  surfaceHeight: () => 24,
  surfaceNormal: () => [0, 1, 0],
  materialWeights: () => [1, 0, 0, 0],
};

describe("tree ring validation counts", () => {
  it("returns zero shadow counts when no cascade planes are provided", () => {
    const result = generateTreeRingValidationCounts({
      centerX: 64,
      centerZ: 64,
      worldCells: 128,
      settings: validationSettings(),
      sampler: flatSampler,
      maxInstancesPerGroup: 16,
      maxShadowCastersPerGroup: 16,
    });

    expect(result.shadowGroupCounts).toHaveLength(treeRingShadowCasterGroupCount());
    expect(result.shadowGroupCounts.reduce((sum, count) => sum + count, 0)).toBe(0);
    expect(result.shadowOverflowed).toBe(false);
  });

  it("counts shadow casters before visible-camera frustum culling", () => {
    const result = generateTreeRingValidationCounts({
      centerX: 64,
      centerZ: 64,
      worldCells: 128,
      settings: validationSettings(),
      sampler: flatSampler,
      maxInstancesPerGroup: 16,
      maxShadowCastersPerGroup: 16,
      frustumPlanes: rejectEverythingPlanes(),
      shadowCascadePlanes: acceptEverythingCascadePlanes(),
    });

    expect(result.counts.near + result.counts.mid + result.counts.far + result.counts.impostor).toBe(0);
    expect(result.shadowGroupCounts.reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
  });

  it("reports shadow caster overflow separately from visible overflow", () => {
    const result = generateTreeRingValidationCounts({
      centerX: 64,
      centerZ: 64,
      worldCells: 128,
      settings: validationSettings(),
      sampler: flatSampler,
      maxInstancesPerGroup: 9999,
      maxShadowCastersPerGroup: 1,
      shadowCascadePlanes: acceptEverythingCascadePlanes(),
    });

    expect(result.overflowed).toBe(false);
    expect(result.shadowOverflowed).toBe(true);
  });
});

function validationSettings() {
  const settings = structuredClone(DEFAULT_TREE_SETTINGS);
  settings.enabled = true;
  settings.seed = 7;
  settings.distanceM = 80;
  settings.gpu.maxVisible = 384;
  settings.placement.minHeightM = 0;
  settings.placement.maxHeightM = 128;
  settings.placement.slopeMinY = 0;
  settings.placement.minGroundWeight = 0;
  settings.ecology.density.baseDensity = 1;
  settings.ecology.clustering.clusterStrength = 0;
  settings.lod.nearFraction = 0.3;
  settings.lod.midFraction = 0.55;
  settings.lod.farFraction = 0.8;
  settings.lod.impostorFraction = 1;
  settings.lod.crossfadeBandM = 4;
  for (const species of TREE_SPECIES) settings.species[species].weight = species === "oak" ? 1 : 0;
  return settings;
}

function acceptEverythingCascadePlanes(): Float32Array {
  const planes = new Float32Array(4 * 6 * 4);
  for (let cascade = 0; cascade < 4; cascade++) {
    const base = cascade * 6 * 4;
    for (let plane = 0; plane < 6; plane++) planes[base + plane * 4 + 3] = 9999;
  }
  return planes;
}

function rejectEverythingPlanes(): Float32Array {
  const planes = new Float32Array(6 * 4);
  // x + constant < -slack for all in-world tree centers.
  planes[3] = -9999;
  return planes;
}
