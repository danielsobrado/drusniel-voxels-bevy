import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import type { FarHeightProvider } from "../../far-summary/clipmap-sampler.js";
import { getGlobalCoherentFarSummaryProvider } from "./far_clipmap_source.js";

describe("getGlobalCoherentFarSummaryProvider", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("waits for first coherence, then retains the stale-capable provider during refill", () => {
    const provider: FarHeightProvider = {
      sampleHeight: () => 12,
      sampleNormal: () => new THREE.Vector3(0, 1, 0),
    };
    const stats = { requestedTiles: 8, readyTiles: 4 };
    (globalThis as unknown as { window: unknown }).window = {
      __drusnielFarSummary: { stats, getHeightProvider: () => provider },
    };

    expect(getGlobalCoherentFarSummaryProvider()).toBeUndefined();
    stats.readyTiles = 8;
    expect(getGlobalCoherentFarSummaryProvider()).toBe(provider);
    stats.readyTiles = 6;
    expect(getGlobalCoherentFarSummaryProvider()).toBe(provider);
  });
});
