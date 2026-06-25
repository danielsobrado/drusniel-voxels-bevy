import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "./config.js";
import { initSimplifier, simplifyPage } from "./simplify.js";
import type { PageMesh } from "./types.js";

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
  },
  near_field: { radius_chunks: 6 },
  meshopt_package_version: "0.22.0",
  poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: true, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

function fiveTriangleFan(): PageMesh {
  const positions = [
    [0, 0, 0],
    [1, 0, 0],
    [0.31, 0, 0.95],
    [-0.81, 0, 0.59],
    [-0.81, 0, -0.59],
    [0.31, 0, -0.95],
  ].flat();
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    materials: new Float32Array([0, 0, 0, 0, 0, 0]),
    indices: new Uint32Array([
      0, 1, 2,
      0, 2, 3,
      0, 3, 4,
      0, 4, 5,
      0, 5, 1,
    ]),
  };
}

describe("simplifyPage", () => {
  beforeAll(async () => {
    await initSimplifier();
  });

  it("rounds odd-triangle targets to whole triangles before calling meshopt", () => {
    const mesh = fiveTriangleFan();
    const out = simplifyPage(mesh, new Uint8Array(mesh.positions.length / 3), cfg);
    expect(out.mesh.indices.length % 3).toBe(0);
  });
});
