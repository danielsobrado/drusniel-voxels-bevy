import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import { DEFAULT_DIAGONAL_FLIP_CONFIG } from "../../config.js";
import type { ClodPageNode, PageMesh } from "../../types.js";
import {
  createStreamingClodRootController,
  streamingClodPageKey,
  type PageCoord,
  type StreamingClodRootBuildResult,
  type StreamingClodRootControllerDeps,
} from "./clod_streaming_roots.js";

const TEST_CFG: ClodPagesConfig = {
  page: { chunks_per_page: 2, chunk_size: 16, halo_chunks: 1, quadtree_levels: 2 },
  simplify: {
    target_ratio_per_level: 0.5,
    abandon_ratio: 0.85,
    target_error: 0.01,
    weld_epsilon_cells: 0.001,
    attribute_weights: { normal: 0.5, material: 1 },
  },
  polish: { diagonal_flip: DEFAULT_DIAGONAL_FLIP_CONFIG },
  selection: {
    error_threshold_px: 1,
    hysteresis_merge_factor: 1.5,
    neighbor_level_delta_max: 1,
    transition_mode: "instant",
    crossfade_frames: 0,
    freeze_selection: false,
  },
  near_field: { enabled: true, radius_chunks: 6, show_mask: true },
  debug: {
    show_wireframe: true,
    show_page_boundaries: true,
    show_locked_border_vertices: false,
    show_error_labels: true,
    show_stats_panel: true,
    lod_colors: { lod0: "#3b82f6", lod1: "#22c55e", lod2: "#f59e0b", lod3: "#ef4444" },
  },
  stress: { active_scene: "ridge_border" },
  meshopt_package_version: "0.22.0",
  poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: true, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.997, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function mesh(): PageMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    paintSlots: new Float32Array([0, 0, 0]),
    materialWeights: new Float32Array(12),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2]),
  };
}

