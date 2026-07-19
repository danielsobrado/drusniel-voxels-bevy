import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings, type TreeLod } from "./tree_config.js";
import type {
  TreeGpuRingRuntimeInput,
  TreeGpuRingRuntimeState,
} from "./tree_system_gpu_ring_runtime.js";

const compute = vi.hoisted(() => ({
  key: vi.fn((settings: { seed: number }, worldCells: number) => `${worldCells}|${settings.seed}`),
}));

const runtime = vi.hoisted(() => ({
  clear: vi.fn(),
  update: vi.fn(),
}));

vi.mock("../gpu/tree_ring_compute.js", () => ({
  treeGpuRingKey: compute.key,
}));

vi.mock("./tree_system_gpu_ring_runtime.js", () => ({
  clearTreeGpuRing: runtime.clear,
  updateTreeGpuRingTrees: runtime.update,
}));

import { updateTreeGpuRingTreesSafely } from "./tree_system_gpu_ring_safe_update.js";

describe("tree GPU ring safe update", () => {
  beforeEach(() => {
    compute.key.mockClear();
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
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    expect(compute.key).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "[trees-gpu-ring] falling back to CPU: tree dispatch failed",
    );

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.update).toHaveBeenCalledTimes(1);
    expect(compute.key).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledTimes(1);

    input.settings.seed++;
    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.update).toHaveBeenCalledTimes(2);
    expect(compute.key).toHaveBeenCalledTimes(4);
    expect(console.error).toHaveBeenCalledTimes(2);
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
    expect(compute.key).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "[trees-gpu-ring] falling back to CPU: tree readback failed",
    );
  });

  it("reports an error when CPU fallback is disabled", () => {
    const input = fixture(false);
    runtime.update.mockImplementation(() => {
      throw new Error("tree queue submit failed");
    });

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(input.state.status).toBe("error");
    expect(input.state.stats.reason).toBe("tree queue submit failed");
    expect(compute.key).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "[trees-gpu-ring] GPU ring disabled: tree queue submit failed",
    );
  });

  it("skips the runtime and logs once for a stable unavailable device", () => {
    const input = fixture(true);
    input.gpuDevice = null;

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(input.state.status).toBe("fallback-cpu");
    expect(input.state.stats.reason).toBe("WebGPU device is unavailable");
    expect(input.state.loggedError).toBe("WebGPU device is unavailable");
    expect(runtime.update).not.toHaveBeenCalled();
    expect(runtime.clear).not.toHaveBeenCalled();
    expect(compute.key).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[trees-gpu-ring] falling back to CPU: WebGPU device is unavailable",
    );

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.update).not.toHaveBeenCalled();
    expect(runtime.clear).not.toHaveBeenCalled();
    expect(compute.key).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("tears down live resources once when GPU availability is lost", () => {
    const input = fixture(true);
    input.gpuDevice = null;
    input.state.init = Promise.resolve();

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.clear).toHaveBeenCalledTimes(1);
    expect(runtime.update).not.toHaveBeenCalled();
    expect(compute.key).not.toHaveBeenCalled();

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.clear).toHaveBeenCalledTimes(1);
    expect(runtime.update).not.toHaveBeenCalled();
    expect(compute.key).not.toHaveBeenCalled();
  });

  it("retries immediately when GPU availability returns", () => {
    const input = fixture(true);
    input.gpuDevice = null;
    runtime.update.mockImplementation((runtimeInput: TreeGpuRingRuntimeInput) => {
      setLiveRing(runtimeInput);
      return true;
    });

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.update).not.toHaveBeenCalled();
    expect(compute.key).not.toHaveBeenCalled();

    input.gpuDevice = {} as GPUDevice;
    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(true);
    expect(runtime.update).toHaveBeenCalledTimes(1);
    expect(compute.key).not.toHaveBeenCalled();
  });

  it("reports unavailable GPU state without silently enabling CPU fallback", () => {
    const input = fixture(false);
    input.gpuBackend = null;

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(input.state.status).toBe("unsupported");
    expect(input.state.stats.reason).toBe("WebGPU tree backend is unavailable");
    expect(compute.key).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[trees-gpu-ring] GPU ring unavailable: WebGPU tree backend is unavailable",
    );
  });

  it("does not duplicate an error already handled by the runtime", () => {
    const input = fixture(true);
    input.state.status = "fallback-cpu";
    input.state.loggedError = "tree init failed";
    runtime.update.mockReturnValue(false);

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.clear).not.toHaveBeenCalled();
    expect(compute.key).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("keeps CPU authority while the GPU generation is still initializing", () => {
    const input = fixture(true);
    runtime.update.mockImplementation((runtimeInput: TreeGpuRingRuntimeInput) => {
      runtimeInput.state.draw = {} as NonNullable<TreeGpuRingRuntimeState["draw"]>;
      runtimeInput.state.init = Promise.resolve();
      runtimeInput.state.stats = stats("initializing");
      runtimeInput.state.status = "ring";
      return true;
    });

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(false);
    expect(runtime.update).toHaveBeenCalledTimes(1);
    expect(input.state.draw).not.toBeNull();
    expect(input.state.compute).toBeNull();
    expect(input.state.stats.status).toBe("initializing");
    expect(compute.key).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns a live successful update without building a duplicate ring key", () => {
    const input = fixture(true);
    runtime.update.mockImplementation((runtimeInput: TreeGpuRingRuntimeInput) => {
      setLiveRing(runtimeInput);
      return true;
    });

    expect(updateTreeGpuRingTreesSafely(input, new THREE.Vector3())).toBe(true);
    expect(runtime.clear).not.toHaveBeenCalled();
    expect(input.state.failedKey).toBe("");
    expect(compute.key).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
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

function setLiveRing(input: TreeGpuRingRuntimeInput): void {
  input.state.compute = {} as NonNullable<TreeGpuRingRuntimeState["compute"]>;
  input.state.draw = {} as NonNullable<TreeGpuRingRuntimeState["draw"]>;
  input.state.init = null;
  input.state.stats = stats("ready");
  input.state.status = "ring";
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
