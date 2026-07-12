import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import { DEFAULT_DIAGONAL_FLIP_CONFIG } from "../../config.js";
import type { ClodPageNode, PageMesh } from "../../types.js";
import {
  createStreamingClodRootController,
  pageInsideFiniteStartupWorld,
  pageBudgetCost,
  sortStreamingClodPageCoordsForLoad,
  streamingClodPageHasRequiredNotReadyDescendant,
  streamingClodPageKey,
  streamingClodRequiredPageCoords,
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
  const controller = createStreamingClodRootController({
    roots,
    allNodes,
    cfg: TEST_CFG,
    worldCells: 64,
    enabled: true,
    buildBudgetPagesPerFrame: 1,
    applyBudgetPagesPerFrame: 1,
    maxCachedPages: 8,
    evictDistanceMultiplier: 1,
    buildPages,
    ...overrides,
  });
  return { controller, roots, allNodes, buildPages, requests };
}

function resolveRequest(
  request: Deferred<StreamingClodRootBuildResult>,
  coords: readonly PageCoord[],
  extra: Partial<StreamingClodRootBuildResult> = {},
): void {
  request.resolve({
    nodes: coords.map((coord) => makeNode(coord.px, coord.pz, coord.level ?? 0)),
    buildMs: 1,
    transferBytes: 10,
    ...extra,
  });
}

describe("streamingClodRequiredPageCoords", () => {
  it("returns deterministic page coords around positive and negative centers", () => {
    const positive = streamingClodRequiredPageCoords(new THREE.Vector3(1500, 0, 300), 96, 64)
      .map((coord) => streamingClodPageKey(coord.px, coord.pz));
    const negative = streamingClodRequiredPageCoords(new THREE.Vector3(-150, 0, -300), 96, 64)
      .map((coord) => streamingClodPageKey(coord.px, coord.pz));

    expect(positive).toContain("L0:23,4");
    expect(negative).toContain("L0:-3,-5");
  });

  it("sorts closest pages first", () => {
    const coords = streamingClodRequiredPageCoords(new THREE.Vector3(128, 0, 128), 160, 64);
    const distances = coords.map((coord) => Math.hypot(128 - coord.centerX, 128 - coord.centerZ));

    expect(distances[0]).toBeLessThanOrEqual(distances.at(-1) ?? Number.POSITIVE_INFINITY);
  });

  it("includes requested L0 pages and their ancestors with real levels", () => {
    const coords = streamingClodRequiredPageCoords(new THREE.Vector3(272, 0, 16), 1, 32, 2);

    expect(coords.map((coord) => streamingClodPageKey(coord.px, coord.pz, coord.level))).toEqual([
      "L2:2,0",
      "L1:4,0",
      "L0:8,0",
    ]);
  });

  it("uses fewer safety pages when the streamed root level is coarser", () => {
    const center = new THREE.Vector3(0, 0, 0);
    const level1Safety = streamingClodRequiredPageCoords(center, 512, 32, 1)
      .filter((coord) => coord.level === 1);
    const level2Safety = streamingClodRequiredPageCoords(center, 512, 32, 2)
      .filter((coord) => coord.level === 2);

    expect(level2Safety.length).toBeGreaterThan(0);
    expect(level2Safety.length).toBeLessThan(level1Safety.length);
  });

  it("sorts budget candidates coarse-to-fine before distance within the same level", () => {
    const sorted = sortStreamingClodPageCoordsForLoad([
      { level: 0, px: 0, pz: 0, centerX: 0, centerZ: 0 },
      { level: 2, px: 8, pz: 0, centerX: 512, centerZ: 0 },
      { level: 1, px: 1, pz: 0, centerX: 32, centerZ: 0 },
      { level: 1, px: 0, pz: 0, centerX: 0, centerZ: 0 },
    ], new THREE.Vector3(0, 0, 0));

    expect(sorted.map((coord) => streamingClodPageKey(coord.px, coord.pz, coord.level))).toEqual([
      "L2:8,0",
      "L1:0,0",
      "L1:1,0",
      "L0:0,0",
    ]);
  });

  it("retains resident parents while required descendants are not ready", () => {
    const parent = streamingClodPageKey(0, 0, 2);
    const child = streamingClodPageKey(3, 2, 0);
    const sibling = streamingClodPageKey(5, 0, 0);
    const cached = new Set([parent]);

    expect(streamingClodPageHasRequiredNotReadyDescendant(parent, [child, sibling], cached)).toBe(true);
    cached.add(child);
    expect(streamingClodPageHasRequiredNotReadyDescendant(parent, [child, sibling], cached)).toBe(false);
  });
});

