import { describe, expect, it } from "vitest";
import { requestSharedWebGpuDevice } from "../../../rendering/shared_webgpu_device.js";
import { DEFAULT_TERRAIN_EROSION_CONFIG } from "../config.js";
import { getErosionDiagnostics } from "../diagnostics.js";
import { sampleErosionSourceField } from "../state.js";
import type { ErosionGpuCheckpoint, TerrainErosionConfig } from "../types.js";
import { packErosionGpuInitialState } from "./buffers.js";
import { buildErosionGpu } from "./dispatch.js";
import { assertErosionParity } from "./parity.js";
import { assertErosionGpuParity } from "./parity_gate.js";

const webGpuAvailable = typeof navigator !== "undefined" && !!navigator.gpu;
const gpuIt = webGpuAvailable ? it : it.skip;
const SOURCE_HASH = "81".repeat(32);
const CONFIG_HASH = "92".repeat(32);

function resumeConfig(): TerrainErosionConfig {
  return {
    erosion: {
      ...DEFAULT_TERRAIN_EROSION_CONFIG.erosion,
      cellSizeM: 4,
      hydraulicIterations: 40,
      thermalIterations: 10,
      checkpointEveryIterations: 4,
      rain: { ...DEFAULT_TERRAIN_EROSION_CONFIG.erosion.rain, amountPerIterationM: 0.01 },
    },
  };
}

function initialState(config: TerrainErosionConfig) {
  const source = sampleErosionSourceField({
    sizeM: { x: 32, z: 32 },
    originM: { x: 0, z: 0 },
    config,
    sampleHeightMeters: (x, z) => 34 + Math.sin(x * 0.15) * 2 + Math.cos(z * 0.11) * 3 + x * 0.03,
    seed: 37,
    seaLevelM: 18,
  });
  return packErosionGpuInitialState(source, config.erosion.borderCells);
}

describe("erosion GPU parity", () => {
  gpuIt("is bit-identical to the CPU oracle on golden and random seeded grids", async () => {
    const shared = await requestSharedWebGpuDevice();
    await assertErosionGpuParity(shared.device);
    expect(getErosionDiagnostics().erosion_cpu_gpu_mismatch_count).toBe(0);
  });

  gpuIt("resumes bit-identically from a compact state-A checkpoint", async () => {
    const shared = await requestSharedWebGpuDevice();
    const config = resumeConfig();
    const common = {
      worldId: "gpu-resume",
      seed: 37,
      sourceTerrainHash: SOURCE_HASH,
      configHash: CONFIG_HASH,
      config,
    };
    const uninterrupted = await buildErosionGpu(shared.device, {
      ...common,
      initial: initialState(config),
    });

    let checkpoint: ErosionGpuCheckpoint | undefined;
    await expect(buildErosionGpu(shared.device, {
      ...common,
      initial: initialState(config),
    }, {
      onCheckpoint(value) {
        checkpoint = value;
        throw new Error("stop-after-gpu-checkpoint");
      },
    })).rejects.toThrow("stop-after-gpu-checkpoint");
    expect(checkpoint).toBeDefined();

    const resumed = await buildErosionGpu(shared.device, {
      ...common,
      initial: initialState(config),
      checkpoint: checkpoint!,
    });
    assertErosionParity(uninterrupted.field, resumed.field);
    expect(resumed.ref.hash).toBe(uninterrupted.ref.hash);
  });
});
