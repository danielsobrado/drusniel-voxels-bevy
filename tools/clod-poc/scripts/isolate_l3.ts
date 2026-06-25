import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../src/config.ts";
import { setBorderCoastRuntime, setTerrainSurfaceOverride } from "../src/terrain/terrain.ts";
import { buildWorld } from "../src/clod/quadtree.ts";
import { initSimplifier } from "../src/clod/simplify.ts";
import { parseBorderCoastOceanConfig } from "../src/terrain/border_coast_config.ts";
import { concat } from "../src/clod/source_mesh.ts";
import { weldVertices } from "../src/clod/weld.ts";
import { buildOuterBorderLocks } from "../src/lock.ts";
import { simplifyPage } from "../src/clod/simplify.ts";
import {
  assertNoInternalBorders,
  validateWeldedIntermediate,
  validateFinalPageMesh,
} from "../src/clod/validate.ts";
import { readFileSync } from "node:fs";

const cfg: ClodPagesConfig = {
  page: { chunks_per_page: 4, chunk_size: 16, halo_chunks: 1, quadtree_levels: 3 },
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

const borderCoast = parseBorderCoastOceanConfig(
  readFileSync(new URL("../config/border_coast_ocean.yaml", import.meta.url), "utf8"),
);

await initSimplifier();
setBorderCoastRuntime(borderCoast, 16 * 4 * 16);
setTerrainSurfaceOverride(null);

const l2 = buildWorld(16, 16, cfg);
const index = l2.nodesByLevel.get(2)!;
const eps = cfg.simplify.weld_epsilon_cells;
const span = (1 << 3) * cfg.page.chunks_per_page * cfg.page.chunk_size;

for (let nz = 0; nz < 2; nz++) {
  for (let nx = 0; nx < 2; nx++) {
    const id = `L3:${nx},${nz}`;
    const children = [];
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        const c = index.find((n) => n.id === `L2:${nx * 2 + dx},${nz * 2 + dz}`);
        if (!c) throw new Error("missing child");
        children.push(c);
      }
    }
    const footprint = { minX: nx * span, minZ: nz * span, maxX: (nx + 1) * span, maxZ: (nz + 1) * span };
    const merged = concat(children.map((c) => c.mesh));
    const { mesh: welded } = weldVertices(merged, eps, {
      position: cfg.validation.position_epsilon,
      normalDot: cfg.validation.normal_dot_min,
      material: cfg.validation.material_weight_epsilon,
    });
    try {
      validateWeldedIntermediate(welded, `${id} welded`, cfg.validation.zero_area_epsilon);
      assertNoInternalBorders(welded, footprint);
      console.log(id, "welded OK");
    } catch (e) {
      console.error(id, "welded FAIL", (e as Error).message);
      continue;
    }
    const locks = buildOuterBorderLocks(welded);
    const sim = simplifyPage(welded, locks, cfg);
    try {
      validateFinalPageMesh(sim.mesh, footprint, cfg.validation.zero_area_epsilon, id);
      console.log(id, "final OK");
    } catch (e) {
      console.error(id, "final FAIL", (e as Error).message);
    }
  }
}
