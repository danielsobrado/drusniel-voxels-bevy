import { describe, expect, it } from "vitest";
import type { TerrainOwnershipRuntimeSnapshot } from "./terrain_ownership_runtime.js";
import { TerrainOwnershipRuntime } from "./terrain_ownership_runtime.js";
import type { StreamingOwnershipRadii } from "../streaming/streaming_ownership.js";
import { liveChunkKey } from "./live_chunk_keys.js";
import { pageKey } from "./page_plan.js";
import { computeOwnershipCoverageCounters } from "./ownership_coverage_oracle.js";
import { createSnapshotOwnershipResidencyFeeds } from "./ownership_residency.js";

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
  it("keeps raw live/CLOD overlap diagnostics while acceptance overlap is priority-resolved", () => {
    const counters = computeOwnershipCoverageCounters({
      snapshot: snapshot({
        live: {
          center: { x: 0, z: 0 },
          required: [liveChunkKey({ x: 0, z: 0 })],
          loaded: [liveChunkKey({ x: 0, z: 0 })],
          evictable: [],
        },
        visualPages: {
          center: { x: 0, z: 0 },
          required: [pageKey(0, 0, 0)],
          loaded: [pageKey(0, 0, 0)],
          evictable: [],
        },
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
    expect(counters.raw_live_clod_overlap_cells).toBeGreaterThan(0);
    expect(counters.live_clod_overlap_cells).toBe(0);
  });

  it("reports known live/CLOD and CLOD/far-shell gaps", () => {
    const counters = computeOwnershipCoverageCounters({
      snapshot: snapshot({
        live: {
          center: { x: 0, z: 0 },
          required: [liveChunkKey({ x: 0, z: 0 })],
          loaded: [],
          evictable: [],
        },
        visualPages: {
          center: { x: 0, z: 0 },
          required: [pageKey(0, 1, 0)],
          loaded: [],
          evictable: [],
        },
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
    expect(counters.live_clod_gap_holes).toBeGreaterThan(0);
    expect(counters.clod_far_gap_holes).toBeGreaterThan(0);
    expect(counters.missing_live_chunks_in_required_radius).toBe(1);
    expect(counters.missing_clod_pages_in_required_radius).toBe(1);
    expect(counters.clod_parent_coverage_violations).toBe(1);
    expect(counters.ring_boundary_holes).toBeGreaterThan(0);
  });

  it("does not report a parent coverage violation when a resident ancestor covers a missing page", () => {
    const counters = computeOwnershipCoverageCounters({
      snapshot: snapshot({
        visualPages: {
          center: { x: 0, z: 0 },
          required: [pageKey(0, 1, 1)],
          loaded: [pageKey(1, 0, 0)],
          evictable: [],
        },
      }),
      chunkSizeM: 16,
      pageSizeM: 16,
      maxLevel: 1,
      camera: { x: 0, z: 0 },
      farShellCenter: { x: 0, z: 0 },
      farShellRecenterCount: 0,
      farShellLastRecenterFrame: -1,
      coverageCellM: 8,
    });

    expect(counters.missing_clod_pages_in_required_radius).toBe(0);
    expect(counters.clod_parent_coverage_violations).toBe(0);
  });

  it("uses residency feeds instead of snapshot loaded lists for oracle ownership", () => {
    const snap = snapshot({
      visualPages: {
        center: { x: 0, z: 0 },
        required: [pageKey(0, 1, 0)],
        loaded: [pageKey(0, 1, 0)],
        evictable: [],
      },
      farShell: { innerRadiusM: 48, outerRadiusM: 96 },
    });
    const emptyClodFeed = {
      liveReady: createSnapshotOwnershipResidencyFeeds(snap).liveReady,
      clodReady: () => new Set<number>(),
    };

    const counters = computeOwnershipCoverageCounters({
      snapshot: snap,
      chunkSizeM: 16,
      pageSizeM: 16,
      maxLevel: 0,
      camera: { x: 0, z: 0 },
      farShellCenter: { x: 0, z: 0 },
      farShellRecenterCount: 0,
      farShellLastRecenterFrame: -1,
      residencyFeeds: emptyClodFeed,
      coverageCellM: 8,
    });

    expect(counters.missing_clod_pages_in_required_radius).toBe(1);
    expect(counters.clod_parent_coverage_violations).toBe(1);
    expect(counters.priority_unowned_cells).toBeGreaterThan(0);
  });

  it("uses the actual far-shell center for coverage and center-distance counters", () => {
    const counters = computeOwnershipCoverageCounters({
      snapshot: snapshot({
        visualPages: {
          center: { x: 0, z: 0 },
          required: [pageKey(0, 2, 0)],
          loaded: [pageKey(0, 2, 0)],
          evictable: [],
        },
        farShell: { innerRadiusM: 72, outerRadiusM: 96 },
      }),
      chunkSizeM: 16,
      pageSizeM: 16,
      maxLevel: 0,
      camera: { x: 0, z: 0 },
      farShellCenter: { x: 48, z: 0 },
      farShellRecenterCount: 1,
      farShellLastRecenterFrame: 12,
      coverageCellM: 8,
    });
    expect(counters.camera_to_far_shell_center_m).toBe(48);
    expect(counters.far_shell_recenter_count).toBe(1);
    expect(counters.far_shell_last_recenter_frame).toBe(12);
    expect(counters.clod_far_gap_holes).toBeGreaterThan(0);
  });

  it("uses far clipmap as the far owner when it is ready", () => {
    const counters = computeOwnershipCoverageCounters({
      snapshot: snapshot({
        ownership: { liveRadiusM: 16, clodRadiusM: 48 },
        farShell: { innerRadiusM: 48, outerRadiusM: 128 },
      }),
      chunkSizeM: 16,
      pageSizeM: 16,
      maxLevel: 0,
      camera: { x: 0, z: 0 },
      farShellCenter: { x: 0, z: 0 },
      farShellRecenterCount: 0,
      farShellLastRecenterFrame: -1,
      farClipmap: {
        enabled: true,
        innerRadiusM: 48,
        outerRadiusM: 128,
        centerX: 0,
        centerZ: 0,
        snapX: 0,
        snapZ: 0,
        ready: true,
      },
      coverageCellM: 16,
    });

    expect(counters.far_clipmap_owned_cells).toBeGreaterThan(0);
    expect(counters.owner_far_clipmap_cells).toBeGreaterThan(0);
    expect(counters.far_clipmap_ownership_holes).toBe(0);
  });

  it("reports far clipmap ownership holes while a far clipmap band is not ready", () => {
    const counters = computeOwnershipCoverageCounters({
      snapshot: snapshot({
        ownership: { liveRadiusM: 16, clodRadiusM: 48 },
        farShell: { innerRadiusM: 48, outerRadiusM: 128 },
      }),
      chunkSizeM: 16,
      pageSizeM: 16,
      maxLevel: 0,
      camera: { x: 0, z: 0 },
      farShellCenter: { x: 0, z: 0 },
      farShellRecenterCount: 0,
      farShellLastRecenterFrame: -1,
      farClipmap: {
        enabled: true,
        innerRadiusM: 48,
        outerRadiusM: 128,
        centerX: 0,
        centerZ: 0,
        snapX: 0,
        snapZ: 0,
        ready: false,
      },
      coverageCellM: 16,
    });

    expect(counters.far_clipmap_unowned_cells).toBeGreaterThan(0);
    expect(counters.far_clipmap_ownership_holes).toBeGreaterThan(0);
    expect(counters.ring_boundary_holes).toBeGreaterThanOrEqual(counters.far_clipmap_ownership_holes);
  });

  it("partitions a partially refined seam between refined CLOD cells and far clipmap fallback", () => {
    const refinedReadyPageKeys = [
      pageKey(0, -2, -1),
      pageKey(0, -2, 0),
      pageKey(0, 1, -1),
      pageKey(0, 1, 0),
    ];
    const requiredRefinementPageKeys = [
      ...refinedReadyPageKeys,
      pageKey(0, -1, -2),
      pageKey(0, 0, -2),
      pageKey(0, -1, 1),
      pageKey(0, 0, 1),
      pageKey(0, -1, -1),
      pageKey(0, 0, 0),
    ];
    expect(refinedReadyPageKeys).toHaveLength(requiredRefinementPageKeys.length * 0.4);

    const counters = computeOwnershipCoverageCounters({
      snapshot: snapshot({
        ownership: { liveRadiusM: 16, clodRadiusM: 48 },
        visualPages: {
          center: { x: 0, z: 0 },
          required: requiredRefinementPageKeys,
          loaded: [pageKey(1, -1, -1), pageKey(1, -1, 0), pageKey(1, 0, -1), pageKey(1, 0, 0)],
          evictable: [],
        },
        farShell: { innerRadiusM: 48, outerRadiusM: 128 },
      }),
      chunkSizeM: 16,
      pageSizeM: 16,
      maxLevel: 1,
      requiredRootLevel: 1,
      camera: { x: 0, z: 0 },
      farShellCenter: { x: 0, z: 0 },
      farShellRecenterCount: 0,
      farShellLastRecenterFrame: -1,
      farClipmap: {
        enabled: true,
        innerRadiusM: 48,
        outerRadiusM: 128,
        centerX: 0,
        centerZ: 0,
        snapX: 0,
        snapZ: 0,
        ready: true,
        refinedClod: {
          innerRadiusM: 16,
          outerRadiusM: 48,
          pageSizeM: 16,
          readyPageKeys: refinedReadyPageKeys,
        },
      },
      coverageCellM: 16,
    });

    expect(counters.owner_clod_refinement_cells).toBeGreaterThan(0);
    expect(counters.owner_far_clipmap_cells).toBeGreaterThan(0);
    expect(counters.priority_unowned_cells).toBe(0);
    expect(counters.priority_owner_overlap_cells).toBe(0);
    expect(counters.clod_far_gap_holes).toBe(0);
    expect(counters.far_clipmap_ownership_holes).toBe(0);
  });

  it("priority ownership is gap-free even though square tiles raw-overlap the circular rings", () => {
    const chunkSizeM = 32;
    const pageSizeM = 128;
    const maxLevel = 2;
    const ownership: StreamingOwnershipRadii = {
      liveRadiusM: 200,
      clodRadiusM: 512,
      farShellInnerM: 512,
      farShellOuterM: 2048,
      targetVisibleM: 2048,
      targetFutureVisibleM: 2048,
      streamingScene: true,
    };
    const runtime = new TerrainOwnershipRuntime(ownership, {
      live: { chunkSizeM, hysteresisM: 0 },
      visualPages: { pageSizeM, maxLevel, hysteresisM: 0 },
    });
    const snap = runtime.update({ x: 0, z: 0 });

    const counters = computeOwnershipCoverageCounters({
      snapshot: snap,
      chunkSizeM,
      pageSizeM,
      maxLevel,
      camera: { x: 0, z: 0 },
      farShellCenter: { x: 0, z: 0 },
      farShellRecenterCount: 0,
      farShellLastRecenterFrame: -1,
      coverageCellM: 64,
    });

    expect(counters.raw_clod_far_overlap_cells).toBeGreaterThan(0);
    expect(counters.clod_far_overlap_cells).toBe(0);
    expect(counters.priority_owner_overlap_cells).toBe(0);
    expect(counters.priority_unowned_cells).toBe(0);
    expect(counters.clod_parent_coverage_violations).toBe(0);
    expect(counters.live_clod_gap_holes).toBe(0);
    expect(counters.clod_far_gap_holes).toBe(0);
  });
});
