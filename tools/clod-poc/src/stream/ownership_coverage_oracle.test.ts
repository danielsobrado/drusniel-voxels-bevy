import { describe, expect, it } from "vitest";
import type { TerrainOwnershipRuntimeSnapshot } from "./terrain_ownership_runtime.js";
import { computeOwnershipCoverageCounters } from "./ownership_coverage_oracle.js";

function snapshot(overrides: Partial<TerrainOwnershipRuntimeSnapshot> = {}): TerrainOwnershipRuntimeSnapshot {
  return {
    center: { x: 0, z: 0 },
    live: { center: { x: 0, z: 0 }, required: [], loaded: [], evictable: [] },
    visualPages: { center: { x: 0, z: 0 }, required: [], loaded: [], evictable: [] },
    ownership: { liveRadiusM: 16, clodRadiusM: 48 },
    farShell: { innerRadiusM: 48, outerRadiusM: 96 },
    ...overrides,
  };
}

describe("ownership coverage oracle", () => {
  it("reports known live/CLOD overlaps from footprints", () => {
    const counters = computeOwnershipCoverageCounters({
      snapshot: snapshot({
        live: { center: { x: 0, z: 0 }, required: ["0,0"], loaded: ["0,0"], evictable: [] },
        visualPages: { center: { x: 0, z: 0 }, required: ["0:0,0"], loaded: ["0:0,0"], evictable: [] },
      }),
      chunkSizeM: 16,
      pageSizeM: 16,
      maxLevel: 0,
      camera: { x: 0, z: 0 },
      farShellCenter: { x: 0, z: 0 },
      farShellRecenterCount: 0,
      farShellLastRecenterFrame: -1,
      coverageCellM: 8,
    });
    expect(counters.live_clod_overlap_cells).toBeGreaterThan(0);
  });

  it("reports known CLOD/far-shell gaps and missing required pages", () => {
    const counters = computeOwnershipCoverageCounters({
      snapshot: snapshot({
        visualPages: { center: { x: 0, z: 0 }, required: ["0:1,0"], loaded: [], evictable: [] },
        farShell: { innerRadiusM: 72, outerRadiusM: 96 },
      }),
      chunkSizeM: 16,
      pageSizeM: 16,
      maxLevel: 0,
      camera: { x: 0, z: 0 },
      farShellCenter: { x: 0, z: 0 },
      farShellRecenterCount: 0,
      farShellLastRecenterFrame: -1,
      coverageCellM: 8,
    });
    expect(counters.clod_far_gap_holes).toBeGreaterThan(0);
    expect(counters.missing_clod_pages_in_required_radius).toBe(1);
    expect(counters.ring_boundary_holes).toBeGreaterThan(0);
  });
});
