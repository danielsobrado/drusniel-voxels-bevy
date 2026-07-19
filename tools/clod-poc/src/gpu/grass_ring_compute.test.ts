import { describe, expect, it } from "vitest";
import { cloneGrassSettings, DEFAULT_GRASS_SETTINGS } from "../grass/grass_config.js";
import { grassGpuRingStableKey } from "../grass/grass_gpu_ring.js";
import { applyGrassMaterialBiasFromYaml } from "../grass/grass_material_bias.js";
import { computeGrassDensityScale } from "../grass/grass_math.js";
import {
  GRASS_GPU_RING_STORAGE_BINDINGS,
  grassGpuRingDensityParams,
  grassGpuRingOutputBindGroupEntries,
  grassGpuRingOutputIndex,
  grassGpuRingTierRegion,
  grassGpuRingComputeUnsupportedReason,
  packGrassGpuRingParams,
  type GrassGpuTierOutputBuffers,
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

  it("composes one canonical forest-light sample into each accepted blade", () => {
    const composed = composeGrassRingShader();

    expect(composed).toContain("sun_visibility: vec4<f32>");
    expect(composed).toContain("@group(0) @binding(16) var forest_lighting_texture");
    expect(composed).toContain("fn grass_sun_visibility");
    expect(composed).toContain("textureLoad(forest_lighting_texture, coord, 0).g");
    expect(composed).toContain("grass_sun_visibility(wpos)");
  });

  it("binds shared grass ring instance attributes without writable buffer aliasing", () => {
    const offset = { label: "offset" } as unknown as GPUBuffer;
    const packed0 = { label: "packed0" } as unknown as GPUBuffer;
    const packed1 = { label: "packed1" } as unknown as GPUBuffer;
    const terrainNormal = { label: "terrainNormal" } as unknown as GPUBuffer;
    const shared: GrassGpuTierOutputBuffers = { offset, packed0, packed1, terrainNormal };

    const entries = grassGpuRingOutputBindGroupEntries({
      near: shared,
      mid: shared,
      far: shared,
      super: shared,
      indirectArgs: { label: "indirectArgs" } as unknown as GPUBuffer,
    });

    expect(entries.map((entry) => entry.binding)).toEqual([3, 4, 5, 6]);
    expect(entries.map((entry) => (entry.resource as GPUBufferBinding).buffer)).toEqual([
      offset,
      packed0,
      packed1,
      terrainNormal,
    ]);
  });

  it("dispatches the grass cull kernel over a compact active slot list", () => {
    const composed = composeGrassRingShader();

    expect(composed).toContain("active_slots");
    expect(composed).toContain("let slot = active_slots[id.x]");
    expect(composed).toContain("process_slot(slot)");
    expect(composed).not.toContain("process_slot(id.x);");
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
    expect(shaderSource).toContain("params.material_density");
    expect(shaderSource).not.toContain("0.02, 1.0");
    expect(shaderSource).not.toContain("4.8");
  });

  it("includes material bias in the stable GPU ring key", () => {
    const base = cloneGrassSettings(DEFAULT_GRASS_SETTINGS);
    const changed = applyGrassMaterialBiasFromYaml(cloneGrassSettings(DEFAULT_GRASS_SETTINGS), `
grass:
  terrain:
    rock:
      density: 0.99
`);

    expect(grassGpuRingStableKey(changed, 256)).not.toBe(grassGpuRingStableKey(base, 256));
  });

  it("packs YAML LOD, width, material, and forest-light inputs", () => {
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
      materialDensity: [1.12, 0.18, 0.58, 0.02],
      heightDensity: [14, 34, 8, 1.04, 1, 0.58],
      frustumPlanes: [1, 2, 3, 4],
      sunVisibility: [4096, 128, 1, 0],
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
    expect(f32[32]).toBeCloseTo(1.12);
    expect(f32[33]).toBeCloseTo(0.18);
    expect(f32[36]).toBeCloseTo(14);
    expect(f32[39]).toBeCloseTo(1.04);
    expect(f32[44]).toBe(1);
    expect(f32[72]).toBe(4096);
    expect(f32[73]).toBe(128);
    expect(f32[74]).toBe(1);
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

  it("fails open when no forest-light texture metadata is supplied", () => {
    const scratch = packGrassGpuRingParams({
      centerX: 0,
      centerZ: 0,
      worldCells: 256,
      bands: { near: 10, mid: 20, far: 30, radius: 40 },
      density: grassGpuRingDensityParams(DEFAULT_GRASS_SETTINGS),
      bladeHeight: DEFAULT_GRASS_SETTINGS.bladeHeight,
      bladeHeightVariation: DEFAULT_GRASS_SETTINGS.bladeHeightVariation,
      slopeMinY: DEFAULT_GRASS_SETTINGS.slopeMinY,
      minHeight: DEFAULT_GRASS_SETTINGS.minHeight,
      maxHeight: DEFAULT_GRASS_SETTINGS.maxHeight,
      maxInstancesPerTier: 1,
      seed: 1,
      jitter: 0,
    }, { near: 1, mid: 1, far: 1, super: 1 });

    expect(new Float32Array(scratch)[74]).toBe(0);
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

  it("grass WGSL sets firstInstance per tier (instanceIndex includes firstInstance)", () => {
    expect(shaderSource).toContain("indirect_args[base + 4u] = tier * params.counts_b.x");
  });

  it("projects fallback river distance with a two-argument WGSL dot call", () => {
    expect(shaderSource).toContain("dot(p - a, ab)");
    expect(composeGrassRingShader()).not.toContain("dot(p - a) / denom");
  });
});
