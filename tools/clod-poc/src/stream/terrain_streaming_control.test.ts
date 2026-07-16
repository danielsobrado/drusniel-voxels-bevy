import { describe, expect, it, vi } from "vitest";
import { runTerrainStreamingWork } from "./terrain_streaming_control.js";

describe("runTerrainStreamingWork", () => {
  it("freezes all streaming producers and resumes without duplicate work", () => {
    const producers = ["bubble", "roots", "tiles", "far-summary", "shell", "clipmap"]
      .map(() => vi.fn());

    for (const producer of producers) runTerrainStreamingWork(false, producer);
    expect(producers.every((producer) => producer.mock.calls.length === 0)).toBe(true);

    for (const producer of producers) runTerrainStreamingWork(true, producer);
    expect(producers.every((producer) => producer.mock.calls.length === 1)).toBe(true);
  });
});
