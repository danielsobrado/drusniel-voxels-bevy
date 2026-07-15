import { describe, expect, it } from "vitest";
import { requestSharedWebGpuDevice } from "../../../rendering/shared_webgpu_device.js";
import { buildErosionCpu } from "../cpu_builder.js";
import { DEFAULT_TERRAIN_EROSION_CONFIG, computeTerrainErosionConfigHash } from "../config.js";
import { computeErosionSourceTerrainHash } from "../integration.js";
import { sampleErosionSourceField } from "../state.js";
import type { TerrainErosionConfig } from "../types.js";
import { packErosionGpuInitialState } from "./buffers.js";
import { buildErosionGpu } from "./dispatch.js";
import { compareErosionFields } from "./parity.js";

function parityConfig(): TerrainErosionConfig {
  return {
    erosion: {
      ...DEFAULT_TERRAIN_EROSION_CONFIG.erosion,
      cellSizeM: 4,
      hydraulicIterations: 8,
      thermalIterations: 2,
      checkpointEveryIterations: 4,
      rain: { ...DEFAULT_TERRAIN_EROSION_CONFIG.erosion.rain, amountPerIterationM: 0.01 },
    },
  };
}

describe("erosion GPU parity", () => {
  it("is bit-identical to the CPU oracle when WebGPU is available", async () => {
    if (typeof navigator === "undefined" || !navigator.gpu) return;
    const config = parityConfig();
    const sourceTerrainHash = await computeErosionSourceTerrainHash({
      generatorVersion: "gpu-parity-v1",
      worldId: "gpu-parity",
      seed: 37,
      sizeM: { x: 32, z: 32 },
      originM: { x: 0, z: 0 },
      terrainFieldConfig: { seed: 37 },
    });
    const configHash = await computeTerrainErosionConfigHash(config);
    const sampleHeightMeters = (x: number, z: number): number => 30 + x * 0.12 + z * 0.08 + Math.sin((x + z) * 0.15);
    const source = sampleErosionSourceField({
      sizeM: { x: 32, z: 32 },
      originM: { x: 0, z: 0 },
      config,
      sampleHeightMeters,
      seed: 37,
      seaLevelM: 18,
    });
    const cpu = await buildErosionCpu({
      worldId: "gpu-parity",
      seed: 37,
      sizeM: { x: 32, z: 32 },
      originM: { x: 0, z: 0 },
      sourceTerrainHash,
      configHash,
      config,
      sampleHeightMeters,
    }, { seaLevelM: 18 });
    const shared = await requestSharedWebGpuDevice();
    const gpu = await buildErosionGpu(shared.device, {
      worldId: "gpu-parity",
      seed: 37,
      sourceTerrainHash,
      configHash,
      config,
      initial: packErosionGpuInitialState(source, config.erosion.borderCells),
    });
    const result = compareErosionFields(cpu.field, gpu.field);
    expect(result.mismatchCount).toBe(0);
  });
});
