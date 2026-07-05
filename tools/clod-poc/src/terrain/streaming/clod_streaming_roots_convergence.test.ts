import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../../config.js";
import type { ClodPageNode, PageMesh } from "../../types.js";
import {
  createStreamingClodRootController,
  resolveStreamingClodMaxRootLevel,
  streamingClodPageKey,
  type PageCoord,
  type StreamingClodRootBuildResult,
  type StreamingClodRootControllerDeps,
} from "./clod_streaming_roots.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface TestGlobal {
  window?: unknown;
}

const BASE_CFG: ClodPagesConfig = {
  page: { chunks_per_page: 2, chunk_size: 16, halo_chunks: 1, quadtree_levels: 4 },
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
  streaming: { clod: { max_root_level: 1 } },
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

function testGlobal(): TestGlobal {
  return globalThis as unknown as TestGlobal;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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

function makeNode(px: number, pz: number, level = 0, cfg = BASE_CFG): ClodPageNode {
  const pageSize = cfg.page.chunks_per_page * cfg.page.chunk_size * 2 ** level;
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
  const cfg = overrides.cfg ?? BASE_CFG;
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
  const controller = createStreamingClodRootController({
    roots,
    allNodes,
    cfg,
    worldCells: 64,
    enabled: true,
    buildBudgetPagesPerFrame: 64,
    applyBudgetPagesPerFrame: 64,
    maxCachedPages: 16,
    evictDistanceMultiplier: 1,
    buildPages,
    ...overrides,
  });
  return { controller, roots, allNodes, buildPages, requests, cfg };
}

function resolveRequest(request: Deferred<StreamingClodRootBuildResult>, coords: readonly PageCoord[], cfg = BASE_CFG): void {
  request.resolve({
    nodes: coords.map((coord) => makeNode(coord.px, coord.pz, coord.level ?? 0, cfg)),
    buildMs: 12,
    transferBytes: 10,
  });
}

afterEach(() => {
  delete testGlobal().window;
});

describe("streamed CLOD convergence controls", () => {
  it("streamed_clod_max_root_level_caps_required_levels", () => {
    const { controller, buildPages } = makeController({ maxRootLevel: 1 });
    const stats = controller.update(new THREE.Vector3(272, 0, 16), 1);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    expect(stats.maxRootLevel).toBe(1);
    expect(coords.every((coord) => (coord.level ?? 0) <= 1)).toBe(true);
    expect(coords.some((coord) => coord.level === 3)).toBe(false);
  });

  it("streamed_clod_default_acceptance_level_is_not_full_quadtree_max", () => {
    const cfg: ClodPagesConfig = { ...BASE_CFG, streaming: undefined };

    expect(resolveStreamingClodMaxRootLevel(cfg)).toBe(1);
    expect(resolveStreamingClodMaxRootLevel(cfg)).toBeLessThan(cfg.page.quadtree_levels - 1);
  });

  it("streamed_clod_missing_query_param_does_not_override_config_to_zero", () => {
    testGlobal().window = { location: { search: "?scene=infinite-islands&acceptance=1" } };

    expect(resolveStreamingClodMaxRootLevel(BASE_CFG)).toBe(1);
  });

  it("streamed_clod_query_param_overrides_configured_max_root_level", () => {
    testGlobal().window = { location: { search: "?liveClodRootMaxLevel=2" } };

    expect(resolveStreamingClodMaxRootLevel(BASE_CFG)).toBe(2);
  });

  it("streamed_clod_late_completion_inside_cache_horizon_is_cached_inactive", async () => {
    const { controller, roots, buildPages, requests } = makeController({ evictDistanceMultiplier: 1000 });
    controller.update(new THREE.Vector3(272, 0, 16), 1);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    controller.update(new THREE.Vector3(512, 0, 16), 1);
    resolveRequest(requests[0]!, coords);
    await flushAsync();
    const stats = controller.update(new THREE.Vector3(512, 0, 16), 1);

    expect(stats.cachedPages).toBe(1);
    expect(stats.staleDiscards).toBe(0);
    expect(stats.staleCompletedPagesByLevel[coords[0]!.level ?? 0]).toBeGreaterThan(0);
    expect(roots).toHaveLength(0);
  });

  it("streamed_clod_late_completion_outside_cache_horizon_is_discarded", async () => {
    const { controller, roots, buildPages, requests } = makeController({ evictDistanceMultiplier: 1 });
    controller.update(new THREE.Vector3(272, 0, 16), 1);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    controller.update(new THREE.Vector3(2048, 0, 16), 1);
    resolveRequest(requests[0]!, coords);
    await flushAsync();
    const stats = controller.update(new THREE.Vector3(2048, 0, 16), 1);

    expect(stats.cachedPages).toBe(0);
    expect(stats.staleDiscards).toBe(1);
    expect(roots).toHaveLength(0);
  });

  it("streamed_clod_per_level_request_counters_are_reported", () => {
    const counters: Record<string, number> = {};
    testGlobal().window = { __drusnielClod: { stats: { counters } } };
    const { controller } = makeController({ maxRootLevel: 1 });

    const stats = controller.update(new THREE.Vector3(272, 0, 16), 1);

    expect(stats.requestedPagesByLevel[1]).toBeGreaterThan(0);
    expect(counters["live_clod_stream_max_root_level"]).toBe(1);
    expect(counters["live_clod_stream_requested_l1_pages"]).toBeGreaterThan(0);
    expect(counters["live_clod_stream_worker_build_ms_l1_p95"]).toBe(0);
  });
});
