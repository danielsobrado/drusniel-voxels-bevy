import { describe, expect, it } from "vitest";
import { NaadfMetricsCollector } from "../metrics.js";
import { createTerrainSource } from "../terrainSource.js";
import { createNaadfWorldState, updateSummaryStreaming } from "../summaryStreamer.js";
import { HddaSpanStepper } from "../hdda.js";
import { tracePrimaryDebugRay, traceSunVisibility } from "../query.js";
import { createTestNaadfConfig } from "./testConfig.js";

function warmedState(mode: "dense" | "hdda" | "compare" = "compare") {
  const base = createTestNaadfConfig();
  const config = {
    ...base,
    traversal: {
      ...base.traversal,
      mode,
    },
  };
  const source = createTerrainSource("flat", config.world.seed);
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

describe("naadf hdda traversal", () => {
  it("aligns span cells and advances monotonically", () => {
    const stepper = HddaSpanStepper.init({
      originX: 2.5,
      originY: 9.25,
      originZ: -1.5,
      dirX: 1,
      dirY: 0,
      dirZ: 0,
      t0: 0,
      tMax: 64,
      spanDim: 4,
      cellSizeM: 1,
    });
    const stepped = stepper.stepSpan(0.001);

    expect(stepper.cellX).toBe(0);
    expect(stepper.spanDim).toBe(4);
    expect(stepped.cellX).toBe(4);
    expect(stepped.t).toBeGreaterThan(stepper.t);
  });

  it("keeps primary HDDA comparable to the dense oracle on flat terrain", () => {
    const state = warmedState();
    const result = tracePrimaryDebugRay({
      state,
      originX: 8,
      originY: 64,
      originZ: 8,
      dirX: 0,
      dirY: -1,
      dirZ: 0,
      maxDistanceM: 96,
    });

    expect(result.hit).toBe(true);
    expect(result.traversalMode).toBe("compare");
    expect(result.compare?.mismatchReason).toBe("none");
    expect(state.metrics.hddaRays).toBeGreaterThan(0);
    expect(state.metrics.hddaFallbackToDense).toBe(0);
  });

  it("keeps sun HDDA comparable to the dense oracle on clear upward rays", () => {
    const state = warmedState();
    const result = traceSunVisibility({
      state,
      worldX: 8,
      worldY: 64,
      worldZ: 8,
      sunDirX: 0,
      sunDirY: 1,
      sunDirZ: 0,
      maxDistanceM: 64,
    });

    expect(result.visible).toBe(true);
    expect(result.traversalMode).toBe("compare");
    expect(result.compare?.mismatchReason).toBe("none");
  });

  it("falls back to dense in compare mode when HDDA exceeds its budget", () => {
    const state = warmedState();
    state.config.traversal.hddaMaxVoxelSteps = 1;

    const result = tracePrimaryDebugRay({
      state,
      originX: 8,
      originY: 64,
      originZ: 8,
      dirX: 0,
      dirY: -1,
      dirZ: 0,
      maxDistanceM: 96,
    });

    expect(result.traversalMode).toBe("compare");
    expect(result.hit).toBe(true);
    expect(result.compare?.mismatchReason).not.toBe("none");
    expect(state.metrics.hddaDenseMismatches).toBe(1);
    expect(state.metrics.hddaFallbackToDense).toBe(1);
  });

  it("reports unknown instead of a false miss when HDDA mode exceeds its budget", () => {
    const state = warmedState("hdda");
    state.config.traversal.hddaMaxVoxelSteps = 1;

    const result = tracePrimaryDebugRay({
      state,
      originX: 8,
      originY: 64,
      originZ: 8,
      dirX: 0,
      dirY: -1,
      dirZ: 0,
      maxDistanceM: 96,
    });

    expect(result.hit).toBe(false);
    expect(result.unknown).toBe(true);
    expect(result.hdda?.voxelSteps).toBeGreaterThan(0);
  });

  it("respects the sun query step cap even when HDDA has a larger voxel budget", () => {
    const state = warmedState("hdda");
    state.config.query.maxStepsSun = 3;
    state.config.traversal.hddaMaxVoxelSteps = 4096;

    const result = traceSunVisibility({
      state,
      worldX: 8,
      worldY: 64,
      worldZ: 8,
      sunDirX: 0,
      sunDirY: 1,
      sunDirZ: 0,
      maxDistanceM: 4096,
    });

    expect(result.steps).toBeLessThanOrEqual(3);
    expect(result.unknown).toBe(true);
  });
});
