import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  beginLiveBubbleMovementProbe,
  runTerrainFramePhase,
  vegetationRingCenter,
} from "./terrain_frame_phase.js";
import type { NearFieldBubbleStats } from "../../terrain/near_field/near_field_bubble_controller.js";
import type { TerrainFramePhaseInput } from "./terrain_frame_phase.js";

const BASE_BUBBLE_STATS: NearFieldBubbleStats = {
  chunkGroupsBuiltThisFrame: 0,
  bubbleMs: 0,
  chunkGroupCount: 0,
  requiredPages: 0,
  readyPages: 0,
  buildingPages: 0,
  failedPages: 0,
  evictions: 0,
  colliderEvictions: 0,
  streamedColliderPages: 0,
  validEmptyPages: 0,
  gpuRetryPages: 0,
  gpuRetriesTotal: 0,
  gpuTerminalFailuresTotal: 0,
  colliderRegistrations: 0,
  colliderRemovals: 0,
  gpuDispatchBudget: 2,
  gpuMaxInflightChunks: Number.MAX_SAFE_INTEGER,
  pendingChunks: 0,
  inflightChunks: 0,
  readyVisualPages: 0,
  avgChunkMs: 0,
  slowestPageMs: 0,
  visualRequiredPages: 0,
  visualReadyPages: 0,
  colliderRequiredPages: 0,
  colliderReadyPages: 0,
  colliderSkippedPages: 0,
  cpuWorkUnitMaxMs: 0,
};

function makeInput(stats: NearFieldBubbleStats, frameId: number): TerrainFramePhaseInput {
  return {
    state: { bubble: true, bubbleRadius: 96 } as TerrainFramePhaseInput["state"],
    pageTransitionMode: "instant",
    crossfadeStep: 1,
    interaction: { mode: "orbit" } as TerrainFramePhaseInput["interaction"],
    player: { position: new THREE.Vector3(0, 0, 0) } as TerrainFramePhaseInput["player"],
    controls: { target: new THREE.Vector3(0, 0, 0) } as TerrainFramePhaseInput["controls"],
    camera: { position: new THREE.Vector3(0, 0, 0) } as unknown as TerrainFramePhaseInput["camera"],
    selectionController: {
      activeTerrainViews: () => new Set(),
      currentTerrainViews: () => new Set(),
      stats: () => ({ frameId }),
      terrainCutSnapshot: () => ({
        activeTerrainViews: new Set(),
        currentTerrainViews: new Set(),
        terrainViews: new Set(),
        protectedNodeIds: new Set(),
        stats: { frameId },
      }),
    } as unknown as TerrainFramePhaseInput["selectionController"],
    nearFieldBubbleController: {
      update: vi.fn(() => stats),
    } as unknown as TerrainFramePhaseInput["nearFieldBubbleController"],
    views: new Map(),
    worldCells: 16,
  };
}

function installCounters(): Record<string, number> {
  const counters: Record<string, number> = {};
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __drusnielClod: {
        ready: true,
        error: null,
        stats: {
          fps: 0,
          frameMs: 0,
          frameMsP95: 0,
          drawCalls: 0,
          triangles: 0,
          frame: 0,
          counters,
          gpuPasses: {},
        },
        diag: null,
        progress: 1,
        progressMsg: "ready",
        setPose: null,
        getPose: null,
        settle: null,
        flyCamEnabled: null,
        beginMovementRouteProbe: null,
      },
    },
  });
  (globalThis as typeof globalThis & { location?: unknown }).location = { search: "?scene=infinite-islands" } as Location;
  return counters;
}

describe("vegetationRingCenter", () => {
  it("keeps legacy vegetation inside finite world bounds", () => {
    const center = vegetationRingCenter(new THREE.Vector3(1600, 3, -300), 1024, false);

    expect(center.x).toBe(1022);
    expect(center.y).toBe(3);
    expect(center.z).toBe(2);
  });

  it("lets infinite islands vegetation follow the moving player", () => {
    const center = vegetationRingCenter(new THREE.Vector3(1600, 3, -300), 1024, true);

    expect(center.x).toBe(1600);
    expect(center.y).toBe(3);
    expect(center.z).toBe(-300);
  });
});

describe("terrain frame live-bubble probe counters", () => {
  it("adds collider removals by delta and keeps total evictions cumulative", () => {
    const counters = installCounters();

    runTerrainFramePhase(makeInput({
      ...BASE_BUBBLE_STATS,
      evictions: 3,
      colliderRemovals: 5,
    }, 1));
    const totalBeforeProbe = counters["live_bubble_evictions_total"];

    beginLiveBubbleMovementProbe();
    runTerrainFramePhase(makeInput({
      ...BASE_BUBBLE_STATS,
      evictions: 2,
      colliderEvictions: 1,
      colliderRemovals: 7,
    }, 2));

    runTerrainFramePhase(makeInput({
      ...BASE_BUBBLE_STATS,
      colliderRemovals: 7,
    }, 3));

    expect(counters["live_bubble_probe_evictions_total"]).toBe(2);
    expect(counters["live_bubble_probe_collider_removals_total"]).toBe(2);
    expect(counters["live_bubble_evictions_total"]).toBe((totalBeforeProbe ?? 0) + 2);
  });

  it("mirrors explicit valid-empty live-bubble pages", () => {
    const counters = installCounters();

    runTerrainFramePhase(makeInput({
      ...BASE_BUBBLE_STATS,
      validEmptyPages: 2,
    }, 1));

    expect(counters["live_bubble_valid_empty_pages"]).toBe(2);
  });

  it("mirrors GPU retry counters", () => {
    const counters = installCounters();

    runTerrainFramePhase(makeInput({
      ...BASE_BUBBLE_STATS,
      gpuRetryPages: 3,
      gpuRetriesTotal: 5,
      gpuTerminalFailuresTotal: 1,
    }, 1));

    expect(counters["live_bubble_gpu_retry_pages"]).toBe(3);
    expect(counters["live_bubble_gpu_retries_total"]).toBe(5);
    expect(counters["live_bubble_gpu_failures_total"]).toBe(1);
  });

  it("keeps the mirrored building counter nonzero while GPU retries remain", () => {
    const counters = installCounters();

    runTerrainFramePhase(makeInput({
      ...BASE_BUBBLE_STATS,
      buildingPages: 0,
      gpuRetryPages: 2,
    }, 1));

    expect(counters["live_bubble_building_pages"]).toBe(2);
  });
});
