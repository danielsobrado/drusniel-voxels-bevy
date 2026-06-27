import { describe, expect, it } from "vitest";
import { resolveStreamingOwnership } from "../streaming/streaming_ownership.js";
import { TerrainOwnershipRuntime } from "./terrain_ownership_runtime.js";

const ownership = resolveStreamingOwnership({
  streaming: { preload_seconds: 4, live_radius_m: 128, clod_radius_m: 512 },
  targetVisibleM: 1024,
  targetFutureVisibleM: 2048,
  streamingScene: true,
});

describe("terrain ownership runtime", () => {
  it("reports live chunks, visual pages, and far shell ownership radii", () => {
    const runtime = new TerrainOwnershipRuntime(ownership, {
      live: { chunkSizeM: 64, hysteresisM: 64 },
      visualPages: { pageSizeM: 64, maxLevel: 1, hysteresisM: 64 },
    });

    const snapshot = runtime.update({ x: 0, z: 0 });

    expect(snapshot.live.required.length).toBeGreaterThan(0);
    expect(snapshot.visualPages.required.length).toBeGreaterThan(0);
    expect(snapshot.farShell.innerRadiusM).toBe(512);
    expect(snapshot.farShell.outerRadiusM).toBe(2048);
  });

  it("returns the latest snapshot without moving the center", () => {
    const runtime = new TerrainOwnershipRuntime(ownership, {
      live: { chunkSizeM: 64, hysteresisM: 64 },
      visualPages: { pageSizeM: 64, maxLevel: 1, hysteresisM: 64 },
    });

    const first = runtime.update({ x: 128, z: 256 });
    const snapshot = runtime.snapshot();

    expect(snapshot.center).toEqual({ x: 128, z: 256 });
    expect(snapshot.live.required).toEqual(first.live.required);
    expect(snapshot.visualPages.required).toEqual(first.visualPages.required);
  });
});
