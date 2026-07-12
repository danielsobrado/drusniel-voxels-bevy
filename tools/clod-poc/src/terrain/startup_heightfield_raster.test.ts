import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../config.js";
import { baseSurfaceHeight, meshChunk, setTerrainSurfaceOverride } from "./terrain.js";
import {
  STARTUP_HEIGHTFIELD_PADDING_CELLS,
  buildStartupHeightfieldRaster,
  makeStartupHeightfieldSampler,
  startupHeightfieldDescriptor,
} from "./startup_heightfield_raster.js";

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

const WORLD_CELLS = 32;

describe("startup heightfield raster", () => {
  afterEach(() => setTerrainSurfaceOverride(null));

  it("covers the startup world plus padding", () => {
    const raster = buildStartupHeightfieldRaster(WORLD_CELLS);
    expect(raster.minCell).toBe(-STARTUP_HEIGHTFIELD_PADDING_CELLS);
    expect(raster.res).toBe(WORLD_CELLS + STARTUP_HEIGHTFIELD_PADDING_CELLS * 2 + 1);
    expect(raster.heights.length).toBe(raster.res * raster.res);
  });

  it("is bit-identical to the procedural field at integer lattice coordinates", () => {
    const raster = buildStartupHeightfieldRaster(WORLD_CELLS);
    const sampler = makeStartupHeightfieldSampler(raster);
    for (const [x, z] of [
      [-STARTUP_HEIGHTFIELD_PADDING_CELLS, -STARTUP_HEIGHTFIELD_PADDING_CELLS],
      [0, 0],
      [7, 21],
      [WORLD_CELLS, WORLD_CELLS],
      [WORLD_CELLS + STARTUP_HEIGHTFIELD_PADDING_CELLS, 3],
    ] as const) {
      expect(sampler(x, z)).toBe(baseSurfaceHeight(x, z));
    }
  });

  it("reconstructs fractional coordinates bilinearly from lattice samples", () => {
    const raster = buildStartupHeightfieldRaster(WORLD_CELLS);
    const sampler = makeStartupHeightfieldSampler(raster);
    const manual =
      (baseSurfaceHeight(4, 9) * 0.75 + baseSurfaceHeight(5, 9) * 0.25) * 0.4 +
      (baseSurfaceHeight(4, 10) * 0.75 + baseSurfaceHeight(5, 10) * 0.25) * 0.6;
    expect(sampler(4.25, 9.6)).toBeCloseTo(manual, 12);
  });

  it("falls back to the procedural field outside the padded domain", () => {
    const raster = buildStartupHeightfieldRaster(WORLD_CELLS);
    const sampler = makeStartupHeightfieldSampler(raster);
    for (const [x, z] of [
      [WORLD_CELLS + STARTUP_HEIGHTFIELD_PADDING_CELLS + 0.5, 10],
      [-STARTUP_HEIGHTFIELD_PADDING_CELLS - 1, 4],
      [1300.4, -250.7],
    ] as const) {
      expect(sampler(x, z)).toBe(baseSurfaceHeight(x, z));
    }
  });

  it("keeps meshed vertex positions bit-identical to direct procedural meshing", () => {
    const world = { cellsX: WORLD_CELLS, cellsZ: WORLD_CELLS };
    const direct = meshChunk(0, 0, TEST_CFG, world);
    expect(direct.positions.length).toBeGreaterThan(0);

    const raster = buildStartupHeightfieldRaster(WORLD_CELLS);
    setTerrainSurfaceOverride(makeStartupHeightfieldSampler(raster));
    const rastered = meshChunk(0, 0, TEST_CFG, world);

    expect(rastered.positions).toEqual(direct.positions);
    expect(rastered.indices).toEqual(direct.indices);

    // Normals sample the field at fractional ±0.5 offsets, so they see the bilinear
    // reconstruction instead of the true field; require them to stay close.
    expect(rastered.normals.length).toBe(direct.normals.length);
    for (let i = 0; i < direct.normals.length; i += 3) {
      const dot = rastered.normals[i]! * direct.normals[i]!
        + rastered.normals[i + 1]! * direct.normals[i + 1]!
        + rastered.normals[i + 2]! * direct.normals[i + 2]!;
      expect(dot).toBeGreaterThan(0.95);
    }
  });

  it("exposes a plain descriptor for cache identity", () => {
    expect(startupHeightfieldDescriptor(null)).toBeNull();
    const raster = buildStartupHeightfieldRaster(WORLD_CELLS);
    expect(startupHeightfieldDescriptor(raster)).toEqual({
      worldCells: WORLD_CELLS,
      minCell: -STARTUP_HEIGHTFIELD_PADDING_CELLS,
      res: raster.res,
    });
  });
});
