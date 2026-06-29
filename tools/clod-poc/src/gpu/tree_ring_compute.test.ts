import { describe, expect, it } from "vitest";
import treeRingShader from "./shaders/tree_ring.compute.wgsl?raw";
import treeNodeMaterialSource from "../trees/tree_node_material.ts?raw";
import { DEFAULT_TREE_SETTINGS } from "../trees/tree_config.js";
import {
  TREE_GPU_RING_CELL,
  TREE_GPU_RING_GROUP_COUNT,
  TREE_GPU_RING_SHADOW_GROUP_COUNT,
  packTreeGpuRingParams,
  resolveTreeGpuRingReadbackCounts,
  treeGpuRingBuildIndirectWorkgroups,
  treeGpuRingCounterWorkgroups,
  treeGpuRingCullWorkgroups,
  treeGpuRingGroupCapacity,
  treeGpuRingGroupIndex,
  treeGpuRingGrid,
  treeGpuRingKey,
  treeGpuRingRequestsDebugReadback,
  treeGpuRingSlotCount,
} from "./tree_ring_compute.js";
import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import { composeTreeRingShader } from "./wgsl_modules.js";

describe("tree GPU ring compute helpers", () => {
  it("derives a stable slot grid from the tree bubble distance", () => {
    const settings = { ...DEFAULT_TREE_SETTINGS, distanceM: 220 };
    const grid = treeGpuRingGrid(settings);

    expect(grid).toBe(Math.ceil((settings.distanceM * 2) / TREE_GPU_RING_CELL));
    expect(treeGpuRingSlotCount(settings)).toBe(grid * grid);
    expect(TREE_GPU_RING_GROUP_COUNT).toBe(12);
    expect(TREE_GPU_RING_SHADOW_GROUP_COUNT).toBe(48);
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
    const layout = treeRingSpeciesLayout(3, 4);
    const shadowPlanes = new Float32Array(96);
    shadowPlanes[0] = 7;
    shadowPlanes[95] = 9;
    const packed = packTreeGpuRingParams(settings, {
      centerX: 12,
      centerZ: 34,
      worldCells: 256,
      maxInstancesPerGroup: 99,
      maxShadowCastersPerGroup: 77,
      indexCounts: {
        oak: { near: 111, mid: 222, far: 333, impostor: 444 },
        pine: { near: 555, mid: 666, far: 777, impostor: 888 },
        dead: { near: 999, mid: 1111, far: 1222, impostor: 1333 },
      },
      frustumPlanes: new Float32Array([1, 0, 0, 5]),
      shadowCascadePlanes: shadowPlanes,
    });
    const f32 = new Float32Array(packed);
    const u32 = new Uint32Array(packed);

    expect(packed.byteLength).toBe(layout.paramBytes);
    expect(f32[0]).toBe(12);
    expect(f32[1]).toBe(34);
    expect(f32[2]).toBe(100);
    expect(f32[4]).toBe(25);
    expect(f32[5]).toBe(50);
    expect(f32[8]).toBeCloseTo(TREE_GPU_RING_CELL, 6);
    expect(u32[layout.indexCountsOffset]).toBe(111);
    expect(u32[layout.indexCountsOffset + 1]).toBe(222);
    expect(u32[layout.indexCountsOffset + 2]).toBe(333);
    expect(u32[layout.settingsOffset - 1]).toBe(1333);
    expect(u32[layout.settingsOffset]).toBe(99);
    expect(u32[layout.settingsOffset + 1]).toBe(treeGpuRingGrid(settings));
    expect(u32[layout.settingsOffset + 2]).toBe(1234);
    expect(u32[layout.settingsOffset + 3]).toBe(77);
    expect(f32[layout.materialDensityOffset]).toBeCloseTo(1.08, 4);
    expect(f32[layout.materialDensityOffset + 3]).toBeCloseTo(0.08, 4);
    expect(f32[layout.visiblePlanesOffset]).toBe(1);
    expect(f32[layout.visiblePlanesOffset + 3]).toBe(5);
    expect(f32[layout.shadowPlanesOffset]).toBe(7);
    expect(f32[layout.shadowPlanesOffset + 95]).toBe(9);
  });

  it("keeps current 3-species packing aligned with the dynamic layout helper", () => {
    const layout = treeRingSpeciesLayout(3, 4);

    expect(layout.groupCount).toBe(TREE_GPU_RING_GROUP_COUNT);
    expect(layout.shadowGroupCount).toBe(TREE_GPU_RING_SHADOW_GROUP_COUNT);
    expect(layout.settingsOffset).toBe(44);
    expect(layout.visiblePlanesOffset).toBe(64);
    expect(layout.shadowPlanesOffset).toBe(88);
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

  it("uses configured workgroup size for shader composition and dispatch sizing", () => {
    const settings = {
      ...DEFAULT_TREE_SETTINGS,
      gpu: { ...DEFAULT_TREE_SETTINGS.gpu, workgroupSize: 128 as const },
    };

    expect(composeTreeRingShader(128)).toContain("const TREE_WORKGROUP_SIZE: u32 = 128u;");
    expect(treeGpuRingCullWorkgroups(settings)).toBe(Math.ceil(treeGpuRingSlotCount(settings) / 128));
    expect(treeGpuRingCounterWorkgroups(settings)).toBe(Math.ceil((TREE_GPU_RING_SHADOW_GROUP_COUNT * 5) / 128));
    expect(treeGpuRingBuildIndirectWorkgroups(settings)).toBe(1);
    expect(treeGpuRingKey(settings, 256)).not.toBe(treeGpuRingKey(DEFAULT_TREE_SETTINGS, 256));
  });

  it("gates periodic debug counter readback behind readbackVisibleLists and debug consumers", () => {
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
    const validateOnly = {
      ...DEFAULT_TREE_SETTINGS,
      gpu: {
        ...DEFAULT_TREE_SETTINGS.gpu,
        readbackVisibleLists: true,
        debugShowGpuCounts: false,
        debugValidateAgainstCpu: true,
      },
    };

    expect(treeGpuRingRequestsDebugReadback(enabled, 0)).toBe(true);
    expect(treeGpuRingRequestsDebugReadback(enabled, 1)).toBe(false);
    expect(treeGpuRingRequestsDebugReadback(noReadback, 0)).toBe(false);
    expect(treeGpuRingRequestsDebugReadback(hiddenCounts, 0)).toBe(false);
    expect(treeGpuRingRequestsDebugReadback(validateOnly, 0)).toBe(true);
  });

  it("reports overflow from raw readback counters before clamping draw counts", () => {
    const raw = new Uint32Array(TREE_GPU_RING_GROUP_COUNT);
    raw[treeGpuRingGroupIndex("oak", "near")] = 5;
    raw[treeGpuRingGroupIndex("pine", "near")] = 2;
    raw[treeGpuRingGroupIndex("dead", "far")] = 3;

    const resolved = resolveTreeGpuRingReadbackCounts(raw, 3);

    expect(resolved.overflowed).toBe(true);
    expect(resolved.groupCounts[treeGpuRingGroupIndex("oak", "near")]).toBe(3);
    expect(resolved.counts.near).toBe(5);
    expect(resolved.counts.far).toBe(3);
  });
});

describe("tree GPU ring shader source", () => {
  it("contains visible and shadow compact/indirect entry points", () => {
    expect(treeRingShader).toContain("@binding(1) var<storage, read_write> counters");
    expect(treeRingShader).toContain("@binding(2) var<storage, read_write> indirect_args");
    expect(treeRingShader).toContain("@binding(3) var<storage, read_write> out_cell");
    expect(treeRingShader).toContain("@binding(4) var<storage, read_write> shadow_counters");
    expect(treeRingShader).toContain("@binding(5) var<storage, read_write> shadow_indirect_args");
    expect(treeRingShader).toContain("@binding(6) var<storage, read_write> out_shadow_cell");
    expect(treeRingShader).toContain("fn clear_counters");
    expect(treeRingShader).toContain("fn tree_cull");
    expect(treeRingShader).toContain("fn build_indirect_args");
    expect(treeRingShader).toContain("atomicAdd");
    expect(treeRingShader).toContain("TREE_GROUP_COUNT");
    expect(treeRingShader).toContain("TREE_SHADOW_GROUP_COUNT");
    expect(treeRingShader).toContain("shadow_group_index(cascade, species, lod)");
  });

  it("overlaps all adjacent LOD rings before the material dithers the transition", () => {
    expect(treeRingShader).toContain("tree_lod_ring(dist");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_NEAR, ring.lod_active.x");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_MID, ring.lod_active.y");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_FAR, ring.lod_active.z");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_IMPOSTOR, ring.lod_active.w");
    expect(treeRingShader).toContain("dist > params.center_radius.z + params.lod.w");
  });

  it("appends shadow casters before visible camera frustum culling", () => {
    const shadowIndex = treeRingShader.indexOf("append_shadow_lod_if_active(species, TREE_LOD_NEAR");
    const frustumIndex = treeRingShader.indexOf("if (!in_frustum(shadow_center, 8.0)) { return; }");

    expect(shadowIndex).toBeGreaterThan(0);
    expect(frustumIndex).toBeGreaterThan(shadowIndex);
    expect(treeRingShader).toContain("in_shadow_cascade_frustum(cascade, center, 12.0)");
    expect(treeRingShader).toContain("shadow_indirect_args[base + 4u] = group * max_per_group");
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
