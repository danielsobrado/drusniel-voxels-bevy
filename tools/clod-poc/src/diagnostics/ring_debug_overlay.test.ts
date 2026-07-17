import { describe, expect, it } from "vitest";
import {
  ringDebugCandidatePositions,
  ringDebugEnabled,
  ringDebugShouldRecenter,
} from "./ring_debug_overlay.js";

describe("ring_debug_overlay", () => {
  it("keeps overlays disabled by default and supports global or per-kind flags", () => {
    expect(ringDebugEnabled("stones", new URLSearchParams())).toBe(false);
    expect(ringDebugEnabled("stones", new URLSearchParams("ringDebug=1"))).toBe(true);
    expect(ringDebugEnabled("understory", new URLSearchParams("understoryRingDebug=on"))).toBe(true);
    expect(ringDebugEnabled("stones", new URLSearchParams("understoryRingDebug=1"))).toBe(false);
  });

  it("recenters only after the configured movement threshold", () => {
    expect(ringDebugShouldRecenter(Number.POSITIVE_INFINITY, 0, 0, 0, 8)).toBe(true);
    expect(ringDebugShouldRecenter(0, 0, 7.99, 0, 8)).toBe(false);
    expect(ringDebugShouldRecenter(0, 0, 8, 0, 8)).toBe(true);
  });

  it("builds a bounded toroidal candidate preview", () => {
    const positions = ringDebugCandidatePositions({
      centerX: 0,
      centerZ: 0,
      cellSizeM: 2,
      grid: 100,
      outerRadiusM: 100,
      maxPoints: 256,
    });
    expect(positions.length % 3).toBe(0);
    expect(positions.length / 3).toBeLessThanOrEqual(256);
    for (let i = 0; i < positions.length; i += 3) {
      expect(Math.hypot(positions[i], positions[i + 2])).toBeLessThanOrEqual(100.001);
    }
  });
});
