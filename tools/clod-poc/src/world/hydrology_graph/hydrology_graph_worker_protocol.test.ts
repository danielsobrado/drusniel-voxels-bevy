import { describe, expect, it } from "vitest";
import type { ErosionArtifactRef, SerializedErodedMacroField } from "../erosion/types.js";
import {
  buildHydrologyGraphFromMacro,
  createHydrologyMacroSampleCheckpoint,
  sampleHydrologyMacroRows,
} from "./hydrology_graph_builder.js";
import { buildHydrologyGraphWorkerRequest } from "./hydrology_graph_worker_build.js";

function erosionField(): { field: SerializedErodedMacroField; ref: ErosionArtifactRef } {
  const width = 17;
  const height = 17;
  const count = width * height;
  const heightFixed = new Int32Array(count);
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) heightFixed[z * width + x] = (x + z) * 1024;
  return {
    field: {
      width,
      height,
      cellSizeM: 4,
      originX: 0,
      originZ: 0,
      heightFixed,
      hardness: new Uint16Array(count).fill(32768),
      sediment: new Uint32Array(count),
      deposition: new Int32Array(count),
    },
    ref: {
      schemaVersion: 1,
      id: "erosion:worker",
      hash: "ab".repeat(32),
      width,
      height,
      cellSizeM: 4,
      originX: 0,
      originZ: 0,
      sourceTerrainHash: "cd".repeat(32),
      configHash: "ef".repeat(32),
    },
  };
}

describe("hydrology graph worker protocol", () => {
  it("retains the resumable row-band sampler for CPU diagnostics", () => {
    const input = {
      worldId: "checkpoint",
      seed: 4,
      sizeM: { x: 8, z: 8 },
      config: { spacingM: 1, channelThresholdCells: 2 },
    };
    const checkpoint = createHydrologyMacroSampleCheckpoint(input);
    let samples = 0;
    const sampler = (x: number, z: number) => {
      samples++;
      return x + z;
    };
    expect(sampleHydrologyMacroRows(checkpoint, sampler, 3)).toBe(false);
    expect(checkpoint.nextRow).toBe(3);
    expect(samples).toBe(3 * checkpoint.resX);
    expect(sampleHydrologyMacroRows(checkpoint, sampler, 100)).toBe(true);
    expect(samples).toBe(checkpoint.resX * checkpoint.resZ);
    expect(buildHydrologyGraphFromMacro(input, checkpoint).macro.buildFields!.originalHeight[8 * 9 + 8]).toBe(16);
  });

  it("builds from the persisted erosion authority and reports monotone progress", async () => {
    const progress: number[] = [];
    const erosion = erosionField();
    const artifact = await buildHydrologyGraphWorkerRequest({
      type: "buildHydrologyGraph",
      requestId: 7,
      worldId: "worker-round-trip",
      seed: 5,
      sizeM: { x: 64, z: 64 },
      terrainFieldConfig: { seed: 5 },
      config: { spacingM: 4, channelThresholdCells: 4 },
      erodedMacroField: erosion.field,
      erosionArtifactRef: erosion.ref,
    }, (value) => progress.push(value.buildPct));

    expect(artifact.ref.id).toMatch(/^hydrology-graph:/);
    expect(artifact.ref.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.graph.macro.erosion?.artifactRef.hash).toBe(erosion.ref.hash);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });
});
