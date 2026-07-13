import { describe, expect, it } from "vitest";
import {
  buildHydrologyGraphFromMacro,
  createHydrologyMacroSampleCheckpoint,
  sampleHydrologyMacroRows,
} from "./hydrology_graph_builder.js";
import { buildHydrologyGraphWorkerRequest } from "./hydrology_graph_worker_build.js";

describe("hydrology graph worker protocol", () => {
  it("resumes a row-band checkpoint without resampling completed rows", () => {
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

  it("builds through async bands and reports monotone progress", async () => {
    const progress: number[] = [];
    const artifact = await buildHydrologyGraphWorkerRequest({
      type: "buildHydrologyGraph",
      requestId: 7,
      worldId: "worker-round-trip",
      seed: 5,
      sizeM: { x: 64, z: 64 },
      terrainFieldConfig: { seed: 5 },
      config: { spacingM: 4, channelThresholdCells: 4 },
    }, (value) => progress.push(value.buildPct), async () => undefined, 3);

    expect(artifact.ref.id).toMatch(/^hydrology-graph:/);
    expect(artifact.ref.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });
});
