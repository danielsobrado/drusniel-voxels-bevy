import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS, type TreeSettings } from "./tree_config.js";
import { treeLodDistances } from "./tree_lod.js";
import { treeRingLodParams } from "./tree_ring_math.js";
import { composeTreeRingShader } from "../gpu/wgsl_modules.js";

// The GPU ring picks tree LOD from treeRingLodParams -> packed params -> tree_lod_ring (WGSL);
// the CPU path picks from treeLodDistances -> lodForDistance. If those thresholds diverge, the
// two paths render different LODs for the same distance ("only one LOD" is that class of bug).
// treeRingLodParams now derives from treeLodDistances, and these lock it against re-divergence.

const customSettings: TreeSettings = {
  ...DEFAULT_TREE_SETTINGS,
  distanceM: 512,
  lod: {
    ...DEFAULT_TREE_SETTINGS.lod,
    nearFraction: 0.2,
    midFraction: 0.45,
    farFraction: 0.7,
    impostorEndM: 900,
  },
};

describe("CPU/GPU tree LOD threshold parity", () => {
  it("the GPU ring LOD thresholds equal the CPU selection thresholds", () => {
    for (const settings of [DEFAULT_TREE_SETTINGS, customSettings]) {
      const cpu = treeLodDistances(settings);
      const gpu = treeRingLodParams(settings);
      expect(gpu.near).toBe(cpu.near);
      expect(gpu.mid).toBe(cpu.mid);
      expect(gpu.far).toBe(cpu.far);
      expect(gpu.radius).toBe(cpu.impostor);
    }
  });

  it("the composed ring shader selects LOD by the same ascending near/mid/far/radius ladder", () => {
    const shader = composeTreeRingShader();
    expect(shader).toContain("if (dist <= near_m) { lod_active.x = 1u;");
    expect(shader).toContain("else if (dist <= mid_m) { lod_active.y = 1u;");
    expect(shader).toContain("else if (dist <= far_m) { lod_active.z = 1u;");
    expect(shader).toContain("else if (dist <= radius_m) { lod_active.w = 1u;");
  });
});
