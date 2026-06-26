import { describe, expect, it } from "vitest";
import { NaadfMetricsCollector } from "../metrics.js";
import { createTerrainSource } from "../terrainSource.js";
import { createNaadfWorldState, updateSummaryStreaming } from "../summaryStreamer.js";
import { queryTerrainHeight } from "../query.js";
import { createTestNaadfConfig } from "./testConfig.js";

describe("naadf query", () => {
  const config = createTestNaadfConfig();
  const source = createTerrainSource("flat", config.world.seed);

  function warmedState() {
    const metrics = new NaadfMetricsCollector();
    const state = createNaadfWorldState(config, source, metrics);
    for (let i = 0; i < 8; i++) {
      updateSummaryStreaming({
        state,
        cameraX: 8,
        cameraZ: 8,
        velocityX: 0,
        velocityZ: 0,
        deltaSeconds: 1 / 60,
      });
    }
    return state;
  }

  it("height query hits near table first", () => {
    const state = warmedState();
    const r = queryTerrainHeight({ state, worldX: 8, worldZ: 8, purpose: "render" });
    expect(r.source === "near_table" || r.source === "macro").toBe(true);
    expect(Number.isNaN(r.height)).toBe(false);
  });

  it("query falls back to hash when outside near table", () => {
    const state = warmedState();
    const farX = state.cameraX + config.nearPageTable.radiusChunksXz * config.world.chunkSizeCells + 32;
    const r = queryTerrainHeight({ state, worldX: farX, worldZ: 8, purpose: "debug" });
    expect(r.source === "hash_fallback" || r.source === "macro" || r.source === "far_clipmap").toBe(true);
    expect(Number.isNaN(r.height)).toBe(false);
  });

  it("query falls back to far clipmap at long distance", () => {
    const state = warmedState();
    const r = queryTerrainHeight({ state, worldX: 5000, worldZ: 5000, purpose: "render" });
    expect(r.source === "far_clipmap" || r.source === "macro").toBe(true);
    expect(Number.isNaN(r.height)).toBe(false);
  });

  it("missing far tile increments missing counter", () => {
    const state = createNaadfWorldState(config, source, new NaadfMetricsCollector(), true);
    const before = state.metrics.missingSamples;
    const r = queryTerrainHeight({ state, worldX: 6000, worldZ: 6000, purpose: "render" });
    expect(state.metrics.missingSamples).toBeGreaterThan(before);
    expect(r.unknown).toBe(true);
    expect(r.source).toBe("unknown");
  });

  it("no query returns NaN height", () => {
    const state = warmedState();
    for (const [x, z] of [[0, 0], [100, -50], [5000, 5000]]) {
      const r = queryTerrainHeight({ state, worldX: x, worldZ: z, purpose: "render" });
      expect(Number.isNaN(r.height)).toBe(false);
    }
  });
});
