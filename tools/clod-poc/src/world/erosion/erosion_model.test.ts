import { describe, expect, it } from "vitest";
import { buildErosionCpu } from "./cpu_builder.js";
import { DEFAULT_TERRAIN_EROSION_CONFIG } from "./config.js";
import { erodeOrDeposit } from "./erode_deposit.js";
import { computeErosionSourceTerrainHash } from "./integration.js";
import { createErosionState, resolveErosionConstants } from "./state.js";
import { relaxThermalTalus } from "./thermal_relaxation.js";
import type { ErosionSourceField, TerrainErosionConfig } from "./types.js";

const SOURCE_HASH = "31".repeat(32);
const CONFIG_HASH = "42".repeat(32);

function config(iterations = 64): TerrainErosionConfig {
  return {
    erosion: {
      ...DEFAULT_TERRAIN_EROSION_CONFIG.erosion,
      cellSizeM: 16,
      hydraulicIterations: iterations,
      thermalIterations: Math.floor(iterations / 4),
      checkpointEveryIterations: 8,
    },
  };
}

async function build(sampleHeightMeters: (x: number, z: number) => number, iterations = 64) {
  const value = config(iterations);
  return buildErosionCpu({
    worldId: "model",
    seed: 23,
    sizeM: { x: 256, z: 256 },
    originM: { x: 0, z: 0 },
    sourceTerrainHash: SOURCE_HASH,
    configHash: CONFIG_HASH,
    config: value,
    sampleHeightMeters,
  }, { seaLevelM: 0 });
}

function source(width: number, height: number, fillHeight: number): ErosionSourceField {
  return {
    width,
    height,
    cellSizeM: 16,
    originX: 0,
    originZ: 0,
    heightFixed: new Int32Array(width * height).fill(fillHeight),
    hardness: new Uint16Array(width * height).fill(32768),
  };
}

describe("erosion numerical model", () => {
  it("deposits transported sediment at a bowl floor", async () => {
    const artifact = await build((x, z) => 5 + ((x - 128) ** 2 + (z - 128) ** 2) * 0.006, 192);
    const center = 8 * artifact.field.width + 8;
    expect(artifact.field.deposition[center]).toBeGreaterThan(0);
    expect(artifact.field.heightFixed[center]).toBeGreaterThanOrEqual(5 * 256);
    expect(artifact.massErrorRatio).toBe(0);
  });

  it("forms distributed diagonal flow without one-axis locking", async () => {
    const artifact = await build((x, z) => 120 - x * 0.35 - z * 0.22, 96);
    const affectedRows = new Set<number>();
    const affectedColumns = new Set<number>();
    for (let z = 0; z < artifact.field.height; z++) {
      for (let x = 0; x < artifact.field.width; x++) {
        if (artifact.field.deposition[z * artifact.field.width + x] === 0) continue;
        affectedRows.add(z);
        affectedColumns.add(x);
      }
    }
    expect(affectedRows.size).toBeGreaterThan(4);
    expect(affectedColumns.size).toBeGreaterThan(4);
    expect(artifact.massErrorRatio).toBe(0);
  });

  it("limits erosion by hardness", () => {
    const value = config(1);
    const state = createErosionState(source(3, 3, 20 * 256), 2);
    const constants = resolveErosionConstants(value);
    const soft = 3 * state.width + 3;
    const hard = soft + 1;
    state.hardness[soft] = 6553;
    state.hardness[hard] = 58982;
    state.capacity[soft] = 20_000;
    state.capacity[hard] = 20_000;
    erodeOrDeposit(state, constants);
    expect(state.deposition[soft]).toBeLessThan(state.deposition[hard]);
  });

  it("moves thermal material only above the hardness-derived talus", () => {
    const value = config(1);
    const constants = resolveErosionConstants(value);
    const below = createErosionState(source(3, 3, 20 * 256), 2);
    const center = 3 * below.width + 3;
    below.hardness[center] = 0;
    const limit = constants.talusHeightUnitsByHardnessByte[0]!;
    below.heightFixed[center] = below.heightFixed[center]! + limit;
    const unchanged = below.heightFixed[center]!;
    relaxThermalTalus(below, constants);
    expect(below.heightFixed[center]).toBe(unchanged);

    const above = createErosionState(source(3, 3, 20 * 256), 2);
    above.hardness[center] = 0;
    above.heightFixed[center] = above.heightFixed[center]! + limit + 512;
    const raised = above.heightFixed[center]!;
    relaxThermalTalus(above, constants);
    expect(above.heightFixed[center]).toBeLessThan(raised);
    expect(above.deposition[center]).toBeLessThan(0);
    expect(Array.from(above.deposition).some((value) => value > 0)).toBe(true);
  });

  it("keeps terrain plus suspended sediment mass exact on a draining slope", async () => {
    const artifact = await build((x, z) => 90 - x * 0.45 + Math.sin(z * 0.08), 192);
    expect(artifact.massErrorRatio).toBe(0);
    expect(Array.from(artifact.field.sediment).every((value) => value >= 0 && value <= 0xffffffff)).toBe(true);
  });

  it("excludes live voxel overlay data from the erosion source hash", async () => {
    const base = {
      generatorVersion: "generator-v1",
      worldId: "world",
      seed: 1,
      sizeM: { x: 32, z: 32 },
      originM: { x: 0, z: 0 },
      terrainFieldConfig: { seed: 1 },
    };
    const first = await computeErosionSourceTerrainHash(base);
    const second = await computeErosionSourceTerrainHash({ ...base, voxelDeltas: [1, 2, 3] } as typeof base);
    expect(second).toBe(first);
  });
});
