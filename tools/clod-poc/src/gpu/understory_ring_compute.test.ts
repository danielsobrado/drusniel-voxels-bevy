import { describe, expect, it } from "vitest";
import understoryRingShader from "./shaders/understory_ring.compute.wgsl?raw";
import { DEFAULT_UNDERSTORY_SETTINGS, UNDERSTORY_CLASSES } from "../understory/understory_config.js";
import {
  understoryRingCullWorkgroups,
  understoryRingGroupCapacity,
  understoryRingGroupClass,
  understoryRingRequestsDebugReadback,
  understoryRingSlotCount,
  UNDERSTORY_RING_GROUP_COUNT,
} from "../understory/understory_ring_math.js";
import {
  packUnderstoryRingClassParams,
  packUnderstoryRingParams,
  resolveUnderstoryRingReadbackCounts,
  understoryRingCell,
  understoryRingGrid,
} from "../understory/understory_ring_math.js";
import { composeUnderstoryRingShader } from "./wgsl_modules.js";
import { UNDERSTORY_GPU_RING_STORAGE_BINDINGS, understoryGpuRingComputeUnsupportedReason } from "./understory_ring_compute.js";

describe("understory GPU ring compute helpers", () => {
  it("derives a stable slot grid from the understory spacing", () => {
    const grid = understoryRingGrid(DEFAULT_UNDERSTORY_SETTINGS);
    const expected = Math.ceil((DEFAULT_UNDERSTORY_SETTINGS.distanceM * 2) / DEFAULT_UNDERSTORY_SETTINGS.placement.spacingM);
    expect(grid).toBe(expected);
    expect(understoryRingSlotCount(DEFAULT_UNDERSTORY_SETTINGS)).toBe(grid * grid);
    expect(UNDERSTORY_RING_GROUP_COUNT).toBe(UNDERSTORY_CLASSES.length);
    expect(UNDERSTORY_RING_GROUP_COUNT).toBe(6);
  });

  it("splits maxVisible evenly across class groups", () => {
    expect(understoryRingGroupCapacity(DEFAULT_UNDERSTORY_SETTINGS)).toBe(2000);
    expect(understoryRingGroupCapacity({
      ...DEFAULT_UNDERSTORY_SETTINGS,
      gpu: { ...DEFAULT_UNDERSTORY_SETTINGS.gpu, maxVisible: 6000 },
    })).toBe(1000);
  });

  it("covers every slot with at least one workgroup", () => {
    const workgroups = understoryRingCullWorkgroups(DEFAULT_UNDERSTORY_SETTINGS);
    expect(workgroups * DEFAULT_UNDERSTORY_SETTINGS.gpu.workgroupSize).toBeGreaterThanOrEqual(understoryRingSlotCount(DEFAULT_UNDERSTORY_SETTINGS));
  });

  it("uses configured workgroup size for shader composition and cull dispatch sizing", () => {
    const settings128 = {
      ...DEFAULT_UNDERSTORY_SETTINGS,
      gpu: { ...DEFAULT_UNDERSTORY_SETTINGS.gpu, workgroupSize: 128 as const },
    };
    expect(composeUnderstoryRingShader(128)).toContain("const UNDERSTORY_WORKGROUP_SIZE: u32 = 128u;");
    expect(understoryRingCullWorkgroups(settings128)).toBe(Math.ceil(understoryRingSlotCount(settings128) / 128));
  });
});

describe("understory ring debug readback gating", () => {
  it("gates periodic debug counter readback behind readbackVisibleLists and debug consumers", () => {
    const enabled = {
      ...DEFAULT_UNDERSTORY_SETTINGS,
      gpu: { ...DEFAULT_UNDERSTORY_SETTINGS.gpu, readbackVisibleLists: true, debugShowGpuCounts: true },
    };
    const noReadback = {
      ...DEFAULT_UNDERSTORY_SETTINGS,
      gpu: { ...DEFAULT_UNDERSTORY_SETTINGS.gpu, readbackVisibleLists: false, debugShowGpuCounts: true },
    };
    const hiddenCounts = {
      ...DEFAULT_UNDERSTORY_SETTINGS,
      gpu: { ...DEFAULT_UNDERSTORY_SETTINGS.gpu, readbackVisibleLists: true, debugShowGpuCounts: false },
    };
    const validateOnly = {
      ...DEFAULT_UNDERSTORY_SETTINGS,
      gpu: {
        ...DEFAULT_UNDERSTORY_SETTINGS.gpu,
        readbackVisibleLists: true,
        debugShowGpuCounts: false,
        debugValidateAgainstCpu: true,
      },
    };

    expect(understoryRingRequestsDebugReadback(enabled, 0)).toBe(true);
    expect(understoryRingRequestsDebugReadback(enabled, 1)).toBe(false);
    expect(understoryRingRequestsDebugReadback(noReadback, 0)).toBe(false);
    expect(understoryRingRequestsDebugReadback(hiddenCounts, 0)).toBe(false);
    expect(understoryRingRequestsDebugReadback(validateOnly, 0)).toBe(true);
  });
});

