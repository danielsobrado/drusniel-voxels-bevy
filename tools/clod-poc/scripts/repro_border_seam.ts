import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../src/config.ts";
import {
  setBorderCoastRuntime,
  setTerrainSurfaceOverride,
  surfaceHeight,
  meshChunk,
} from "../src/terrain/terrain.ts";
import { buildLod0PageSource } from "../src/clod/source_mesh.ts";
import { parseBorderCoastOceanConfig } from "../src/terrain/border_coast_config.ts";
import { sampleCoastType } from "../src/terrain/border_coast.ts";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";

const cfg: ClodPagesConfig = {
  page: { chunks_per_page: 4, chunk_size: 16, halo_chunks: 1, quadtree_levels: 4 },
  simplify: {
    target_ratio_per_level: 0.5,
    abandon_ratio: 0.85,
    target_error: 0.01,
    weld_epsilon_cells: 0.001,
    attribute_weights: { normal: 0.5, material: 1.0 },
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
    show_wireframe: true, show_page_boundaries: true, show_locked_border_vertices: false,
    show_error_labels: true, show_stats_panel: true,
    lod_colors: { lod0: "#3b82f6", lod1: "#22c55e", lod2: "#f59e0b", lod3: "#ef4444" },
  },
  stress: { active_scene: "ridge_border" },
  meshopt_package_version: "0.22.0",
  poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: true, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

const borderCoastYaml = readFileSync(new URL("../config/border_coast_ocean.yaml", import.meta.url), "utf8");
const borderCoast = parseBorderCoastOceanConfig(borderCoastYaml);
const WORLD = 16;
const worldCells = WORLD * cfg.page.chunks_per_page * cfg.page.chunk_size;
setBorderCoastRuntime(borderCoast, worldCells);
setTerrainSurfaceOverride(null);
const world = { cellsX: worldCells, cellsZ: worldCells };

const zBand = 198;
for (const x of [78, 79, 80, 81]) {
  console.log(`band edge surfaceHeight(${x}, ${zBand}) = ${surfaceHeight(x, zBand).toFixed(4)}`);
}

for (const x of [30, 31, 31.5, 32, 32.5, 33]) {
  console.log(`surfaceHeight(${x}, ${zBand}) = ${surfaceHeight(x, zBand).toFixed(4)}`);
}
const jump = Math.abs(surfaceHeight(32, zBand) - surfaceHeight(31, zBand));
console.log("jump@31-32", jump.toFixed(4), jump < 2 ? "OK" : "BAD");
console.log("type@31", sampleCoastType(31, zBand, borderCoast.coast));
console.log("type@32", sampleCoastType(32, zBand, borderCoast.coast));

const px = 0;
const pz = 3;
const seamX = 32;
const c1 = meshChunk(px * 4 + 1, pz * 4 + 2, cfg, world);
const c2 = meshChunk(px * 4 + 2, pz * 4 + 2, cfg, world);
const near = (mesh: typeof c1, label: string) => {
  const out: number[][] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const zz = mesh.positions[i + 2];
    if (Math.abs(x - seamX) < 0.6 && Math.abs(zz - zBand) < 2) {
      out.push([x, mesh.positions[i + 1], zz]);
    }
  }
  console.log(label, out.length, "verts", out.slice(0, 3).map((p) => p.map((v) => v.toFixed(3)).join(",")));
  return out;
};
const a = near(c1, "chunk1");
const b = near(c2, "chunk2");
let worst = 0;
for (const va of a) {
  for (const vb of b) {
    worst = Math.max(worst, Math.hypot(va[0] - vb[0], va[1] - vb[1], va[2] - vb[2]));
  }
}
console.log("worst chunk seam delta", worst, "eps", cfg.simplify.weld_epsilon_cells);

for (const [px, pz] of [[0, 3], [0, 2], [0, 1], [0, 0]]) {
  try {
    const t0 = performance.now();
    buildLod0PageSource(px, pz, cfg, world);
    console.log(`L0:${px},${pz} OK ${(performance.now() - t0).toFixed(0)}ms`);
  } catch (e) {
    const err = e as Error & { code?: string };
    console.error(`L0:${px},${pz} FAIL`, err.code, err.message);
  }
}
