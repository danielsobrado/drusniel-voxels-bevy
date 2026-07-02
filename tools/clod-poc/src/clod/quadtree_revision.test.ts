import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../config.js";
import { buildWorld, rebuildDirtyPages } from "./quadtree.js";
import { initSimplifier } from "./simplify.js";
import { addDigEdit, clearDigEdits, surfaceHeight } from "../terrain/terrain.js";

const cfg: ClodPagesConfig = {
  page: { chunks_per_page: 2, chunk_size: 16, halo_chunks: 1, quadtree_levels: 2 },
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
    crossfade_frames: 12,
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
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

beforeAll(async () => {
  await initSimplifier();
});

afterEach(clearDigEdits);

describe("CLOD page revisions", () => {
  it("initializes runtime-built nodes with a revision", () => {
    const result = buildWorld(2, 2, cfg);

    for (const nodes of result.nodesByLevel.values()) {
      for (const node of nodes) expect(node.revision).toBe(1);
    }
  });

  it("bumps edited LOD0 pages and rebuilt ancestors", () => {
    const result = buildWorld(2, 2, cfg);
    const leaf = result.nodesByLevel.get(0)!.find((node) => node.id === "L0:0,0")!;
    const root = result.nodesByLevel.get(1)!.find((node) => node.id === "L1:0,0")!;
    const leafRevision = leaf.revision;
    const rootRevision = root.revision;

    const x = 6;
    const z = 6;
    const r = 2;
    addDigEdit({ x, y: surfaceHeight(x, z) - 4, z, r });
    rebuildDirtyPages(
      result,
      { minX: x - r - 4, maxX: x + r + 4, minZ: z - r - 4, maxZ: z + r + 4 },
      cfg,
    );

    expect(leaf.revision).toBe((leafRevision ?? 0) + 1);
    expect(root.revision).toBe((rootRevision ?? 0) + 1);
  });
});
