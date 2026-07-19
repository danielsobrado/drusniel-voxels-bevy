import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TREE_GPU_RING_GROUP_COUNT,
  TREE_GPU_RING_SHADOW_GROUP_COUNT,
  treeGpuRingKey,
  type TreeGpuRingStats,
} from "../gpu/tree_ring_compute.js";
import {
  cloneTreeSettings,
  TREE_LODS,
  TREE_SPECIES,
  type TreeLod,
} from "./tree_config.js";
import {
  createTreeGpuRingRuntimeState,
  invalidateTreeGpuRingIndexCounts,
  updateTreeGpuRingTrees,
  type TreeGpuRingRuntimeInput,
} from "./tree_system_gpu_ring_runtime.js";
import type { TreeGpuRingDrawResources, TreeWebGpuBackendAccess } from "./tree_system_types.js";

const runtimeMocks = vi.hoisted(() => ({
  generateValidationCounts: vi.fn(),
  shadowCameras: vi.fn(() => []),
}));

vi.mock("./tree_ring_validation_counts.js", () => ({
  generateTreeRingValidationCounts: runtimeMocks.generateValidationCounts,
}));

vi.mock("../rendering/realtime_sun_shadows.js", () => ({
  getRealtimeSunShadowCascadeCameras: runtimeMocks.shadowCameras,
}));

describe("tree GPU ring stats snapshots", () => {
  beforeEach(() => {
    runtimeMocks.generateValidationCounts.mockReset();
    runtimeMocks.shadowCameras.mockReset().mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("takes one stats snapshot for an active GPU frame", () => {
    const fixture = runtimeFixture(createStats());

    expect(updateTreeGpuRingTrees(fixture.input, new THREE.Vector3(), fixture.camera)).toBe(true);

    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.stats).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.generateValidationCounts).not.toHaveBeenCalled();
  });

  it("reuses the post-dispatch snapshot for CPU parity validation", () => {
    const snapshot = createStats({ readbackMs: 0.2 });
    const fixture = runtimeFixture(snapshot, true);
    runtimeMocks.generateValidationCounts.mockReturnValue({
      counts: { ...snapshot.counts },
      groupCounts: [...snapshot.groupCounts],
      shadowGroupCounts: [...snapshot.shadowGroupCounts],
      overflowed: snapshot.overflowed,
      shadowOverflowed: snapshot.shadowOverflowed,
    });

    expect(updateTreeGpuRingTrees(fixture.input, new THREE.Vector3(), fixture.camera)).toBe(true);

    expect(fixture.stats).toHaveBeenCalledTimes(1);
    expect(runtimeMocks.generateValidationCounts).toHaveBeenCalledTimes(1);
  });

  it("caches geometry index counts for the draw-resource lifetime", () => {
    const fixture = runtimeFixture(createStats());
    const center = new THREE.Vector3();
    const geometryCount = TREE_SPECIES.length * TREE_LODS.length;

    expect(updateTreeGpuRingTrees(fixture.input, center, fixture.camera)).toBe(true);
    expect(updateTreeGpuRingTrees(fixture.input, center, fixture.camera)).toBe(true);
    expect(fixture.geometryForGpuRing).toHaveBeenCalledTimes(geometryCount);

    invalidateTreeGpuRingIndexCounts(fixture.input.state.draw);
    expect(updateTreeGpuRingTrees(fixture.input, center, fixture.camera)).toBe(true);
    expect(fixture.geometryForGpuRing).toHaveBeenCalledTimes(geometryCount * 2);
  });

  it("fails over from the single post-dispatch snapshot", () => {
    const fixture = runtimeFixture(createStats({
      status: "failed",
      reason: "tree counter readback failed",
    }));
    fixture.dispatch.mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(updateTreeGpuRingTrees(fixture.input, new THREE.Vector3(), fixture.camera)).toBe(false);

    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    expect(fixture.stats).toHaveBeenCalledTimes(1);
    expect(fixture.destroy).toHaveBeenCalledTimes(1);
    expect(fixture.input.state.status).toBe("fallback-cpu");
    expect(fixture.input.state.stats.reason).toBe("tree counter readback failed");
  });
});

function runtimeFixture(snapshot: TreeGpuRingStats, debugValidateAgainstCpu = false) {
  const settings = cloneTreeSettings();
  settings.enabled = true;
  settings.gpu.enabled = true;
  settings.gpu.debugValidateAgainstCpu = debugValidateAgainstCpu;
  settings.gpu.terrainVisibility.enabled = false;
  settings.lod.shadowsMaxLod = "none";

  const worldCells = 64;
  const state = createTreeGpuRingRuntimeState({} as GPUDevice);
  const dispatch = vi.fn(() => true);
  const stats = vi.fn(() => snapshot);
  const destroy = vi.fn();
  state.key = treeGpuRingKey(settings, worldCells);
  state.compute = { dispatch, stats, destroy } as unknown as NonNullable<typeof state.compute>;
  state.draw = {} as TreeGpuRingDrawResources;

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const geometryForGpuRing = vi.fn(() => geometry);
  const input: TreeGpuRingRuntimeInput = {
    state,
    root: new THREE.Group(),
    settings,
    worldCells,
    sampler: undefined,
    gpuDevice: {} as GPUDevice,
    gpuBackend: {} as TreeWebGpuBackendAccess,
    supportsGpuTrees: true,
    unsupportedReason: null,
    lodCounts: { near: 0, mid: 0, far: 0, impostor: 0 } satisfies Record<TreeLod, number>,
    createDrawResources: () => state.draw!,
    geometryForGpuRing,
  };
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return { input, camera, dispatch, stats, destroy, geometryForGpuRing };
}

function createStats(patch: Partial<TreeGpuRingStats> = {}): TreeGpuRingStats {
  return {
    status: "ready",
    candidateCount: 0,
    candidateCountBeforePrefilter: 0,
    candidateCountAfterPrefilter: 0,
    acceptedCandidates: 0,
    counts: { near: 0, mid: 0, far: 0, impostor: 0 },
    groupCounts: new Array<number>(TREE_GPU_RING_GROUP_COUNT).fill(0),
    shadowGroupCounts: new Array<number>(TREE_GPU_RING_SHADOW_GROUP_COUNT).fill(0),
    overflowed: false,
    shadowOverflowed: false,
    submitMs: 0.1,
    readbackMs: null,
    skippedDispatches: 0,
    terrainVisibilityCounts: null,
    ...patch,
  };
}
