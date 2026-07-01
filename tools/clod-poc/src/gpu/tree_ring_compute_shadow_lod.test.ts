import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS, TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSettings } from "../trees/tree_config.js";
import {
  packTreeGpuRingParams,
  treeGpuRingShadowMaxLodIndex,
  type TreeGpuRingIndexCounts,
} from "./tree_ring_compute.js";

function createSettings(shadowsMaxLod: TreeSettings["lod"]["shadowsMaxLod"]): TreeSettings {
  return {
    ...DEFAULT_TREE_SETTINGS,
    lod: {
      ...DEFAULT_TREE_SETTINGS.lod,
      shadowsMaxLod,
    },
  };
}

function createIndexCounts(): TreeGpuRingIndexCounts {
  const counts = {} as TreeGpuRingIndexCounts;
  for (const species of TREE_SPECIES) {
    counts[species] = {} as Record<TreeLod, number>;
    for (const lod of TREE_LODS) counts[species][lod] = 0;
  }
  return counts;
}

describe("tree ring shadow LOD GPU params", () => {
  it.each([
    ["none", -1],
    ["near", 0],
    ["mid", 1],
    ["far", 2],
    ["impostor", 3],
  ] as const)("maps %s to %s", (shadowLod, expected) => {
    expect(treeGpuRingShadowMaxLodIndex(createSettings(shadowLod))).toBe(expected);
  });

  it("packs max shadow LOD into settings_e.z", () => {
    const scratch = packTreeGpuRingParams(createSettings("mid"), {
      centerX: 0,
      centerZ: 0,
      cameraY: 24,
      worldCells: 512,
      maxInstancesPerGroup: 128,
      maxShadowCastersPerGroup: 64,
      indexCounts: createIndexCounts(),
    });

    expect(new Float32Array(scratch)[26]).toBe(1);
  });
});
