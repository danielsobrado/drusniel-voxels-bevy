import { describe, expect, it } from "vitest";
import treeRingShader from "./shaders/tree_ring.compute.wgsl?raw";
import treeNodeMaterialSource from "../trees/tree_node_material.ts?raw";
import { DEFAULT_TREE_SETTINGS, TREE_SPECIES, type TreeLod, type TreeSpeciesId } from "../trees/tree_config.js";
import {
  TREE_GPU_RING_CELL,
  TREE_GPU_RING_GROUP_COUNT,
  TREE_GPU_RING_SHADOW_GROUP_COUNT,
  packTreeGpuRingParams,
  resolveTreeGpuRingReadbackCounts,
  resolveTreeGpuRingShadowReadbackCounts,
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

function withGpuReadbacks(search: string, run: () => void): void {
  const root = globalThis as typeof globalThis & { window?: { location?: { search?: string } } };
  const previous = root.window;
  root.window = { location: { search } } as typeof root.window;
  try {
    run();
  } finally {
    root.window = previous;
  }
}

describe("tree GPU ring compute helpers", () => {
  it("derives a stable slot grid from the tree bubble distance", () => {
    const settings = { ...DEFAULT_TREE_SETTINGS, distanceM: 220 };
    const grid = treeGpuRingGrid(settings);

    expect(grid).toBe(Math.ceil((settings.distanceM * 2) / TREE_GPU_RING_CELL));
    expect(treeGpuRingSlotCount(settings)).toBe(grid * grid);
    expect(TREE_GPU_RING_GROUP_COUNT).toBe(TREE_SPECIES.length * 4);
    expect(TREE_GPU_RING_SHADOW_GROUP_COUNT).toBe(TREE_SPECIES.length * 4 * 4);
  });

  it("packs ring dispatch params in the WGSL uniform layout", () => {
    const settings = {
      ...DEFAULT_TREE_SETTINGS,
      seed: 1234,
      distanceM: 100,
      gpu: {
        ...DEFAULT_TREE_SETTINGS.gpu,
        maxVisible: 200,
        terrainVisibility: {
          ...DEFAULT_TREE_SETTINGS.gpu.terrainVisibility,
          minDistanceM: 144,
          sampleCount: 9,
          heightMarginM: 2.5,
          crownHeightM: 8,
        },
      },
      lod: {
        ...DEFAULT_TREE_SETTINGS.lod,
        nearFraction: 0.25,
        midFraction: 0.5,
        farFraction: 0.75,
        impostorFraction: 1,
        crossfadeEnabled: true,
        crossfadeBandM: 24,
      },
    };
    const layout = treeRingSpeciesLayout(TREE_SPECIES.length, 4);
    const shadowPlanes = new Float32Array(96);
    shadowPlanes[0] = 7;
    shadowPlanes[95] = 9;
    const packed = packTreeGpuRingParams(settings, {
      centerX: 12,
      centerZ: 34,
      cameraY: 56,
      worldCells: 256,
      unboundedWorld: true,
      maxInstancesPerGroup: 99,
      maxShadowCastersPerGroup: 77,
      indexCounts: testIndexCounts(),
      frustumPlanes: new Float32Array([1, 0, 0, 5]),
      shadowCascadePlanes: shadowPlanes,
    });
    const f32 = new Float32Array(packed);
    const u32 = new Uint32Array(packed);

    expect(packed.byteLength).toBe(layout.paramBytes);
    expect(f32[0]).toBe(12);
    expect(f32[1]).toBe(34);
    expect(f32[2]).toBe(100);
    expect(f32[27]).toBe(56);
    expect(f32[4]).toBe(25);
    expect(f32[5]).toBe(50);
    expect(f32[7]).toBe(0);
    expect(f32[8]).toBeCloseTo(TREE_GPU_RING_CELL, 6);
    expect(u32[layout.indexCountsOffset]).toBe(111);
    expect(u32[layout.indexCountsOffset + 1]).toBe(222);
    expect(u32[layout.indexCountsOffset + 2]).toBe(333);
    expect(f32[layout.terrainVisibilityOffset]).toBe(1);
    expect(f32[layout.terrainVisibilityOffset + 1]).toBe(144);
    expect(f32[layout.terrainVisibilityOffset + 2]).toBe(2.5);
    expect(f32[layout.terrainVisibilityOffset + 3]).toBe(8);
    expect(u32[layout.terrainVisibilityUOffset]).toBe(9);
    expect(u32[layout.terrainVisibilityUOffset + 1]).toBe(2);
    expect(u32[layout.settingsOffset - 1]).toBeGreaterThan(0);
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

  it("keeps compute constants aligned with the dynamic layout helper", () => {
    const layout = treeRingSpeciesLayout(TREE_SPECIES.length, 4);

    expect(layout.groupCount).toBe(TREE_GPU_RING_GROUP_COUNT);
    expect(layout.shadowGroupCount).toBe(TREE_GPU_RING_SHADOW_GROUP_COUNT);
    expect(layout.speciesWeightsOffset).toBe(28);
  });

  it("uses independent flags for debug readback and unbounded terrain", () => {
    expect(treeRingShader).toContain("(params.terrain_visibility_u.y & 1u) != 0u");
    expect(treeRingShader).toContain("(params.terrain_visibility_u.y & 2u) != 0u");
    expect(treeRingShader).toContain("if (!tree_unbounded_world()");
    expect(treeRingShader).not.toContain("fieldParams.islandEnabled == 0u");
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
    })).toBe(Math.max(1, Math.floor(99 / TREE_GPU_RING_GROUP_COUNT)));
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

  it("keeps tree count readbacks off by default", () => {
    const readbackOnly = {
      ...DEFAULT_TREE_SETTINGS,
      gpu: { ...DEFAULT_TREE_SETTINGS.gpu, readbackVisibleLists: true, debugShowGpuCounts: false },
    };

    expect(treeGpuRingRequestsDebugReadback(readbackOnly, 0)).toBe(false);
  });

  it("runs periodic readback only after explicit debug opt-in", () => {
    const readbackOnly = {
      ...DEFAULT_TREE_SETTINGS,
      gpu: { ...DEFAULT_TREE_SETTINGS.gpu, readbackVisibleLists: true, debugShowGpuCounts: false },
    };
    const noReadback = {
      ...DEFAULT_TREE_SETTINGS,
      gpu: {
        ...DEFAULT_TREE_SETTINGS.gpu,
        readbackVisibleLists: false,
        debugShowGpuCounts: true,
        debugValidateAgainstCpu: false,
      },
    };
    const validateOnly = {
      ...DEFAULT_TREE_SETTINGS,
      gpu: {
        ...DEFAULT_TREE_SETTINGS.gpu,
        readbackVisibleLists: false,
        debugShowGpuCounts: false,
        debugValidateAgainstCpu: true,
      },
    };

    withGpuReadbacks("?gpuReadbacks=debug", () => {
      expect(treeGpuRingRequestsDebugReadback(readbackOnly, 0)).toBe(true);
      expect(treeGpuRingRequestsDebugReadback(readbackOnly, 1)).toBe(false);
      expect(treeGpuRingRequestsDebugReadback(noReadback, 0)).toBe(false);
      expect(treeGpuRingRequestsDebugReadback(validateOnly, 0)).toBe(true);
    });
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

  it("reports overflow from raw shadow caster readback counters before clamping", () => {
    const raw = new Uint32Array(TREE_GPU_RING_SHADOW_GROUP_COUNT);
    raw[0] = 6;
    raw[TREE_GPU_RING_SHADOW_GROUP_COUNT - 1] = 2;

    const resolved = resolveTreeGpuRingShadowReadbackCounts(raw, 4);

    expect(resolved.overflowed).toBe(true);
    expect(resolved.groupCounts).toHaveLength(TREE_GPU_RING_SHADOW_GROUP_COUNT);
    expect(resolved.groupCounts[0]).toBe(4);
    expect(resolved.groupCounts[TREE_GPU_RING_SHADOW_GROUP_COUNT - 1]).toBe(2);
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

  it("can append each LOD group, while runtime params select one hard LOD", () => {
    expect(treeRingShader).toContain("tree_lod_ring(dist");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_NEAR, ring.lod_active.x");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_MID, ring.lod_active.y");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_FAR, ring.lod_active.z");
    expect(treeRingShader).toContain("append_lod_if_active(species, TREE_LOD_IMPOSTOR, ring.lod_active.w");
  });

  it("writes the canonical 96-byte tree record with inline morphology", () => {
    expect(treeRingShader).toContain("const TREE_INSTANCE_VEC4S: u32 = 6u");
    expect(treeRingShader).toContain("struct VegetationTreeInstance");
    expect(treeRingShader).toContain("out_cell[base + 5u] = record.morphology2");
    expect(treeRingShader).toContain("out_shadow_cell[base + 5u] = record.morphology2");
    expect(treeRingShader).toContain("MORPH_FOLIAGE_CARD_CHANNEL: u32 = 0x1109u");
  });

  it("samples competition from world positions with the same species channel as the CPU oracle", () => {
    expect(treeRingShader).toContain("fn tree_competition_sample(wpos: vec2<f32>, species: u32)");
    expect(treeRingShader).toContain("floor((wpos + direction * radius_m) / 3.4)");
    expect(treeRingShader).not.toContain("floor((wpos + direction * radius_m) / max(params.settings_a.x, 0.001))");
    expect(treeRingShader).toContain("params.settings_u.z ^ 0x1005u ^ species");
  });
});

describe("tree GPU ring material source", () => {
  it("keeps render-side ring LOD dithering out of the WebGPU material", () => {
    expect(treeNodeMaterialSource).not.toContain("function treeRingLodMask");
    expect(treeNodeMaterialSource).toContain("GPU ring LOD selection is resolved by compute");
    expect(treeNodeMaterialSource).toContain("treeRingHash(worldCell");
  });
});

function testIndexCounts(): Record<TreeSpeciesId, Record<TreeLod, number>> {
  return Object.fromEntries(TREE_SPECIES.map((species, speciesIndex) => [species, {
    near: 111 + speciesIndex * 444,
    mid: 222 + speciesIndex * 444,
    far: 333 + speciesIndex * 444,
    impostor: 444 + speciesIndex * 444,
  }])) as Record<TreeSpeciesId, Record<TreeLod, number>>;
}
