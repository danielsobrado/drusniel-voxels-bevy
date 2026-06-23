import { describe, expect, it } from "vitest";
import { DEFAULT_GRASS_SETTINGS } from "../grass/grass_config.js";
import { computeGrassDensityScale } from "../grass/grass_math.js";
import {
  GRASS_GPU_RING_STORAGE_BINDINGS,
  grassGpuRingDensityParams,
  grassGpuRingOutputIndex,
  grassGpuRingTierRegion,
  grassGpuRingComputeUnsupportedReason,
  packGrassGpuRingParams,
} from "./grass_ring_compute.js";
import { composeGrassRingShader } from "./wgsl_modules.js";
import shaderSource from "./shaders/grass_ring.compute.wgsl?raw";

function deviceWithStorageBufferLimit(limit: number): GPUDevice {
  return {
    limits: {
      maxStorageBuffersPerShaderStage: limit,
    },
  } as unknown as GPUDevice;
}

describe("grass ring compute capabilities", () => {
  it("rejects devices below the storage-buffer count required by the compute layout", () => {
    const reason = grassGpuRingComputeUnsupportedReason(deviceWithStorageBufferLimit(6));

    expect(reason).toContain(`${GRASS_GPU_RING_STORAGE_BINDINGS} storage buffers`);
    expect(reason).toContain("device limit is 6");
  });

  it("allows devices that can bind the full compute layout", () => {
    expect(grassGpuRingComputeUnsupportedReason(
      deviceWithStorageBufferLimit(GRASS_GPU_RING_STORAGE_BINDINGS),
    )).toBeNull();
    expect(grassGpuRingComputeUnsupportedReason(deviceWithStorageBufferLimit(8))).toBeNull();
  });

  it("keeps the WGSL storage-buffer declarations within the advertised safe limit", () => {
    const storageBindings = composeGrassRingShader().match(/var<storage/g) ?? [];

    expect(storageBindings).toHaveLength(GRASS_GPU_RING_STORAGE_BINDINGS);
  });

  it("dispatches one cull kernel over the slot grid", () => {
    expect(shaderSource).toContain("fn grass_cull(");
    expect(shaderSource).not.toContain("fn grass_cull_fine(");
    expect(shaderSource).not.toContain("fn grass_cull_far(");
  });

  it("uses packed config density and width values instead of shader literals", () => {
    expect(shaderSource).toContain("params.density_a");
    expect(shaderSource).toContain("params.density_b");
    expect(shaderSource).toContain("params.settings_b.w");
    expect(shaderSource).not.toContain("0.02, 1.0");
    expect(shaderSource).not.toContain("4.8");
  });

  it("packs YAML LOD and width inputs so GPU density mirrors the CPU helper", () => {
    const settings = {
      ...DEFAULT_GRASS_SETTINGS,
      distance: 180,
      lod: {
        ...DEFAULT_GRASS_SETTINGS.lod,
        nearFraction: 0.25,
        midFraction: 0.6,
        midInstanceFraction: 0.27,
        farDensityRatio: 0.08,
        farInstanceFraction: 0,
      },
      ring: {
        ...DEFAULT_GRASS_SETTINGS.ring,
        farMeters: 220,
      },
      blade: {
        ...DEFAULT_GRASS_SETTINGS.blade,
        maxWidthCompensation: 2.6,
      },
    };
    const scratch = packGrassGpuRingParams({
      centerX: 12,
      centerZ: 24,
      worldCells: 256,
      bands: { near: 36, mid: 88, far: 144, radius: 180 },
      density: grassGpuRingDensityParams(settings),
      bladeHeight: settings.bladeHeight,
      bladeHeightVariation: settings.bladeHeightVariation,
      slopeMinY: settings.slopeMinY,
      minHeight: settings.minHeight,
      maxHeight: settings.maxHeight,
      maxInstancesPerTier: 1234,
      seed: settings.seed,
      jitter: 0.34,
      frustumPlanes: [1, 2, 3, 4],
    }, { near: 11, mid: 13, far: 17, super: 19 }, settings.ring);
    const f32 = new Float32Array(scratch);
    const u32 = new Uint32Array(scratch);
    expect(f32[15]).toBeCloseTo(2.6);
    expect(f32[24]).toBeCloseTo(45);
    expect(f32[25]).toBeCloseTo(108);
    expect(f32[26]).toBeCloseTo(220);
    expect(f32[27]).toBeCloseTo(0.27);
    expect(f32[28]).toBeCloseTo(0.08);
    expect(f32[29]).toBeCloseTo(0);
    expect(f32[32]).toBe(1);
    expect(u32[20]).toBe(1234);

    const densityFromPacked = (distance: number) => {
      const farDensity = f32[28];
      const d = Math.max(0, distance);
      const base = Math.min(1, Math.pow(58 / (d + 42), 1.15));
      const far = Math.pow(Math.min(1, 120 / Math.max(d, 120)), 1.6);
      const raw = base * far;
      return Math.min(1, Math.max(farDensity, raw));
    };

    for (const distance of [1, 60, 120, 180, 220]) {
      expect(densityFromPacked(distance)).toBeCloseTo(computeGrassDensityScale(distance, settings), 6);
    }
  });

  it("keeps tier compact regions aligned with indirect firstInstance", () => {
    const maxPerTier = 1024;

    for (let tier = 0; tier < 4; tier++) {
      const region = grassGpuRingTierRegion(tier, maxPerTier);
      expect(region.start).toBe(tier * maxPerTier);
      expect(region.end).toBe((tier + 1) * maxPerTier);
      expect(region.firstInstance).toBe(region.start);
      expect(grassGpuRingOutputIndex(tier, 17, maxPerTier)).toBe(region.firstInstance + 17);
    }
  });
});
