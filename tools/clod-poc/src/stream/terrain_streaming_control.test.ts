import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTerrainStreamingState,
  captureTerrainStreamingToken,
  registerTerrainStreamingWorker,
  resetTerrainStreamingControlForTests,
  runTerrainStreamingWork,
  terrainStreamingGeneration,
  terrainStreamingGenerationIsCurrent,
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

  it("invalidates completion tokens across disable and resume", () => {
    const token = captureTerrainStreamingToken();
    expect(token.isCurrent()).toBe(true);

    runTerrainStreamingWork(false, () => undefined);
    expect(token.isCurrent()).toBe(false);

    runTerrainStreamingWork(true, () => undefined);
    expect(token.isCurrent()).toBe(false);
    expect(captureTerrainStreamingToken().isCurrent()).toBe(true);
  });

  it("sends the current state before worker requests and streams later transitions", () => {
    const postMessage = vi.fn();
    const unregister = registerTerrainStreamingWorker({ postMessage });

    expect(postMessage).toHaveBeenLastCalledWith({
      type: "terrainStreamingState",
      enabled: true,
      generation: 0,
    });

    runTerrainStreamingWork(false, () => undefined);
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "terrainStreamingState",
      enabled: false,
      generation: 1,
    });

    unregister();
    runTerrainStreamingWork(true, () => undefined);
    expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it("rejects stale or contradictory remote states without reviving old tokens", () => {
    const token = captureTerrainStreamingToken();

    expect(applyTerrainStreamingState({ enabled: false, generation: 0 })).toBe(false);
    expect(terrainStreamingIsEnabled()).toBe(true);
    expect(token.isCurrent()).toBe(true);

    expect(applyTerrainStreamingState({ enabled: false, generation: 2 })).toBe(true);
    expect(terrainStreamingIsEnabled()).toBe(false);
    expect(terrainStreamingGeneration()).toBe(2);
    expect(token.isCurrent()).toBe(false);

    expect(applyTerrainStreamingState({ enabled: true, generation: 1 })).toBe(false);
    expect(applyTerrainStreamingState({ enabled: true, generation: 2 })).toBe(false);
    expect(terrainStreamingIsEnabled()).toBe(false);
  });

  it("accepts cache writes only for the enabled current generation", () => {
    expect(terrainStreamingGenerationIsCurrent(0)).toBe(true);
    runTerrainStreamingWork(false, () => undefined);
    expect(terrainStreamingGenerationIsCurrent(0)).toBe(false);
    expect(terrainStreamingGenerationIsCurrent(1)).toBe(false);
    runTerrainStreamingWork(true, () => undefined);
    expect(terrainStreamingGenerationIsCurrent(1)).toBe(false);
    expect(terrainStreamingGenerationIsCurrent(2)).toBe(true);
  });
});
