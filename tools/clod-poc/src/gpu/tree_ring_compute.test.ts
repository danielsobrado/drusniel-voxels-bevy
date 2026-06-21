import { describe, expect, it } from "vitest";
import treeRingShader from "./shaders/tree_ring.compute.wgsl?raw";
import treeNodeMaterialSource from "../trees/tree_node_material.ts?raw";
import { DEFAULT_TREE_SETTINGS } from "../trees/tree_config.js";
import {
  TREE_GPU_RING_CELL,
  TREE_GPU_RING_GROUP_COUNT,
  packTreeGpuRingParams,
  treeGpuRingCullWorkgroups,
  treeGpuRingGroupCapacity,
  treeGpuRingGrid,
  treeGpuRingKey,
  treeGpuRingRequestsDebugReadback,
  treeGpuRingSlotCount,
} from "./tree_ring_compute.js";
import { composeTreeRingShader } from "./wgsl_modules.js";

describe("tree GPU ring compute helpers", () => {
  it("derives a stable slot grid from the tree bubble distance", () => {
    const settings = { ...DEFAULT_TREE_SETTINGS, distanceM: 220 };
    const grid = treeGpuRingGrid(settings);

    expect(grid).toBe(Math.ceil((settings.distanceM * 2) / TREE_GPU_RING_CELL));
    expect(treeGpuRingSlotCount(settings)).toBe(grid * grid);
    expect(TREE_GPU_RING_GROUP_COUNT).toBe(12);
  });

  it("packs ring dispatch params in the WGSL uniform layout", () => {
    const settings = {
      ...DEFAULT_TREE_SETTINGS,
      seed: 1234,
      distanceM: 100,
      gpu: { ...DEFAULT_TREE_SETTINGS.gpu, maxVisible: 200 },
      lod: {
        ...DEFAULT_TREE_SETTINGS.lod,
        nearFraction: 0.25,
        midFraction: 0.5,
        farFraction: 0.75,
        impostorFraction: 1,
      },
    };
    const packed = packTreeGpuRingParams(settings, {
      centerX: 12,
      centerZ: 34,
      worldCells: 256,
      maxInstancesPerGroup: 99,
      indexCounts: {
        oak: { near: 111, mid: 222, far: 333, impostor: 444 },
        pine: { near: 555, mid: 666, far: 777, impostor: 888 },
        dead: { near: 999, mid: 1111, far: 1222, impostor: 1333 },
      },
      frustumPlanes: new Float32Array([1, 0, 0, 5]),
    });
    const f32 = new Float32Array(packed);
    const u32 = new Uint32Array(packed);

    expect(f32[0]).toBe(12);
    expect(f32[1]).toBe(34);
    expect(f32[2]).toBe(100);
    expect(f32[4]).toBe(25);
    expect(f32[5]).toBe(50);
    expect(f32[8]).toBeCloseTo(TREE_GPU_RING_CELL, 6);
    expect(u32[32]).toBe(111);
    expect(u32[33]).toBe(222);
    expect(u32[34]).toBe(333);
    expect(u32[43]).toBe(1333);
    expect(u32[44]).toBe(99);
    expect(u32[45]).toBe(treeGpuRingGrid(settings));
    expect(u32[46]).toBe(1234);
    expect(f32[48]).toBe(1);
    expect(f32[51]).toBe(5);
  });

  it("keys ring resources by settings that affect scatter and draw capacity", () => {
    const first = treeGpuRingKey(DEFAULT_TREE_SETTINGS, 256);
    const second = treeGpuRingKey({
      ...DEFAULT_TREE_SETTINGS,
      distanceM: DEFAULT_TREE_SETTINGS.distanceM + 1,
    }, 256);

    expect(first).not.toBe(second);
    expect(treeGpuRingGroupCapacity({
      ...DEFAULT_TREE_SETTINGS,
      gpu: { ...DEFAULT_TREE_SETTINGS.gpu, maxVisible: 99 },
    })).toBe(8);
  });

  it("uses configured workgroup size for shader composition and cull dispatch sizing", () => {
    const settings = {
      ...DEFAULT_TREE_SETTINGS,
      gpu: { ...DEFAULT_TREE_SETTINGS.gpu, workgroupSize: 128 as const },
    };

    expect(composeTreeRingShader(128)).toContain("const TREE_WORKGROUP_SIZE: u32 = 128u;");
    expect(treeGpuRingCullWorkgroups(settings)).toBe(Math.ceil(treeGpuRingSlotCount(settings) / 128));
    expect(treeGpuRingKey(settings, 256)).not.toBe(treeGpuRingKey(DEFAULT_TREE_SETTINGS, 256));
  });

  it("gates periodic debug counter readback behind readbackVisibleLists and HUD counts", () => {
    const enabled = {
      ...DEFAULT_TREE_SETTINGS,
      gpu: { ...DEFAULT_TREE_SETTINGS.gpu, readbackVisibleLists: true, debugShowGpuCounts: true },
    };
    const noReadback = {
      ...DEFAULT_TREE_SETTINGS,
      gpu: { ...DEFAULT_TREE_SETTINGS.gpu, readbackVisibleLists: false, debugShowGpuCounts: true },
    };
    const hiddenCounts = {
      ...DEFAULT_TREE_SETTINGS,
      gpu: { ...DEFAULT_TREE_SETTINGS.gpu, readbackVisibleLists: true, debugShowGpuCounts: false },
    };

    expect(treeGpuRingRequestsDebugReadback(enabled, 0)).toBe(true);
    expect(treeGpuRingRequestsDebugReadback(enabled, 1)).toBe(false);
    expect(treeGpuRingRequestsDebugReadback(noReadback, 0)).toBe(false);
    expect(treeGpuRingRequestsDebugReadback(hiddenCounts, 0)).toBe(false);
  });
});

describe("tree GPU ring shader source", () => {
  it("contains the Stage 1 compact and indirect entry points", () => {
    expect(treeRingShader).toContain("@binding(1) var<storage, read_write> counters");
    expect(treeRingShader).toContain("@binding(2) var<storage, read_write> indirect_args");
    expect(treeRingShader).toContain("@binding(3) var<storage, read_write> out_cell");
    expect(treeRingShader).toContain("fn clear_counters");
    expect(treeRingShader).toContain("fn tree_cull");
    expect(treeRingShader).toContain("fn build_indirect_args");
    expect(treeRingShader).toContain("atomicAdd");
    expect(treeRingShader).toContain("TREE_GROUP_COUNT");
    expect(treeRingShader).toContain("group_index(species, lod)");
  });

  it("overlaps all adjacent LOD rings before the material dithers the transition", () => {
    expect(treeRingShader).toContain("tree_lod_ring(dist");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_NEAR, ring.active.x");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_MID, ring.active.y");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_FAR, ring.active.z");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_IMPOSTOR, ring.active.w");
    expect(treeRingShader).toContain("dist > params.center_radius.z + params.lod.w");
  });
});

describe("tree GPU ring material source", () => {
  it("uses complementary dither comparisons for ring LODs", () => {
    expect(treeNodeMaterialSource).toContain("function treeRingLodMask");
    expect(treeNodeMaterialSource).toContain("const passOut = (fade: TslNode): TslNode => ign.lessThan(fade)");
    expect(treeNodeMaterialSource).toContain("const passIn = (fade: TslNode): TslNode => ign.greaterThanEqual(float(1).sub(fade))");
    expect(treeNodeMaterialSource).toContain("uFadeCenter");
    expect(treeNodeMaterialSource).toContain("treeRingHash(worldCell");
  });
});
