import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings, type TreeLod } from "./tree_config.js";
import type {
  TreeGpuRingRuntimeInput,
  TreeGpuRingRuntimeState,
} from "./tree_system_gpu_ring_runtime.js";

const runtime = vi.hoisted(() => ({
  clear: vi.fn(),
  update: vi.fn(),
}));

vi.mock("./tree_system_gpu_ring_runtime.js", () => ({
  clearTreeGpuRing: runtime.clear,
  updateTreeGpuRingTrees: runtime.update,
}));

import { updateTreeGpuRingTreesSafely } from "./tree_system_gpu_ring_safe_update.js";

describe("tree GPU ring safe update", () => {
  beforeEach(() => {
    runtime.clear.mockReset();
    runtime.update.mockReset();
    runtime.clear.mockImplementation((input: TreeGpuRingRuntimeInput) => {
      input.state.compute = null;
      input.state.init = null;
      input.state.key = "";
      input.state.failedKey = "";
      input.state.draw = null;
      input.state.ringMeshes = [];
      input.state.prepassTwins = [];
      input.state.stats = stats("idle");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back and latches a thrown execution failure", () => {
    const input = fixture(true);
    runtime.update.mockImplementation(() => {
      throw new Error("tree dispatch failed");
    });

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.clear).toHaveBeenCalledTimes(1);
    expect(runtime.update).toHaveBeenCalledTimes(1);
    expect(input.state.status).toBe("fallback-cpu");
    expect(input.state.stats.status).toBe("failed");
    expect(input.state.stats.reason).toBe("tree dispatch failed");
    expect(input.state.failedKey).not.toBe("");
    expect(console.warn).toHaveBeenCalledTimes(1);

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.update).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);

    input.settings.seed++;
    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.update).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it("tears down same-frame failed stats", () => {
    const input = fixture(true);
    runtime.update.mockImplementation((runtimeInput: TreeGpuRingRuntimeInput) => {
      runtimeInput.state.stats = stats("failed", "tree readback failed");
      return true;
    });

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.clear).toHaveBeenCalledTimes(1);
    expect(input.state.status).toBe("fallback-cpu");
    expect(input.state.stats.reason).toBe("tree readback failed");
  });

  it("reports an error when CPU fallback is disabled", () => {
    const input = fixture(false);
    runtime.update.mockImplementation(() => {
      throw new Error("tree queue submit failed");
    });

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(input.state.status).toBe("error");
    expect(input.state.stats.reason).toBe("tree queue submit failed");
    expect(console.warn).toHaveBeenCalledWith(
      "[trees-gpu-ring] GPU ring disabled: tree queue submit failed",
    );
  });

  it("does not repeat cleanup for failures already handled by the runtime", () => {
    const input = fixture(true);
    input.state.status = "fallback-cpu";
    runtime.update.mockReturnValue(false);

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.clear).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("returns a successful update without changing runtime state", () => {
    const input = fixture(true);
    runtime.update.mockReturnValue(true);

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(true);
    expect(runtime.clear).not.toHaveBeenCalled();
    expect(input.state.failedKey).toBe("");
    expect(console.warn).not.toHaveBeenCalled();
  });
});

function fixture(fallbackToCpu: boolean): TreeGpuRingRuntimeInput {
  const settings = cloneTreeSettings();
  settings.gpu.fallbackToCpu = fallbackToCpu;
  const lodCounts = { near: 0, mid: 0, far: 0, impostor: 0 } satisfies Record<TreeLod, number>;
  return {
    state: state(),
    root: new THREE.Group(),
    settings,
    worldCells: 64,
    sampler: undefined,
    gpuDevice: {} as GPUDevice,
    gpuBackend: {},
    supportsGpuTrees: true,
    unsupportedReason: null,
    lodCounts,
    createDrawResources: vi.fn(),
    geometryForGpuRing: () => new THREE.BoxGeometry(1, 1, 1),
  } as TreeGpuRingRuntimeInput;
}

function state(): TreeGpuRingRuntimeState {
  return {
    status: "ring",
    visibleCount: 0,
    overflowed: false,
    dispatchMs: null,
    loggedError: null,
    compute: null,
    init: null,
    key: "",
    failedKey: "",
    generation: 0,
    draw: null,
    ringMeshes: [],
    prepassTwins: [],
    stats: stats("ready"),
    frustumPlaneScratch: new Float32Array(24) as Float32Array<ArrayBuffer>,
    lastValidationSignature: "",
    clusterVisibilityCache: {} as TreeGpuRingRuntimeState["clusterVisibilityCache"],
    clusterVisibilityProviderKey: "",
    clusterVisibilityProviderRevision: 0,
    clusterVisibilitySampler: undefined,
  };
}

function stats(
  status: TreeGpuRingRuntimeState["stats"]["status"],
  reason?: string,
): TreeGpuRingRuntimeState["stats"] {
  return {
    status,
    reason,
    candidateCount: 0,
    candidateCountBeforePrefilter: 0,
    candidateCountAfterPrefilter: 0,
    acceptedCandidates: 0,
    counts: { near: 0, mid: 0, far: 0, impostor: 0 },
    groupCounts: [],
    shadowGroupCounts: [],
    overflowed: false,
    shadowOverflowed: false,
    submitMs: null,
    readbackMs: null,
    skippedDispatches: 0,
    terrainVisibilityCounts: null,
  };
}