describe("pageInsideFiniteStartupWorld", () => {
  it("accepts only startup-world pages", () => {
    expect(pageInsideFiniteStartupWorld(0, 0, 16, 16)).toBe(true);
    expect(pageInsideFiniteStartupWorld(15, 15, 16, 16)).toBe(true);
    expect(pageInsideFiniteStartupWorld(16, 15, 16, 16)).toBe(false);
    expect(pageInsideFiniteStartupWorld(-1, 0, 16, 16)).toBe(false);
    expect(pageInsideFiniteStartupWorld(3, 3, 16, 16, 2)).toBe(true);
    expect(pageInsideFiniteStartupWorld(4, 3, 16, 16, 2)).toBe(false);
  });
});

describe("createStreamingClodRootController", () => {
  it("runs planner-only when buildPages is null", () => {
    const { controller, roots } = makeController({ buildPages: null });

    const stats = controller.update(new THREE.Vector3(192, 0, 0), 40);

    expect(stats.requiredPages).toBeGreaterThan(0);
    expect(stats.cachedPages).toBe(0);
    expect(stats.pendingPages).toBe(0);
    expect(stats.inflightBatches).toBe(0);
    expect(roots).toHaveLength(0);
  });

  it("dispatches a coarse-to-fine worker batch that respects build budget", () => {
    const { controller, buildPages } = makeController({
      buildBudgetPagesPerFrame: 2,
      cfg: { ...TEST_CFG, page: { ...TEST_CFG.page, quadtree_levels: 1 } },
    });

    const stats = controller.update(new THREE.Vector3(192, 0, 0), 80);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as readonly PageCoord[];

    expect(coords).toHaveLength(2);
    expect(stats.pendingPages).toBe(2);
    expect(stats.buildBudget).toBe(2);
    expect((coords[0]!.level ?? 0)).toBeGreaterThanOrEqual(coords[1]!.level ?? 0);
  });

  it("keeps only one worker batch in flight by default", () => {
    const { controller, buildPages } = makeController({ buildBudgetPagesPerFrame: 2 });

    controller.update(new THREE.Vector3(192, 0, 0), 80);
    const stats = controller.update(new THREE.Vector3(256, 0, 0), 80);

    expect(buildPages).toHaveBeenCalledTimes(1);
    expect(stats.inflightBatches).toBe(1);
  });

  it("can keep multiple streamed CLOD worker batches in flight", () => {
    const { controller, buildPages } = makeController({
      buildBudgetPagesPerFrame: 4,
      maxInflightBatches: 3,
    });

    const stats = controller.update(new THREE.Vector3(192, 0, 0), 80);

    expect(buildPages).toHaveBeenCalledTimes(3);
    expect(stats.inflightBatches).toBe(3);
    expect(stats.maxInflightBatches).toBe(3);
    expect(stats.pendingPages).toBe(3);
    for (const call of (buildPages as ReturnType<typeof vi.fn>).mock.calls) {
      const coords = call[0] as readonly PageCoord[];
      expect(coords).toHaveLength(1);
      expect(coords.every((coord) => coord.level === 1)).toBe(true);
    }
  });

  it("schedules only safety roots until parent coverage is complete", () => {
    const { controller, buildPages } = makeController({
      buildBudgetPagesPerFrame: 5,
      maxInflightBatches: 4,
    });

    const stats = controller.update(new THREE.Vector3(288, 0, 32), 30);

    expect(stats.safetyPendingPages + stats.safetyInflightPages).toBeGreaterThan(0);
    for (const call of (buildPages as ReturnType<typeof vi.fn>).mock.calls) {
      const coords = call[0] as readonly PageCoord[];
      expect(coords.every((coord) => coord.level === 1)).toBe(true);
    }
  });

  it("queues async worker results and applies them on the next frame", async () => {
    const { controller, roots, buildPages, requests } = makeController();
    controller.update(new THREE.Vector3(192, 0, 0), 40);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    resolveRequest(requests[0]!, coords);
    await flushAsync();
    expect(roots).toHaveLength(0);

    const stats = controller.update(new THREE.Vector3(192, 0, 0), 40);
    expect(roots).toHaveLength(1);
    expect(stats.cachedPages).toBe(1);
    expect(stats.applyPagesThisFrame).toBe(1);
    expect(stats.builtThisFrame).toBe(1);
    expect(controller.readyPageKeys()).toEqual([roots[0]!.id]);
  });

  it("keeps partial child coverage cached but inactive while the parent root covers the footprint", async () => {
    const { controller, roots, allNodes, buildPages, requests } = makeController({ buildBudgetPagesPerFrame: 2 });
    controller.update(new THREE.Vector3(272, 0, 16), 1);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    expect(coords.map((coord) => streamingClodPageKey(coord.px, coord.pz, coord.level))).toEqual([
      "L1:4,0",
    ]);

    resolveRequest(requests[0]!, coords);
    await flushAsync();
    controller.update(new THREE.Vector3(272, 0, 16), 1);
    const childCoords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[1]![0] as readonly PageCoord[];

    expect(childCoords.map((coord) => streamingClodPageKey(coord.px, coord.pz, coord.level))).toEqual([
      "L0:8,0",
    ]);

    resolveRequest(requests[1]!, childCoords);
    await flushAsync();
    controller.update(new THREE.Vector3(272, 0, 16), 1);

    expect(allNodes.map((node) => node.id)).toEqual(["L1:4,0", "L0:8,0"]);
    expect(roots.map((node) => node.id)).toEqual(["L1:4,0"]);
    expect(controller.readyPageKeys()).toEqual(["L1:4,0"]);
  });

  it("replaces a parent render root once finer cached descendants fully cover it", async () => {
    const { controller, roots, allNodes, buildPages, requests } = makeController({
      buildBudgetPagesPerFrame: 5,
      applyBudgetPagesPerFrame: 5,
    });
    controller.update(new THREE.Vector3(288, 0, 32), 30);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    expect(coords.map((coord) => streamingClodPageKey(coord.px, coord.pz, coord.level))).toEqual([
      "L1:4,0",
    ]);

    resolveRequest(requests[0]!, coords);
    await flushAsync();
    controller.update(new THREE.Vector3(288, 0, 32), 30);
    const childCoords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[1]![0] as readonly PageCoord[];

    expect(childCoords.map((coord) => streamingClodPageKey(coord.px, coord.pz, coord.level))).toEqual([
      "L0:8,0",
      "L0:8,1",
      "L0:9,0",
      "L0:9,1",
    ]);

    resolveRequest(requests[1]!, childCoords);
    await flushAsync();
    controller.update(new THREE.Vector3(288, 0, 32), 30);

    const activeKeys = ["L0:8,0", "L0:8,1", "L0:9,0", "L0:9,1"];
    expect(allNodes.map((node) => node.id)).toEqual(["L1:4,0", ...activeKeys]);
    expect(roots.map((node) => node.id)).toEqual(activeKeys);
    expect(controller.readyPageKeys()).toEqual(activeKeys);
  });

  it("retains resident parents while required descendants are still missing", async () => {
    const { controller, roots, buildPages, requests } = makeController({
      buildBudgetPagesPerFrame: 1,
      maxCachedPages: 1,
      evictDistanceMultiplier: 1,
    });
    const center = new THREE.Vector3(272, 0, 16);
    controller.update(center, 1);
    const parentCoords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];
    expect(parentCoords.map((coord) => streamingClodPageKey(coord.px, coord.pz, coord.level))).toEqual(["L1:4,0"]);
    resolveRequest(requests[0]!, parentCoords);
    await flushAsync();

    controller.update(center, 1);
    expect(roots.map((node) => node.id)).toEqual(["L1:4,0"]);

    const stats = controller.update(center, 1);
    expect(stats.evictions).toBe(0);
    expect(controller.readyPageKeys()).toEqual(["L1:4,0"]);
    expect(roots.map((node) => node.id)).toEqual(["L1:4,0"]);
  });

  it("evicts refinement before active safety coverage when cache is over capacity", async () => {
    const { controller, roots, allNodes, buildPages, requests } = makeController({
      buildBudgetPagesPerFrame: 1,
      applyBudgetPagesPerFrame: 8,
      maxCachedPages: 1,
      evictDistanceMultiplier: 1000,
    });
    const center = new THREE.Vector3(272, 0, 16);
    controller.update(center, 1);
    const parentCoords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];
    resolveRequest(requests[0]!, parentCoords);
    await flushAsync();

    controller.update(center, 1);
    expect(roots.map((node) => node.id)).toEqual(["L1:4,0"]);
    const childCoords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[1]![0] as readonly PageCoord[];
    expect(childCoords.map((coord) => streamingClodPageKey(coord.px, coord.pz, coord.level))).toEqual(["L0:8,0"]);
    resolveRequest(requests[1]!, childCoords);
    await flushAsync();

    const applied = controller.update(center, 1);
    expect(applied.cachedPages).toBe(2);

    const trimmed = controller.update(center, 1);
    expect(trimmed.evictions).toBe(1);
    expect(trimmed.cachedPages).toBe(1);
    expect(roots.map((node) => node.id)).toEqual(["L1:4,0"]);
    expect(allNodes.map((node) => node.id)).toEqual(["L1:4,0"]);
    expect(controller.readyPageKeys()).toEqual(["L1:4,0"]);
  });

  it("counts active parents as safety-ready while child refinement is still inflight", async () => {
    const { controller, buildPages, requests } = makeController({ buildBudgetPagesPerFrame: 2 });
    const center = new THREE.Vector3(272, 0, 16);
    controller.update(center, 1);
    const parentCoords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];
    resolveRequest(requests[0]!, parentCoords);
    await flushAsync();

    const stats = controller.update(center, 1);

    expect(stats.safetyRequiredPages).toBe(1);
    expect(stats.safetyReadyPages).toBe(1);
    expect(stats.safetyPendingPages).toBe(0);
    expect(stats.safetyInflightPages).toBe(0);
    expect(stats.parentCoverageViolations).toBe(0);
    expect(stats.refinementInflightPages).toBe(1);
    expect(stats.activeRootPages).toBe(1);
  });

  it("reports parent coverage violations when safety parents are missing", () => {
    const { controller } = makeController({ buildPages: null });

    const stats = controller.update(new THREE.Vector3(272, 0, 16), 1);

    expect(stats.safetyRequiredPages).toBe(1);
    expect(stats.safetyReadyPages).toBe(0);
    expect(stats.safetyPendingPages).toBe(1);
    expect(stats.parentCoverageViolations).toBe(1);
    expect(stats.activeRootPages).toBe(0);
  });

  it("reports when required safety coverage cannot fit the configured cache", () => {
    const { controller } = makeController({
      buildPages: null,
      maxCachedPages: 1,
    });

    const stats = controller.update(new THREE.Vector3(192, 0, 0), 80);

    expect(stats.safetyRequiredPages).toBeGreaterThan(1);
    expect(stats.maxCachedPages).toBe(1);
    expect(stats.safetyCacheCapacityOk).toBe(0);
  });

  it("reports real applied streamed pages as ready keys", async () => {
    const { controller, buildPages, requests } = makeController();
    controller.update(new THREE.Vector3(192, 0, 0), 40);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    resolveRequest(requests[0]!, coords);
    await flushAsync();
    controller.update(new THREE.Vector3(192, 0, 0), 40);

    expect(controller.readyPageKeys()).toEqual([
      streamingClodPageKey(coords[0]!.px, coords[0]!.pz, coords[0]!.level),
    ]);
  });

  it("throttles ready page application with an apply budget", async () => {
    const { controller, roots, buildPages, requests } = makeController({
      buildBudgetPagesPerFrame: 3,
      applyBudgetPagesPerFrame: 1,
      cfg: { ...TEST_CFG, page: { ...TEST_CFG.page, quadtree_levels: 1 } },
    });
    controller.update(new THREE.Vector3(192, 0, 0), 80);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    resolveRequest(requests[0]!, coords);
    await flushAsync();

    const firstApply = controller.update(new THREE.Vector3(192, 0, 0), 80);
    expect(roots).toHaveLength(1);
    expect(firstApply.readyPages).toBe(1);
    expect(firstApply.activeRootPages).toBe(1);
    expect(firstApply.applyQueuePages).toBe(2);
    expect(firstApply.applyPagesThisFrame).toBe(1);

    const secondApply = controller.update(new THREE.Vector3(192, 0, 0), 80);
    expect(roots).toHaveLength(2);
    expect(secondApply.applyPagesThisFrame).toBe(1);
  });

  it("keeps a page queued until its render preparation is complete", async () => {
    let prepared = false;
    const onNodesBuilt = vi.fn();
    const prepareNodeForApply = vi.fn((_node: ClodPageNode, deadlineMs: number) => {
      expect(Number.isFinite(deadlineMs)).toBe(true);
      return prepared;
    });
    const { controller, roots, buildPages, requests } = makeController({
      prepareNodeForApply,
      prepareNodeBudgetMs: 3,
      onNodesBuilt,
    });
    const center = new THREE.Vector3(192, 0, 0);
    controller.update(center, 40);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];
    resolveRequest(requests[0]!, coords);
    await flushAsync();

    const deferredApply = controller.update(center, 40);
    expect(deferredApply.applyPagesThisFrame).toBe(0);
    expect(deferredApply.applyQueuePages).toBe(1);
    expect(roots).toHaveLength(0);
    expect(onNodesBuilt).not.toHaveBeenCalled();

    prepared = true;
    const completedApply = controller.update(center, 40);
    expect(completedApply.applyPagesThisFrame).toBe(1);
    expect(completedApply.applyQueuePages).toBe(0);
    expect(roots).toHaveLength(1);
    expect(onNodesBuilt).toHaveBeenCalledTimes(1);
  });

  it("keeps resident ready roots nonzero after the apply queue drains", async () => {
    const { controller, roots, buildPages, requests } = makeController();
    controller.update(new THREE.Vector3(192, 0, 0), 40);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    resolveRequest(requests[0]!, coords);
    await flushAsync();
    const applied = controller.update(new THREE.Vector3(192, 0, 0), 40);
    const settled = controller.update(new THREE.Vector3(192, 0, 0), 40);

    expect(roots).toHaveLength(1);
    expect(applied.applyQueuePages).toBe(0);
    expect(settled.applyQueuePages).toBe(0);
    expect(settled.readyPages).toBeGreaterThan(0);
    expect(settled.activeRootPages).toBe(settled.readyPages);
    expect(controller.readyPageKeys()).toHaveLength(settled.readyPages);
  });

  it("discards stale ready pages after the stream center moves", async () => {
    const { controller, roots, buildPages, requests } = makeController();
    controller.update(new THREE.Vector3(192, 0, 0), 40);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    resolveRequest(requests[0]!, coords);
    await flushAsync();
    const stats = controller.update(new THREE.Vector3(512, 0, 0), 40);

    expect(roots).toHaveLength(0);
    expect(stats.staleDiscards).toBe(1);
    expect(stats.cachedPages).toBe(0);
  });

  it("evicts cached pages from roots and allNodes deterministically", async () => {
    const { controller, roots, allNodes, buildPages, requests } = makeController({ maxCachedPages: 4 });
    controller.update(new THREE.Vector3(192, 0, 0), 40);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];
    resolveRequest(requests[0]!, coords);
    await flushAsync();
    controller.update(new THREE.Vector3(192, 0, 0), 40);

    const stats = controller.update(new THREE.Vector3(1024, 0, 0), 1);

    expect(stats.evictions).toBe(1);
    expect(roots).toHaveLength(0);
    expect(allNodes).toHaveLength(0);
    expect(stats.cachedPages).toBe(0);
  });

  it("marks worker rejections as failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { controller, requests } = makeController();
    controller.update(new THREE.Vector3(192, 0, 0), 40);

    requests[0]!.reject(new Error("worker failed"));
    await flushAsync();
    const stats = controller.update(new THREE.Vector3(192, 0, 0), 40);

    expect(stats.failedPages).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("accumulates worker build time and transfer bytes separately from apply time", async () => {
    const { controller, buildPages, requests } = makeController();
    controller.update(new THREE.Vector3(192, 0, 0), 40);
    const coords = (buildPages as ReturnType<typeof vi.fn>).mock.calls[0]![0] as readonly PageCoord[];

    resolveRequest(requests[0]!, coords, { buildMs: 12, transferBytes: 345 });
    await flushAsync();
    const stats = controller.update(new THREE.Vector3(192, 0, 0), 40);

    expect(stats.workerBuildMs).toBe(12);
    expect(stats.buildMs).toBe(12);
    expect(stats.workerTransferBytes).toBe(345);
    expect(stats.applyMs).toBeGreaterThanOrEqual(0);
  });

  it("does not retain the old synchronous builder path", () => {
    const source = readFileSync(new URL("./clod_streaming_roots.ts", import.meta.url), "utf8");

    expect(source).not.toContain("buildLod0PageSource");
    expect(source).not.toContain("defaultBuildScheduler");
    expect(source).not.toContain("buildNode");
    expect(source).not.toContain("scheduleBuild?:");
  });

  it("pageBudgetCost returns 4^level", () => {
    expect(pageBudgetCost(0)).toBe(1);
    expect(pageBudgetCost(1)).toBe(4);
    expect(pageBudgetCost(2)).toBe(16);
    expect(pageBudgetCost(3)).toBe(64);
  });

  it("weighted budget caps batch by LOD0-equivalent cost, not page count", () => {
    const { controller, buildPages } = makeController({ buildBudgetPagesPerFrame: 2 });
    const center = new THREE.Vector3(272, 0, 16);
    const stats = controller.update(center, 1);
    const mock = buildPages as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    const coords = mock.mock.calls[0]![0] as readonly PageCoord[];
    expect(coords).toHaveLength(1);
    expect(coords[0]!.level).toBe(1);
    expect(stats.scheduledBudgetCost).toBe(4);
  });

  it("weighted budget dispatches multiple L0 pages up to budget", () => {
    const { controller, buildPages } = makeController({
      buildBudgetPagesPerFrame: 4,
      cfg: { ...TEST_CFG, page: { ...TEST_CFG.page, quadtree_levels: 1 } },
    });
    const center = new THREE.Vector3(128, 0, 128);
    const stats = controller.update(center, 40);
    const mock = buildPages as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(1);
    const coords = mock.mock.calls[0]![0] as readonly PageCoord[];
    expect(coords.length).toBeGreaterThan(1);
    expect(coords.every(c => c.level === 0 || c.level === undefined)).toBe(true);
    expect(stats.scheduledBudgetCost).toBeLessThanOrEqual(4);
  });

  it("reports inflightMs and inflightPageLevels in stats", async () => {
    const { controller } = makeController({
      cfg: { ...TEST_CFG, page: { ...TEST_CFG.page, quadtree_levels: 1 } },
    });
    const statsBefore = controller.update(new THREE.Vector3(192, 0, 0), 40);
    expect(statsBefore.inflightBatches).toBe(1);
    expect(statsBefore.inflightMs).toBeGreaterThanOrEqual(0);
    expect(statsBefore.inflightPageLevels).toEqual([0]);
  });
});
