import { DEFAULT_TERRAIN_EROSION_CONFIG, computeTerrainErosionConfigHash } from "../config.js";
import { buildErosionCpu } from "../cpu_builder.js";
import { recordCpuGpuMismatch } from "../diagnostics.js";
import { computeErosionSourceTerrainHash } from "../integration.js";
import { sampleErosionSourceField } from "../state.js";
import type { TerrainErosionConfig } from "../types.js";
import { packErosionGpuInitialState } from "./buffers.js";
import { buildErosionGpu } from "./dispatch.js";
import { compareErosionFields } from "./parity.js";

const gates = new WeakMap<GPUDevice, Promise<void>>();

interface ParityScene {
  readonly name: string;
  readonly seed: number;
  readonly sampleHeightMeters: (x: number, z: number) => number;
}

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

function randomSurface(seed: number): (x: number, z: number) => number {
  return (x, z) => {
    const a = Math.sin((x + seed * 3.1) * 0.17) * 3.5;
    const b = Math.cos((z - seed * 1.7) * 0.13) * 2.75;
    const c = Math.sin((x + z + seed) * 0.07) * 1.5;
    return 42 + a + b + c + x * 0.035 - z * 0.02;
  };
}

const SCENES: readonly ParityScene[] = [
  { name: "flat", seed: 11, sampleHeightMeters: () => 40 },
  { name: "bowl", seed: 13, sampleHeightMeters: (x, z) => 25 + ((x - 16) ** 2 + (z - 16) ** 2) * 0.012 },
  { name: "slope", seed: 17, sampleHeightMeters: (x, z) => 55 - x * 0.18 - z * 0.11 },
  { name: "random-1", seed: 23, sampleHeightMeters: randomSurface(23) },
  { name: "random-2", seed: 29, sampleHeightMeters: randomSurface(29) },
  { name: "random-3", seed: 31, sampleHeightMeters: randomSurface(31) },
];

async function runGate(device: GPUDevice): Promise<void> {
  const config = parityConfig();
  const configHash = await computeTerrainErosionConfigHash(config);
  let mismatchCount = 0;
  for (const scene of SCENES) {
    const sourceTerrainHash = await computeErosionSourceTerrainHash({
      generatorVersion: `erosion-gpu-parity-v2:${scene.name}`,
      worldId: `erosion-parity:${scene.name}`,
      seed: scene.seed,
      sizeM: { x: 32, z: 32 },
      originM: { x: 0, z: 0 },
      terrainFieldConfig: { seed: scene.seed },
    });
    const source = sampleErosionSourceField({
      sizeM: { x: 32, z: 32 },
      originM: { x: 0, z: 0 },
      config,
      sampleHeightMeters: scene.sampleHeightMeters,
      seed: scene.seed,
      seaLevelM: 18,
    });
    const cpu = await buildErosionCpu({
      worldId: `erosion-parity:${scene.name}`,
      seed: scene.seed,
      sizeM: { x: 32, z: 32 },
      originM: { x: 0, z: 0 },
      sourceTerrainHash,
      configHash,
      config,
      sampleHeightMeters: scene.sampleHeightMeters,
    }, { seaLevelM: 18 });
    const gpu = await buildErosionGpu(device, {
      worldId: `erosion-parity:${scene.name}`,
      seed: scene.seed,
      sourceTerrainHash,
      configHash,
      config,
      initial: packErosionGpuInitialState(source, config.erosion.borderCells),
    });
    mismatchCount += compareErosionFields(cpu.field, gpu.field).mismatchCount;
  }
  recordCpuGpuMismatch(mismatchCount);
  if (mismatchCount !== 0) throw new Error(`erosion GPU parity gate failed with ${mismatchCount} mismatched values`);
}

export function assertErosionGpuParity(device: GPUDevice): Promise<void> {
  let gate = gates.get(device);
  if (!gate) {
    gate = runGate(device).catch((error) => {
      gates.delete(device);
      throw error;
    });
    gates.set(device, gate);
  }
  return gate;
}
