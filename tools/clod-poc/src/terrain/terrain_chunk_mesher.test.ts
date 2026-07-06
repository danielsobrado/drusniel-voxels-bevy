import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../config.js";
import { buildLod0PageSource } from "../clod/source_mesh.js";
import { assertNoInternalBorders } from "../clod/validate.js";
import { setTerrainSurfaceOverride } from "./terrain.js";

const TEST_CFG: ClodPagesConfig = {
  page: { chunks_per_page: 1, chunk_size: 16, halo_chunks: 1, quadtree_levels: 1 },
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
  poc: { lod0_pages_x: 1, lod0_pages_z: 1, smoke_lod0_pages_x: 1, smoke_lod0_pages_z: 1, emit_debug_json: false, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.997, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

describe("meshChunk vertical scan bounds", () => {
  afterEach(() => setTerrainSurfaceOverride(null));

  it("keeps below-sea-level interior terrain connected instead of clipping an open basin", () => {
    setTerrainSurfaceOverride((x, z) => (x >= 6 && x <= 10 && z >= 6 && z <= 10 ? -1 : 2));

    const source = buildLod0PageSource(0, 0, TEST_CFG, { cellsX: 16, cellsZ: 16, finite: false });

    expect(source.mesh.indices.length).toBeGreaterThan(0);
    expect(() => assertNoInternalBorders(source.mesh, source.footprint, "L0:0,0")).not.toThrow();
  });
});
