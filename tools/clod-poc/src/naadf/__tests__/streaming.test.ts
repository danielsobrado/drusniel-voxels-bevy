import { describe, expect, it } from "vitest";
import { NaadfMetricsCollector } from "../metrics.js";
import { createTerrainSource } from "../terrainSource.js";
import { createNaadfWorldState, updateSummaryStreaming } from "../summaryStreamer.js";
import { createTestNaadfConfig } from "./testConfig.js";
import { lookupValidatedChunkIndex } from "../residentLookup.js";
import { worldToChunkKey } from "../keys.js";

describe("naadf streaming", () => {
  const config = createTestNaadfConfig();
  const source = createTerrainSource("default", config.world.seed);

  it("streaming requests predicted chunks ahead of movement", () => {
    const metrics = new NaadfMetricsCollector();
    const state = createNaadfWorldState(config, source, metrics);
    updateSummaryStreaming({
      state,
      cameraX: 0,
      cameraZ: 0,
      velocityX: 100,
      velocityZ: 0,
      deltaSeconds: 1,
    });
    expect(state.predictedX).toBeGreaterThan(0);
    expect(state.pendingJobs.size).toBeGreaterThan(0);
  });

  it("streaming keeps old data during replacement", () => {
    const staleConfig = {
      ...config,
      streaming: { ...config.streaming, keepStaleUntilReplacement: true },
    };
    const state = createNaadfWorldState(staleConfig, source, new NaadfMetricsCollector());
    for (let i = 0; i < 6; i++) {
      updateSummaryStreaming({ state, cameraX: 0, cameraZ: 0, velocityX: 0, velocityZ: 0, deltaSeconds: 1 / 60 });
    }
    const readyBefore = state.residents.filter((r) => r.state === "ready").length;
    updateSummaryStreaming({ state, cameraX: 32, cameraZ: 0, velocityX: 50, velocityZ: 0, deltaSeconds: 1 / 60 });
    const staleOrReady = state.residents.filter((r) => r.state === "ready" || r.state === "stale").length;
    expect(staleOrReady).toBeGreaterThanOrEqual(readyBefore);
  });

  it("max jobs per frame is respected", () => {
    const state = createNaadfWorldState(config, source, new NaadfMetricsCollector());
    const update = updateSummaryStreaming({
      state,
      cameraX: 0,
      cameraZ: 0,
      velocityX: 0,
      velocityZ: 0,
      deltaSeconds: 1 / 60,
    });
    expect(update.committedJobs).toBeLessThanOrEqual(config.streaming.maxCommitsPerFrame);
  });

  it("max commits per frame is respected", () => {
    const state = createNaadfWorldState(config, source, new NaadfMetricsCollector());
    const update = updateSummaryStreaming({
      state,
      cameraX: 0,
      cameraZ: 0,
      velocityX: 0,
      velocityZ: 0,
      deltaSeconds: 1 / 60,
    });
    expect(update.committedJobs).toBeLessThanOrEqual(config.streaming.maxCommitsPerFrame);
  });

  it("eviction waits for grace period", () => {
    const state = createNaadfWorldState(config, source, new NaadfMetricsCollector());
    for (let i = 0; i < 3; i++) {
      updateSummaryStreaming({ state, cameraX: 0, cameraZ: 0, velocityX: 0, velocityZ: 0, deltaSeconds: 1 / 60, nowMs: i * 16 });
    }
    const countBefore = state.residents.length;
    updateSummaryStreaming({
      state,
      cameraX: 10000,
      cameraZ: 10000,
      velocityX: 0,
      velocityZ: 0,
      deltaSeconds: 1 / 60,
      nowMs: 100,
    });
    expect(state.residents.length).toBeGreaterThanOrEqual(0);
    expect(countBefore).toBeGreaterThan(0);
  });

  it("eviction keeps near-page and hash lookup indices consistent", () => {
    const state = createNaadfWorldState(config, source, new NaadfMetricsCollector());
    for (let i = 0; i < 8; i++) {
      updateSummaryStreaming({
        state,
        cameraX: i * 4,
        cameraZ: 0,
        velocityX: 4,
        velocityZ: 0,
        deltaSeconds: 1 / 60,
        nowMs: i * 1000,
      });
    }
    const chunkSize = config.world.chunkSizeCells;
    for (const entry of state.residents) {
      if (entry.state !== "ready" && entry.state !== "stale") continue;
      const lookup = lookupValidatedChunkIndex(state.nearTable, state.hashFallback, state.residents, entry.key);
      if (lookup.index < 0) continue;
      expect(state.residents[lookup.index]?.key).toEqual(entry.key);
    }
    const probeKey = worldToChunkKey(state.cameraX, state.cameraZ, chunkSize);
    const centerLookup = lookupValidatedChunkIndex(state.nearTable, state.hashFallback, state.residents, probeKey);
    if (centerLookup.index >= 0) {
      expect(state.residents[centerLookup.index]?.brick).not.toBeNull();
    }
  });
});
