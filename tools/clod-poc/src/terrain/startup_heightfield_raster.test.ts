import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../config.js";
import { baseSurfaceHeight, meshChunk, setTerrainSurfaceOverride } from "./terrain.js";
import {
  STARTUP_HEIGHTFIELD_DEFAULT_MAX_BYTES,
  STARTUP_HEIGHTFIELD_PADDING_CELLS,
  STARTUP_HEIGHTFIELD_SAMPLING_MODE,
  buildStartupHeightfieldRaster,
  makeStartupHeightfieldSampler,
  planStartupHeightfieldRaster,
  startupHeightfieldDescriptor,
  type StartupHeightfieldRaster,
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

function requireRaster(worldCells = WORLD_CELLS): StartupHeightfieldRaster {
  const raster = buildStartupHeightfieldRaster(worldCells);
  expect(raster).not.toBeNull();
  return raster!;
}

describe("startup heightfield raster", () => {
  afterEach(() => setTerrainSurfaceOverride(null));

  it("covers the startup world plus padding within the configured budget", () => {
    const raster = requireRaster();
    expect(raster.minCell).toBe(-STARTUP_HEIGHTFIELD_PADDING_CELLS);
    expect(raster.res).toBe(WORLD_CELLS + STARTUP_HEIGHTFIELD_PADDING_CELLS * 2 + 1);
    expect(raster.heights.length).toBe(raster.res * raster.res);
    expect(raster.sampleCount).toBe(raster.heights.length);
    expect(raster.byteLength).toBe(raster.heights.byteLength);
    expect(raster.samplingMode).toBe(STARTUP_HEIGHTFIELD_SAMPLING_MODE);
  });

  it("is bit-identical to the procedural field at integer lattice coordinates", () => {
    const sampler = makeStartupHeightfieldSampler(requireRaster());
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

  it("bypasses the raster for fractional coordinates", () => {
    const sampler = makeStartupHeightfieldSampler(requireRaster());
    for (const [x, z] of [
      [4.25, 9.6],
      [0.5, 0],
      [WORLD_CELLS - 0.25, WORLD_CELLS + 0.5],
      [-1.5, 3.75],
    ] as const) {
      expect(sampler(x, z)).toBe(baseSurfaceHeight(x, z));
    }
  });

  it("falls back to the procedural field outside the padded domain", () => {
    const sampler = makeStartupHeightfieldSampler(requireRaster());
    for (const [x, z] of [
      [WORLD_CELLS + STARTUP_HEIGHTFIELD_PADDING_CELLS + 1, 10],
      [-STARTUP_HEIGHTFIELD_PADDING_CELLS - 1, 4],
      [1300.4, -250.7],
    ] as const) {
      expect(sampler(x, z)).toBe(baseSurfaceHeight(x, z));
    }
  });

  it("keeps meshed positions, normals, indices, and weights identical to direct procedural meshing", () => {
    const world = { cellsX: WORLD_CELLS, cellsZ: WORLD_CELLS };
    const direct = meshChunk(0, 0, TEST_CFG, world);
    expect(direct.positions.length).toBeGreaterThan(0);

    setTerrainSurfaceOverride(makeStartupHeightfieldSampler(requireRaster()));
    const rastered = meshChunk(0, 0, TEST_CFG, world);

    expect(rastered.positions).toEqual(direct.positions);
    expect(rastered.normals).toEqual(direct.normals);
    expect(rastered.indices).toEqual(direct.indices);
    expect(rastered.materialWeights).toEqual(direct.materialWeights);
  });

  it("rejects rasters above the default memory budget", () => {
    const plan = planStartupHeightfieldRaster(2048);
    expect(plan.byteLength).toBeGreaterThan(STARTUP_HEIGHTFIELD_DEFAULT_MAX_BYTES);
    expect(plan.enabled).toBe(false);
    expect(plan.reason).toBe("sample_budget");
    expect(buildStartupHeightfieldRaster(2048)).toBeNull();
  });

  it("supports explicit smaller budgets for deterministic gating", () => {
    const plan = planStartupHeightfieldRaster(WORLD_CELLS, { maxSamples: 100 });
    expect(plan.enabled).toBe(false);
    expect(plan.reason).toBe("sample_budget");
    expect(buildStartupHeightfieldRaster(WORLD_CELLS, baseSurfaceHeight, { maxSamples: 100 })).toBeNull();
  });

  it("exposes a plain descriptor for cache identity", () => {
    expect(startupHeightfieldDescriptor(null)).toBeNull();
    const raster = requireRaster();
    expect(startupHeightfieldDescriptor(raster)).toEqual({
      worldCells: WORLD_CELLS,
      minCell: -STARTUP_HEIGHTFIELD_PADDING_CELLS,
      res: raster.res,
      sampleCount: raster.sampleCount,
      byteLength: raster.byteLength,
      samplingMode: STARTUP_HEIGHTFIELD_SAMPLING_MODE,
    });
  });
});
