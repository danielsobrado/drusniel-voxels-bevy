import { describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../config.js";
import {
  ALLOWED_PAGE_SOURCE_SECTIONS,
  assertPageSourceTerrainOnly,
  buildLod0PageSource,
  expandChunkNeighborRing,
  validatePageSourcePurity,
  type PageSourceSection,
} from "./source_mesh.js";
import type { PageMesh } from "../types.js";

function makeConfig(): ClodPagesConfig {
  return {
    page: { chunks_per_page: 1, chunk_size: 8, halo_chunks: 1, quadtree_levels: 1 },
    simplify: {
      target_ratio_per_level: 0.5,
      abandon_ratio: 0.99,
      target_error: 0.01,
      weld_epsilon_cells: 0.001,
      attribute_weights: { normal: 1, material: 0.25 },
    },
    polish: { diagonal_flip: { ...DEFAULT_DIAGONAL_FLIP_CONFIG, enabled: false } },
    selection: {
      error_threshold_px: 4,
      hysteresis_merge_factor: 1.5,
      neighbor_level_delta_max: 1,
      transition_mode: "instant",
      crossfade_frames: 0,
      freeze_selection: false,
    },
    near_field: { enabled: true, radius_chunks: 1, show_mask: true },
    debug: {
      show_wireframe: true, show_page_boundaries: true, show_locked_border_vertices: false,
      show_error_labels: true, show_stats_panel: true,
      lod_colors: { lod0: "#3b82f6", lod1: "#22c55e", lod2: "#f59e0b", lod3: "#ef4444" },
    },
    stress: { active_scene: "ridge_border" },
    meshopt_package_version: "0.22.0",
    poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: false, emit_debug_obj: false },
    validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
  };
}

const emptyMesh: PageMesh = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
  normals: new Float32Array(9),
  paintSlots: new Float32Array(3),
  materialWeights: new Float32Array(12),
  materialWeightStride: 4,
  indices: new Uint32Array([0, 1, 2]),
};

describe("page source purity", () => {
  it("allows only terrain_main sections", () => {
    expect(ALLOWED_PAGE_SOURCE_SECTIONS.has("terrain_main")).toBe(true);
    expect(ALLOWED_PAGE_SOURCE_SECTIONS.has("water")).toBe(false);
  });

  it("rejects forbidden sections before weld", () => {
    const report = validatePageSourcePurity([emptyMesh], ["water" as PageSourceSection]);
    expect(report.excludedTriangles).toBe(1);
    expect(() => assertPageSourceTerrainOnly(report)).toThrow(/ForbiddenPageSourceSection/);
  });

  it("buildLod0PageSource stays terrain-only", () => {
    const page = buildLod0PageSource(0, 0, makeConfig(), { cellsX: 8, cellsZ: 8 });
    expect(page.mesh.indices.length).toBeGreaterThan(0);
  });

  it("expandChunkNeighborRing includes the 3x3 neighborhood", () => {
    expect(expandChunkNeighborRing([5], 4).sort((a, b) => a - b)).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10]);
  });
});