function makeNode(px: number, pz: number, level = 0): ClodPageNode {
  const pageSize = TEST_CFG.page.chunks_per_page * TEST_CFG.page.chunk_size * 2 ** level;
  const minX = px * pageSize;
  const minZ = pz * pageSize;
  return {
    id: streamingClodPageKey(px, pz, level),
    revision: 1,
    level,
    children: [],
    mesh: mesh(),
    footprint: { minX, minZ, maxX: minX + pageSize, maxZ: minZ + pageSize },
    bounds: { center: [minX + pageSize / 2, 0, minZ + pageSize / 2], radius: pageSize, minY: 0, maxY: 1 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function makeController(overrides: Partial<StreamingClodRootControllerDeps> = {}) {
  const roots: ClodPageNode[] = overrides.roots ?? [];
  const allNodes: ClodPageNode[] = overrides.allNodes ?? [];
  const requests: Deferred<StreamingClodRootBuildResult>[] = [];
  const buildPages = overrides.buildPages !== undefined
    ? overrides.buildPages
    : vi.fn(() => {
      const next = deferred<StreamingClodRootBuildResult>();
      requests.push(next);
      return next.promise;
    });
  const onRootsChanged = overrides.onRootsChanged ?? vi.fn();
  const controller = createStreamingClodRootController({
    roots,
    allNodes,
    cfg: TEST_CFG,
    worldCells: 64,
    enabled: true,
    buildBudgetPagesPerFrame: 5,
    applyBudgetPagesPerFrame: 5,
    maxCachedPages: 16,
    rootSwitchStableFrames: 0,
    rootTransition: { enabled: true, mode: "crossfade", durationFrames: 2, maxExtraRoots: 64 },
    buildPages,
    onRootsChanged,
    ...overrides,
  });
  return { controller, roots, allNodes, buildPages, requests, onRootsChanged };
}

function resolveRequest(request: Deferred<StreamingClodRootBuildResult>, coords: readonly PageCoord[]): void {
  request.resolve({ nodes: coords.map((coord) => makeNode(coord.px, coord.pz, coord.level ?? 0)), buildMs: 1, transferBytes: 10 });
}

async function buildParentAndChildren() {
  const harness = makeController();
  const center = new THREE.Vector3(288, 0, 32);
  harness.controller.update(center, 30);
  resolveRequest(harness.requests[0]!, (harness.buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[]);
  await flushAsync();
  harness.controller.update(center, 30);
  resolveRequest(harness.requests[1]!, (harness.buildPages as ReturnType<typeof vi.fn>).mock.calls[1]![0] as readonly PageCoord[]);
  await flushAsync();
  return { ...harness, center };
}

describe("streamed root transitions", () => {
  it("starts a transition when current and next root sets cover safety pages", async () => {
    const { controller, roots, center } = await buildParentAndChildren();

    const stats = controller.update(center, 30);

    expect(stats.transitionActiveGroups).toBe(1);
    expect(stats.transitionFadeOutRoots).toBe(1);
    expect(stats.transitionFadeInRoots).toBe(4);
    expect(roots.map((node) => node.id)).toEqual(["L0:8,0", "L0:8,1", "L0:9,0", "L0:9,1", "L1:4,0"]);
  });

  it("removes outgoing roots after the configured duration", async () => {
    const { controller, roots, center } = await buildParentAndChildren();
    controller.update(center, 30);
    controller.update(center, 30);
    const stats = controller.update(center, 30);

    expect(stats.transitionCompletedTotal).toBe(1);
    expect(stats.transitionActiveGroups).toBe(0);
    expect(roots.map((node) => node.id)).toEqual(["L0:8,0", "L0:8,1", "L0:9,0", "L0:9,1"]);
  });

  it("caps transition roots with a hard switch", async () => {
    const harness = makeController({ rootTransition: { enabled: true, mode: "crossfade", durationFrames: 2, maxExtraRoots: 0 } });
    const center = new THREE.Vector3(288, 0, 32);
    harness.controller.update(center, 30);
    resolveRequest(harness.requests[0]!, (harness.buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[]);
    await flushAsync();
    harness.controller.update(center, 30);
    resolveRequest(harness.requests[1]!, (harness.buildPages as ReturnType<typeof vi.fn>).mock.calls[1]![0] as readonly PageCoord[]);
    await flushAsync();

    const stats = harness.controller.update(center, 30);

    expect(stats.transitionCappedTotal).toBe(1);
    expect(stats.transitionHardSwitchesTotal).toBe(1);
    expect(stats.transitionActiveGroups).toBe(0);
    expect(harness.roots.map((node) => node.id)).toEqual(["L0:8,0", "L0:8,1", "L0:9,0", "L0:9,1"]);
  });

  it("does not invalidate roots on every transition progress frame", async () => {
    const onRootsChanged = vi.fn();
    const harness = makeController({ onRootsChanged });
    const center = new THREE.Vector3(288, 0, 32);
    harness.controller.update(center, 30);
    resolveRequest(harness.requests[0]!, (harness.buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[]);
    await flushAsync();
    harness.controller.update(center, 30);
    resolveRequest(harness.requests[1]!, (harness.buildPages as ReturnType<typeof vi.fn>).mock.calls[1]![0] as readonly PageCoord[]);
    await flushAsync();
    harness.controller.update(center, 30);
    onRootsChanged.mockClear();

    harness.controller.update(center, 30);

    expect(onRootsChanged).not.toHaveBeenCalled();
  });

  it("preserves hard-switch behavior when disabled", async () => {
    const harness = makeController({ rootTransition: { enabled: false, mode: "crossfade", durationFrames: 2, maxExtraRoots: 64 } });
    const center = new THREE.Vector3(288, 0, 32);
    harness.controller.update(center, 30);
    resolveRequest(harness.requests[0]!, (harness.buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[]);
    await flushAsync();
    harness.controller.update(center, 30);
    resolveRequest(harness.requests[1]!, (harness.buildPages as ReturnType<typeof vi.fn>).mock.calls[1]![0] as readonly PageCoord[]);
    await flushAsync();

    const stats = harness.controller.update(center, 30);

    expect(stats.transitionEnabled).toBe(0);
    expect(stats.transitionActiveGroups).toBe(0);
    expect(harness.roots.map((node) => node.id)).toEqual(["L0:8,0", "L0:8,1", "L0:9,0", "L0:9,1"]);
  });

  it("fallback-disabled transition path does not throw", () => {
    const { controller } = makeController({ rootTransition: { enabled: false, mode: "crossfade", durationFrames: 12, maxExtraRoots: 64 } });

    expect(() => controller.update(new THREE.Vector3(192, 0, 0), 40)).not.toThrow();
  });
});
