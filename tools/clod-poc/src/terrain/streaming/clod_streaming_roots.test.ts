import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { ClodPagesConfig } from "../../config.js";
import { DEFAULT_DIAGONAL_FLIP_CONFIG } from "../../config.js";
import type { ClodPageNode } from "../../types.js";
import {
  createStreamingClodRootController,
  pageInsideFiniteStartupWorld,
  streamingClodPageKey,
  streamingClodRequiredPageCoords,
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
});

describe("pageInsideFiniteStartupWorld", () => {
  it("accepts only startup-world pages", () => {
    expect(pageInsideFiniteStartupWorld(0, 0, 16, 16)).toBe(true);
    expect(pageInsideFiniteStartupWorld(15, 15, 16, 16)).toBe(true);
    expect(pageInsideFiniteStartupWorld(16, 15, 16, 16)).toBe(false);
    expect(pageInsideFiniteStartupWorld(-1, 0, 16, 16)).toBe(false);
  });
});

describe("createStreamingClodRootController", () => {
  it("signals root changes after streamed builds and evictions", () => {
    const roots: ClodPageNode[] = [];
    const allNodes: ClodPageNode[] = [];
    const onRootsChanged = vi.fn();
    const controller = createStreamingClodRootController({
      roots,
      allNodes,
      cfg: TEST_CFG,
      worldCells: 64,
      enabled: true,
      buildBudgetPagesPerFrame: 1,
      maxCachedPages: 4,
      evictDistanceMultiplier: 1,
      onRootsChanged,
    });

    controller.update(new THREE.Vector3(192, 0, 0), 40);
    controller.update(new THREE.Vector3(512, 0, 0), 40);

    expect(onRootsChanged).toHaveBeenCalled();
    expect(roots.length).toBeGreaterThan(0);
  });
});
