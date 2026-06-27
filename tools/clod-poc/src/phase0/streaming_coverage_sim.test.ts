import { describe, it, expect } from "vitest";
import { simulateStreamingCoverage } from "./streaming_coverage_sim.js";

const WORLD_CELLS = 1024; // 16 * 4 * 16
const CHUNK_SIZE = 16;
const PAGE_SIZE = 64; // 4 * 16

function centerInput(overrides: Partial<Parameters<typeof simulateStreamingCoverage>[0]> = {}) {
  return {
    worldCells: WORLD_CELLS,
    chunkSize: CHUNK_SIZE,
    pageSizeCells: PAGE_SIZE,
    playerX: 512,
    playerZ: 512,
    velocityX: 0,
    velocityZ: 0,
    preloadSeconds: 0,
    liveRadiusM: 200,
    clodRadiusM: 200,
    ...overrides,
  };
}

describe("simulateStreamingCoverage", () => {
  it("center position, small radius => no missing chunks", () => {
    const report = simulateStreamingCoverage(centerInput());
    expect(report.missingChunkCount).toBe(0);
    expect(report.missingPageCount).toBe(0);
    expect(report.requiredChunkCount).toBeGreaterThan(0);
    expect(report.requiredPageCount).toBeGreaterThan(0);
  });

  it("near edge, predicted forward => missing chunks > 0 for finite coverage", () => {
    const report = simulateStreamingCoverage(centerInput({
      playerX: 900,
      playerZ: 512,
      velocityX: 50,
      velocityZ: 0,
      preloadSeconds: 5,
      liveRadiusM: 300,
    }));
    expect(report.missingChunkCount).toBeGreaterThan(0);
    expect(report.missingPageCount).toBeGreaterThan(0);
    expect(report.nearestMissingDistanceM).not.toBeNull();
  });

  it("near edge, predicted forward => no missing chunks for infinite streaming", () => {
    const report = simulateStreamingCoverage(centerInput({
      playerX: 900,
      playerZ: 512,
      velocityX: 50,
      velocityZ: 0,
      preloadSeconds: 5,
      liveRadiusM: 300,
      infiniteStreaming: true,
    }));
    expect(report.missingChunkCount).toBe(0);
    expect(report.missingPageCount).toBe(0);
    expect(report.nearestMissingDistanceM).toBeNull();
  });

  it("larger preload seconds keeps or increases required count", () => {
    const short = simulateStreamingCoverage(centerInput({ preloadSeconds: 2, liveRadiusM: 200 }));
    const long = simulateStreamingCoverage(centerInput({ preloadSeconds: 10, liveRadiusM: 200 }));
    expect(long.requiredChunkCount).toBeGreaterThanOrEqual(short.requiredChunkCount);
  });

  it("zero velocity uses current position", () => {
    const report = simulateStreamingCoverage(centerInput({
      playerX: 100,
      playerZ: 100,
      velocityX: 0,
      velocityZ: 0,
      preloadSeconds: 0,
      liveRadiusM: 100,
    }));
    expect(report.predictedCenterX).toBe(100);
    expect(report.predictedCenterZ).toBe(100);
  });

  it("predicted position is correctly computed", () => {
    const report = simulateStreamingCoverage(centerInput({
      playerX: 100,
      playerZ: 200,
      velocityX: 10,
      velocityZ: 20,
      preloadSeconds: 5,
    }));
    expect(report.predictedCenterX).toBe(150);
    expect(report.predictedCenterZ).toBe(300);
  });
});
