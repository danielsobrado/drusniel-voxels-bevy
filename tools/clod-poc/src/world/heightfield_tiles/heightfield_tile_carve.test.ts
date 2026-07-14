import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../../config.js";
import { createGraphHydrologySampler } from "../../water/graph_hydrology.js";
import { buildHydrologyGraph } from "../hydrology_graph/hydrology_graph_builder.js";
import { HEIGHTFIELD_TILE_RES } from "./heightfield_tile.js";
import { buildCarvedHeightfieldTile } from "./heightfield_tile_carve.js";
import { buildStartupHeightfieldRaster } from "../../terrain/startup_heightfield_raster.js";
import { HeightfieldTileCache } from "./heightfield_tile_cache.js";
import { heightfieldTileSampler } from "./heightfield_tile_sampler.js";
import { proceduralHeightfieldSampler } from "../heightfield_sampler.js";
import type { HeightfieldTileConfig } from "./heightfield_tile_config.js";
import { meshChunk, setTerrainSurfaceOverride, setVoxelOverlaySource } from "../../terrain/terrain.js";

const CACHE_CONFIG: HeightfieldTileConfig = {
  enabled: true, radiusM: 0, maxResidentTiles: 1, maxInflightBatches: 1, maxTilesPerBatch: 1,
  evictDistanceMultiplier: 1, retryCooldownFrames: 1, predictionSeconds: 0, persistenceEnabled: false,
};
const MESH_CONFIG: ClodPagesConfig = {
  page: { chunks_per_page: 1, chunk_size: 16, halo_chunks: 1, quadtree_levels: 1 },
  simplify: { target_ratio_per_level: 0.5, abandon_ratio: 0.85, target_error: 0.01, weld_epsilon_cells: 0.001, attribute_weights: { normal: 0.5, material: 1 } },
  polish: { diagonal_flip: DEFAULT_DIAGONAL_FLIP_CONFIG },
  selection: { error_threshold_px: 1, hysteresis_merge_factor: 1.5, neighbor_level_delta_max: 1, transition_mode: "instant", crossfade_frames: 0, freeze_selection: false },
  near_field: { enabled: true, radius_chunks: 6, show_mask: false },
  debug: { show_wireframe: false, show_page_boundaries: false, show_locked_border_vertices: false, show_error_labels: false, show_stats_panel: false, lod_colors: { lod0: "#000", lod1: "#111", lod2: "#222", lod3: "#333" } },
  stress: { active_scene: "ridge_border" }, meshopt_package_version: "0.22.0",
  poc: { lod0_pages_x: 1, lod0_pages_z: 1, smoke_lod0_pages_x: 1, smoke_lod0_pages_z: 1, emit_debug_json: false, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.997, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

afterEach(() => {
  setTerrainSurfaceOverride(null);
  setVoxelOverlaySource(null);
});

describe("carved heightfield tiles", () => {
  it("carves graph water features deterministically with exact shared borders", () => {
    const terrain = { surfaceHeight: (_x: number, z: number) => 100 - z * 0.02 };
    const graph = buildHydrologyGraph({
      worldId: "tile-carve", seed: 3, sizeM: { x: 512, z: 512 }, sampleHeight: terrain.surfaceHeight,
      config: { spacingM: 16, channelThresholdCells: 4 },
    });
    const hydrology = createGraphHydrologySampler(graph, terrain);
    const carve = { depthM: 7.5, power: 1.35, lakeBedDepthM: 3.3 };
    const left = buildCarvedHeightfieldTile({ x: 0, z: 0 }, { sampleHeight: terrain.surfaceHeight }, hydrology, carve, 1);
    const again = buildCarvedHeightfieldTile({ x: 0, z: 0 }, { sampleHeight: terrain.surfaceHeight }, hydrology, carve, 1);
    const right = buildCarvedHeightfieldTile({ x: 1, z: 0 }, { sampleHeight: terrain.surfaceHeight }, hydrology, carve, 1);

    expect(left.heights).toEqual(again.heights);
    let carvedSamples = 0;
    for (let index = 0; index < left.heights.length; index++) {
      const x = index % HEIGHTFIELD_TILE_RES;
      const z = (index - x) / HEIGHTFIELD_TILE_RES;
      if (left.heights[index]! < terrain.surfaceHeight(x, z) - 0.01) carvedSamples++;
    }
    expect(carvedSamples).toBeGreaterThan(0);
    for (let z = 0; z < HEIGHTFIELD_TILE_RES; z++) {
      expect(left.heights[z * HEIGHTFIELD_TILE_RES + HEIGHTFIELD_TILE_RES - 1])
        .toBe(right.heights[z * HEIGHTFIELD_TILE_RES]);
    }
    expect(left.heights).toBeInstanceOf(Float32Array);

    const raster = buildStartupHeightfieldRaster(256, (x, z) =>
      Math.fround(hydrology.carveHeight(x, z, terrain.surfaceHeight(x, z), carve)))!;
    for (const [x, z] of [[0, 0], [64, 91], [128, 128], [255, 255], [256, 256]]) {
      const rasterHeight = raster.heights[(z - raster.minCell) * raster.res + (x - raster.minCell)]!;
      expect(rasterHeight).toBe(left.heights[z * HEIGHTFIELD_TILE_RES + x]);
    }
  });

  it("makes integer mesh and fractional collider/prop samples read the carved tile authority", async () => {
    const terrain = { surfaceHeight: (_x: number, z: number) => 80 - z * 0.03 };
    const graph = buildHydrologyGraph({
      worldId: "cpu-authority", seed: 4, sizeM: { x: 256, z: 256 }, sampleHeight: terrain.surfaceHeight,
      config: { spacingM: 16, channelThresholdCells: 3 },
    });
    const hydrology = createGraphHydrologySampler(graph, terrain);
    const carve = { depthM: 7.5, power: 1.35, lakeBedDepthM: 3.3 };
    const cache = new HeightfieldTileCache(CACHE_CONFIG, 1, async (keys, revision) => ({
      tiles: keys.map((key) => buildCarvedHeightfieldTile(key, { sampleHeight: terrain.surfaceHeight }, hydrology, carve, revision)),
      buildMs: 1,
    }));
    cache.update({ x: 128, z: 128, frameIndex: 1 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const sampler = heightfieldTileSampler(cache, { ...proceduralHeightfieldSampler(), sampleHeight: terrain.surfaceHeight });
    for (const [x, z] of [[32, 32], [128, 128], [200, 220]]) {
      expect(sampler.sampleHeight(x, z)).toBe(Math.fround(hydrology.carveHeight(x, z, terrain.surfaceHeight(x, z), carve)));
    }
    const x = 128.25;
    const z = 128.75;
    const corner = (cx: number, cz: number) => Math.fround(hydrology.carveHeight(cx, cz, terrain.surfaceHeight(cx, cz), carve));
    const a = corner(128, 128) * 0.75 + corner(129, 128) * 0.25;
    const b = corner(128, 129) * 0.75 + corner(129, 129) * 0.25;
    expect(sampler.sampleHeight(x, z)).toBeCloseTo(a * 0.25 + b * 0.75, 6);
  });

  it("keeps bubble meshes bit-equal when empty voxel composition reads the carved route", async () => {
    const terrain = { surfaceHeight: (_x: number, z: number) => 80 - z * 0.03 };
    const graph = buildHydrologyGraph({
      worldId: "bubble-parity", seed: 4, sizeM: { x: 256, z: 256 }, sampleHeight: terrain.surfaceHeight,
      config: { spacingM: 16, channelThresholdCells: 3 },
    });
    const hydrology = createGraphHydrologySampler(graph, terrain);
    const carve = { depthM: 7.5, power: 1.35, lakeBedDepthM: 3.3 };
    const cache = new HeightfieldTileCache(CACHE_CONFIG, 1, async (keys, revision) => ({
      tiles: keys.map((key) => buildCarvedHeightfieldTile(key, { sampleHeight: terrain.surfaceHeight }, hydrology, carve, revision)),
      buildMs: 1,
    }));
    cache.update({ x: 8, z: 8, frameIndex: 1 });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const tileSampler = heightfieldTileSampler(cache, { ...proceduralHeightfieldSampler(), sampleHeight: terrain.surfaceHeight });
    setTerrainSurfaceOverride((x, z) => tileSampler.sampleHeight(x, z));
    setVoxelOverlaySource(null);
    const direct = meshChunk(0, 0, MESH_CONFIG, { cellsX: 16, cellsZ: 16, finite: false });
    setVoxelOverlaySource({ regions: [] });
    const tiled = meshChunk(0, 0, MESH_CONFIG, { cellsX: 16, cellsZ: 16, finite: false });

    expect(tiled.positions).toEqual(direct.positions);
    expect(tiled.normals).toEqual(direct.normals);
    expect(tiled.indices).toEqual(direct.indices);
  });
});
