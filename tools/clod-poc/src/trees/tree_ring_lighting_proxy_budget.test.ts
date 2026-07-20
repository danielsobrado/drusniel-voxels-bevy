import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS, TREE_SPECIES } from "./tree_config.js";
import {
  createTreeRingLightingProxyBuild,
  finishTreeRingLightingProxyBuild,
  generateTreeRingLightingProxies,
  stepTreeRingLightingProxyBuild,
} from "./tree_ring_lighting_proxies.js";
import { TreeGpuLightingProxyCache } from "./tree_system_gpu_lighting_proxy_cache.js";
import type { TreeTerrainSampler } from "./tree_instances.js";

const sampler: TreeTerrainSampler = {
  surfaceHeight: () => 24,
  surfaceNormal: () => [0, 1, 0],
  materialWeights: () => [1, 0, 0, 0],
};

function oldDeadline(): number {
  return performance.now() - 1;
}

function settings() {
  const out = structuredClone(DEFAULT_TREE_SETTINGS);
  out.enabled = true;
  out.seed = 7;
  out.distanceM = 80;
  out.gpu.maxVisible = 384;
  out.placement.minHeightM = 0;
  out.placement.maxHeightM = 128;
  out.placement.slopeMinY = 0;
  out.placement.minGroundWeight = 0;
  out.ecology.density.baseDensity = 1;
  out.ecology.clustering.clusterStrength = 0;
  out.lod.nearFraction = 0.3;
  out.lod.midFraction = 0.55;
  out.lod.farFraction = 0.8;
  out.lod.impostorEndM = 80;
  out.lod.crossfadeBandM = 4;
  out.lod.shadowsMaxLod = "impostor";
  for (const id of TREE_SPECIES) out.species[id].weight = id === "oak" ? 1 : 0;
  return out;
}

function options(centerX: number, treeSettings = settings()) {
  return { centerX, centerZ: 64, worldCells: 128, settings: treeSettings, sampler };
}

describe("budgeted tree lighting proxy build", () => {
  it("matches the monolithic result when stepped", () => {
    const input = options(64);
    const expected = generateTreeRingLightingProxies(input);
    const build = createTreeRingLightingProxyBuild(input);
    let guard = 0;
    while (!stepTreeRingLightingProxyBuild(build, oldDeadline()) && ++guard < 1_000_000) {}
    expect(guard).toBeGreaterThan(1);
    expect(finishTreeRingLightingProxyBuild(build)).toEqual(expected);
  });

  it("keeps the previous proxy set while a new key is still building", () => {
    const cache = new TreeGpuLightingProxyCache();
    const first = cache.getBudgeted(options(64), Number.POSITIVE_INFINITY);
    const stale = cache.getBudgeted(options(96), oldDeadline());
    expect(first.ready).toBe(true);
    expect(stale.ready).toBe(false);
    expect(stale.proxies).toBe(first.proxies);
  });
});
