import { describe, expect, it } from "vitest";
import type { TreeGpuRingRuntimeState } from "./tree_system_gpu_ring_runtime.js";
import { treeGpuRingRequiresClear } from "./tree_gpu_ring_clear_policy.js";

describe("tree GPU ring clear policy", () => {
  it("skips an already-cleared idle ring", () => {
    expect(treeGpuRingRequiresClear(state())).toBe(false);
  });

  it("skips an already-cleared disabled ring", () => {
    expect(treeGpuRingRequiresClear(state({ stats: stats("disabled") }))).toBe(false);
  });

  it.each([
    ["compute", { compute: {} }],
    ["initialization", { init: Promise.resolve() }],
    ["draw resources", { draw: {} }],
    ["ring meshes", { ringMeshes: [{}] }],
    ["prepass twins", { prepassTwins: [{}] }],
    ["active key", { key: "ring-key" }],
    ["failed key", { failedKey: "failed-key" }],
    ["visible count", { visibleCount: 1 }],
    ["overflow", { overflowed: true }],
    ["dispatch timing", { dispatchMs: 0.2 }],
    ["validation signature", { lastValidationSignature: "validation" }],
    ["non-idle stats", { stats: stats("ready") }],
  ])("requires cleanup for %s", (_label, patch) => {
    expect(treeGpuRingRequiresClear(state(patch))).toBe(true);
  });
});

function state(patch: Partial<TreeGpuRingRuntimeState> = {}): TreeGpuRingRuntimeState {
  return {
    status: "disabled",
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
    stats: stats("idle"),
    frustumPlaneScratch: new Float32Array(24) as Float32Array<ArrayBuffer>,
    lastValidationSignature: "",
    clusterVisibilityCache: {} as TreeGpuRingRuntimeState["clusterVisibilityCache"],
    clusterVisibilityProviderKey: "",
    clusterVisibilityProviderRevision: 0,
    clusterVisibilitySampler: undefined,
    ...patch,
  } as TreeGpuRingRuntimeState;
}

function stats(status: TreeGpuRingRuntimeState["stats"]["status"]): TreeGpuRingRuntimeState["stats"] {
  return {
    status,
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
