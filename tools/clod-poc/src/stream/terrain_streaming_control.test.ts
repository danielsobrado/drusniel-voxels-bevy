import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetTerrainStreamingControlForTests,
  runTerrainStreamingWork,
  terrainStreamingGeneration,
  terrainStreamingIsEnabled,
} from "./terrain_streaming_control.js";

beforeEach(() => resetTerrainStreamingControlForTests());

describe("runTerrainStreamingWork", () => {
  it("freezes all streaming producers and resumes without duplicate work", () => {
    const producers = ["bubble", "roots", "tiles", "far-summary", "shell", "clipmap"]
      .map(() => vi.fn());

    for (const producer of producers) runTerrainStreamingWork(false, producer);
    expect(producers.every((producer) => producer.mock.calls.length === 0)).toBe(true);

    for (const producer of producers) runTerrainStreamingWork(true, producer);
    expect(producers.every((producer) => producer.mock.calls.length === 1)).toBe(true);
  });

  it("increments the generation only when the master state changes", () => {
    expect(terrainStreamingIsEnabled()).toBe(true);
    expect(terrainStreamingGeneration()).toBe(0);

    runTerrainStreamingWork(false, () => undefined);
    expect(terrainStreamingIsEnabled()).toBe(false);
    expect(terrainStreamingGeneration()).toBe(1);

    runTerrainStreamingWork(false, () => undefined);
    expect(terrainStreamingGeneration()).toBe(1);

    runTerrainStreamingWork(true, () => undefined);
    expect(terrainStreamingIsEnabled()).toBe(true);
    expect(terrainStreamingGeneration()).toBe(2);
  });
});
