import { describe, expect, it } from "vitest";
import { discoverEditStormApis, summarizeFrameStalls, summarizeLatency } from "./rpg-density-edit-storm_shared.js";

describe("rpg density edit storm shared", () => {
  it("flags missing authoritative APIs", () => {
    const discovery = discoverEditStormApis({
      ready: true,
      stats: {},
      setPose: () => {},
      settle: async () => {},
      runTerrainEditProbe: async () => ({
        editRevision: 1,
        voxelDeltaCount: 1,
        dirtyRevision: 1,
        streamInvalidations: 0,
        streamRebuilds: 0,
      }),
    });
    expect(discovery.canRunStorm).toBe(true);
    expect(discovery.available).toEqual(["runTerrainEditProbe"]);
    expect(discovery.missing).toEqual([
      "scheduleDig",
      "destroyEnvironmentalProp",
      "fellTree",
      "placeConstructionPiece",
      "breakConstructionPiece",
    ]);
  });

  it("summarizes latency ladders and frame stalls", () => {
    const latency = summarizeLatency([
      {
        editClass: "dig",
        requestToVisibleMs: 10,
        requestToColliderMs: 20,
        requestToSummaryMs: 30,
        requestToDurableMs: 40,
        stubbed: false,
      },
      {
        editClass: "dig",
        requestToVisibleMs: 14,
        requestToColliderMs: 24,
        requestToSummaryMs: 34,
        requestToDurableMs: 44,
        stubbed: false,
      },
    ]);
    expect(latency.requestToVisible_p50).toBe(14);
    expect(latency.requestToDurable_p95).toBe(44);
    const stalls = summarizeFrameStalls([40, 80, 120, 90, 150], 1);
    expect(stalls.maxFrameMs).toBe(150);
    expect(stalls.framesOver100Ms).toBe(2);
    expect(stalls.samples).toBe(4);
  });
});
