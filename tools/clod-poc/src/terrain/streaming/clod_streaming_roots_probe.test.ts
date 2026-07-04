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
  reject: (error: unknown) => void;
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

function makeNode(px: number, pz: number): ClodPageNode {
  const pageSize = TEST_CFG.page.chunks_per_page * TEST_CFG.page.chunk_size;
  const minX = px * pageSize;
  const minZ = pz * pageSize;
  return {
    id: streamingClodPageKey(px, pz),
    revision: 1,
    level: 0,
    children: [],
    mesh: mesh(),
    footprint: { minX, minZ, maxX: minX + pageSize, maxZ: minZ + pageSize },
    bounds: { center: [minX + pageSize / 2, 0, minZ + pageSize / 2], radius: pageSize, minY: 0, maxY: 1 },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function resolveRequest(request: Deferred<StreamingClodRootBuildResult>, coords: readonly PageCoord[]): void {
  request.resolve({
    nodes: coords.map((coord) => makeNode(coord.px, coord.pz)),
    buildMs: 1,
    transferBytes: 10,
  });
}

function makeController() {
  const roots: ClodPageNode[] = [];
  const allNodes: ClodPageNode[] = [];
  const requests: Deferred<StreamingClodRootBuildResult>[] = [];
  const buildPages = vi.fn((coords: readonly PageCoord[]) => {
    const next = deferred<StreamingClodRootBuildResult>();
    requests.push(next);
    return next.promise;
  });
  const controller = createStreamingClodRootController({
    roots,
    allNodes,
    cfg: TEST_CFG,
    worldCells: 64,
    enabled: true,
    buildBudgetPagesPerFrame: 1,
    applyBudgetPagesPerFrame: 1,
    maxCachedPages: 1,
    evictDistanceMultiplier: 1,
    buildPages,
  });
  return { controller, roots, allNodes, buildPages, requests };
}

describe("streamed CLOD root movement probes", () => {
  it("counts route-owned worker requests, applies, and evictions", async () => {
    const { controller, buildPages, requests } = makeController();

    expect(controller.stats().probeRequestedPagesTotal).toBe(0);
    controller.beginMovementProbe();

    const scheduled = controller.update(new THREE.Vector3(256, 0, 0), 40);
    const coords = buildPages.mock.calls.at(-1)?.[0] as readonly PageCoord[];
    expect(scheduled.probeActive).toBe(1);
    expect(scheduled.probeRequestedPagesTotal).toBe(1);
    expect(coords).toHaveLength(1);

    resolveRequest(requests.at(-1)!, coords);
    await flushAsync();

    const applied = controller.update(new THREE.Vector3(256, 0, 0), 40);
    expect(applied.probeApplyPagesTotal).toBe(1);
    expect(applied.cachedPages).toBe(1);

    const evicted = controller.update(new THREE.Vector3(2048, 0, 2048), 1);
    expect(evicted.probeEvictionsTotal).toBeGreaterThan(0);
  });

  it("retries route pages after worker rejection cooldown instead of permanently poisoning them", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { controller, buildPages, requests } = makeController();

    controller.beginMovementProbe();
    controller.update(new THREE.Vector3(256, 0, 0), 40);
    requests[0]!.reject(new Error("temporary worker failure"));
    await flushAsync();

    controller.update(new THREE.Vector3(256, 0, 0), 40);
    expect(controller.stats().failedPages).toBe(1);
    expect(buildPages).toHaveBeenCalledTimes(1);

    for (let frame = 0; frame < 60; frame++) {
      controller.update(new THREE.Vector3(256, 0, 0), 40);
    }

    expect(buildPages).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
