import { describe, expect, it } from "vitest";
import { buildErosionCpu } from "./cpu_builder.js";
import { DEFAULT_TERRAIN_EROSION_CONFIG } from "./config.js";
import type { ErosionCpuCheckpoint, TerrainErosionConfig } from "./types.js";

const HASH_A = "aa".repeat(32);
const HASH_B = "bb".repeat(32);

function testConfig(): TerrainErosionConfig {
  return {
    erosion: {
      ...DEFAULT_TERRAIN_EROSION_CONFIG.erosion,
      cellSizeM: 4,
      borderCells: 2,
      hydraulicIterations: 8,
      thermalIterations: 2,
      checkpointEveryIterations: 2,
      rain: { ...DEFAULT_TERRAIN_EROSION_CONFIG.erosion.rain, amountPerIterationM: 0.01 },
    },
  };
}

function input(config: TerrainErosionConfig, checkpoint?: ErosionCpuCheckpoint) {
  return {
    worldId: "test",
    seed: 17,
    sizeM: { x: 32, z: 32 },
    originM: { x: 0, z: 0 },
    sourceTerrainHash: HASH_A,
    configHash: HASH_B,
    config,
    sampleHeightMeters: (x: number, z: number) => 20 + x * 0.04 + Math.sin(z * 0.2) * 0.5,
    ...(checkpoint ? { checkpoint } : {}),
  };
}

describe("deterministic CPU erosion", () => {
  it("produces stable hashes across repeated runs", async () => {
    const config = testConfig();
    const first = await buildErosionCpu(input(config), { seaLevelM: 18 });
    const second = await buildErosionCpu(input(config), { seaLevelM: 18 });
    expect(second.ref.hash).toBe(first.ref.hash);
    expect(second.massErrorRatio).toBe(first.massErrorRatio);
  });

  it("resumes bit-identically from a checkpoint", async () => {
    const config = testConfig();
    const uninterrupted = await buildErosionCpu(input(config), { seaLevelM: 18 });
    let checkpoint: ErosionCpuCheckpoint | undefined;
    await expect(buildErosionCpu(input(config), {
      seaLevelM: 18,
      onCheckpoint(value) {
        checkpoint = value;
        throw new Error("stop-after-checkpoint");
      },
    })).rejects.toThrow("stop-after-checkpoint");
    expect(checkpoint).toBeDefined();
    const resumed = await buildErosionCpu(input(config, checkpoint), { seaLevelM: 18 });
    expect(resumed.ref.hash).toBe(uninterrupted.ref.hash);
  });

  it("keeps a flat plane planar", async () => {
    const config = testConfig();
    const artifact = await buildErosionCpu({
      ...input(config),
      sampleHeightMeters: () => 30,
    }, { seaLevelM: 18 });
    expect(new Set(artifact.field.heightFixed).size).toBe(1);
    expect(artifact.massErrorRatio).toBeLessThanOrEqual(1e-12);
  });
});