describe("understory ring readback resolution", () => {
  it("clamps counts to capacity and flags overflow", () => {
    const cap = 100;
    const raw = new Uint32Array([10, 100, 150, 0, 50, 99]);
    const resolved = resolveUnderstoryRingReadbackCounts(raw, cap);
    expect(resolved.groupCounts).toEqual([10, 100, 100, 0, 50, 99]);
    expect(resolved.overflowed).toBe(true);
    expect(resolved.counts[understoryRingGroupClass(2)]).toBe(100);
  });

  it("does not flag overflow when all groups are within capacity", () => {
    const resolved = resolveUnderstoryRingReadbackCounts([1, 2, 3, 4, 5, 6], 100);
    expect(resolved.overflowed).toBe(false);
  });
});

describe("understory ring param packing", () => {
  it("writes globals at the documented lanes including indexCount", () => {
    const s = { ...DEFAULT_UNDERSTORY_SETTINGS, seed: 4242 };
    const buffer = packUnderstoryRingParams(s, {
      centerX: 100,
      centerZ: 200,
      worldCells: 1024,
      maxInstancesPerGroup: 2000,
      indexCount: 36,
    });
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    expect(f32[0]).toBeCloseTo(100);
    expect(f32[1]).toBeCloseTo(200);
    expect(f32[2]).toBeCloseTo(s.distanceM);
    expect(f32[3]).toBeCloseTo(1024);
    expect(f32[4]).toBeCloseTo(understoryRingCell(s));
    expect(f32[7]).toBeCloseTo(s.placement.slopeMinY);
    expect(u32[24]).toBe(2000);
    expect(u32[25]).toBe(understoryRingGrid(s));
    expect(u32[26]).toBe(4242);
    expect(u32[27]).toBe(UNDERSTORY_RING_GROUP_COUNT);
    expect(u32[28]).toBe(36);
  });

  it("packs one class param row per class", () => {
    const rows = packUnderstoryRingClassParams(DEFAULT_UNDERSTORY_SETTINGS);
    expect(rows.length).toBe(UNDERSTORY_RING_GROUP_COUNT * 8);
    UNDERSTORY_CLASSES.forEach((cls, index) => {
      const base = index * 8;
      expect(rows[base + 0]).toBeCloseTo(DEFAULT_UNDERSTORY_SETTINGS.classes[cls].weight);
      expect(rows[base + 1]).toBeCloseTo(DEFAULT_UNDERSTORY_SETTINGS.classes[cls].density);
      expect(rows[base + 6]).toBe(DEFAULT_UNDERSTORY_SETTINGS.classes[cls].enabled ? 1 : 0);
    });
  });
});

describe("understory GPU ring storage binding limit", () => {
  it("reports unsupported reason when device limit is too low", () => {
    const mockDevice = {
      limits: { maxStorageBuffersPerShaderStage: 4 },
    } as unknown as GPUDevice;
    const reason = understoryGpuRingComputeUnsupportedReason(mockDevice);
    expect(reason).toContain("requires");
    expect(reason).toContain(String(UNDERSTORY_GPU_RING_STORAGE_BINDINGS));
  });

  it("returns null when device limit is sufficient", () => {
    const mockDevice = {
      limits: { maxStorageBuffersPerShaderStage: 12 },
    } as unknown as GPUDevice;
    expect(understoryGpuRingComputeUnsupportedReason(mockDevice)).toBeNull();
  });
});

describe("understory GPU ring shader source", () => {
  it("contains the Stage 1 compact and indirect entry points", () => {
    expect(understoryRingShader).toContain("@binding(1) var<storage, read_write> counters");
    expect(understoryRingShader).toContain("@binding(2) var<storage, read_write> indirect_args");
    expect(understoryRingShader).toContain("@binding(3) var<storage, read_write> out_cell");
    expect(understoryRingShader).toContain("@binding(4) var<storage, read> class_params");
    expect(understoryRingShader).toContain("fn clear_counters");
    expect(understoryRingShader).toContain("fn understory_cull");
    expect(understoryRingShader).toContain("fn build_indirect_args");
    expect(understoryRingShader).toContain("atomicAdd");
    expect(understoryRingShader).toContain("UNDERSTORY_GROUP_COUNT");
  });

  it("ports the ecology and class selection from the CPU path", () => {
    expect(understoryRingShader).toContain("fn sample_understory_ecology");
    expect(understoryRingShader).toContain("fn understory_class_weight");
    expect(understoryRingShader).toContain("fn understory_acceptance");
    expect(understoryRingShader).toContain("fn understory_fractalNoise2D");
    expect(understoryRingShader).toContain("fn understory_valueNoise2D");
    expect(understoryRingShader).toContain("fn understory_hash2");
    expect(understoryRingShader).toContain("fn understory_pcg2d");
  });

  it("uses the noise fallback for forest influence (no tree texture)", () => {
    expect(understoryRingShader).toContain("base_forest = understory_fractalNoise2D(x, z, forest_scale");
    expect(understoryRingShader).not.toContain("treeInfluence");
  });

  it("applies coarser sub-grid gating for dead_log and stump groups", () => {
    expect(understoryRingShader).toContain("selected_group == 4u || selected_group == 5u");
    expect(understoryRingShader).toContain("floor(wc / 2.0)");
  });
});
