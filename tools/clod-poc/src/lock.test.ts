import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "./config.js";
import { initSimplifier, simplifyPage } from "./clod/simplify.js";
import { buildParentSimplifyLocks, countLocks, setSimplifyCorridorLockQuery } from "./lock.js";
import type { PageMesh } from "./types.js";

const cfg: ClodPagesConfig = {
  page: { chunks_per_page: 4, chunk_size: 16, halo_chunks: 1, quadtree_levels: 4 },
  simplify: {
    target_ratio_per_level: 0.1,
    abandon_ratio: 0.95,
    target_error: 0.5,
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
    show_wireframe: false, show_page_boundaries: false, show_locked_border_vertices: false,
    show_error_labels: false, show_stats_panel: false,
    lod_colors: { lod0: "#3b82f6", lod1: "#22c55e", lod2: "#f59e0b", lod3: "#ef4444" },
  },
  stress: { active_scene: "ridge_border" },
  meshopt_package_version: "0.22.0",
  poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: false, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

/** Dense grid plane with a sharp trench along x = 16 (4 m wide, 5 m deep). */
function trenchGridMesh(size = 33): PageMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const y = 20 - (Math.abs(x - 16) <= 2 ? 5 : 0);
      positions.push(x, y, z);
      normals.push(0, 1, 0);
    }
  }
  const indices: number[] = [];
  for (let z = 0; z < size - 1; z++) {
    for (let x = 0; x < size - 1; x++) {
      const a = z * size + x;
      indices.push(a, a + size, a + 1, a + 1, a + size, a + size + 1);
    }
  }
  const vertexTotal = size * size;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    paintSlots: new Float32Array(vertexTotal),
    materialWeights: new Float32Array(vertexTotal * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)),
    materialWeightStride: 4,
    indices: new Uint32Array(indices),
  };
}

function referencedPositionSet(mesh: PageMesh): Set<string> {
  const out = new Set<string>();
  for (const index of mesh.indices) {
    out.add(`${mesh.positions[index * 3]},${mesh.positions[index * 3 + 1]},${mesh.positions[index * 3 + 2]}`);
  }
  return out;
}

describe("buildParentSimplifyLocks", () => {
  afterEach(() => setSimplifyCorridorLockQuery(null));

  it("returns pure border locks when no corridor query is installed", () => {
    const mesh = trenchGridMesh(9);
    const border = buildParentSimplifyLocks(mesh);
    // Grid border of a 9x9 plane: 32 boundary vertices.
    expect(countLocks(border)).toBe(32);
  });

  it("ORs corridor vertices into the border locks", () => {
    const mesh = trenchGridMesh(9);
    const borderOnly = countLocks(buildParentSimplifyLocks(mesh));
    setSimplifyCorridorLockQuery((x) => Math.abs(x - 4) <= 1);
    const locks = buildParentSimplifyLocks(mesh);
    expect(countLocks(locks)).toBeGreaterThan(borderOnly);
    for (let i = 0; i < locks.length; i++) {
      if (Math.abs(mesh.positions[i * 3] - 4) <= 1) expect(locks[i]).toBe(1);
    }
  });
});

describe("corridor locks through simplification", () => {
  beforeAll(async () => {
    await initSimplifier();
  });
  afterEach(() => setSimplifyCorridorLockQuery(null));

  it("preserves trench vertices that would otherwise be simplified away", () => {
    const corridor = (x: number) => Math.abs(x - 16) <= 3;

    setSimplifyCorridorLockQuery(null);
    const unlockedMesh = trenchGridMesh();
    const unlocked = simplifyPage(unlockedMesh, buildParentSimplifyLocks(unlockedMesh), cfg);
    const unlockedKept = referencedPositionSet(unlocked.mesh);

    setSimplifyCorridorLockQuery(corridor);
    const lockedMesh = trenchGridMesh();
    const locks = buildParentSimplifyLocks(lockedMesh);
    const locked = simplifyPage(lockedMesh, locks, cfg);
    const lockedKept = referencedPositionSet(locked.mesh);

    // Every corridor vertex survives, bit-exact, when locked.
    let corridorVerts = 0;
    for (let i = 0; i < locks.length; i++) {
      if (!corridor(lockedMesh.positions[i * 3])) continue;
      corridorVerts++;
      const key = `${lockedMesh.positions[i * 3]},${lockedMesh.positions[i * 3 + 1]},${lockedMesh.positions[i * 3 + 2]}`;
      expect(lockedKept.has(key)).toBe(true);
    }
    expect(corridorVerts).toBeGreaterThan(100);

    // The aggressive budget really does destroy interior trench detail without locks.
    let unlockedSurvivors = 0;
    for (let i = 0; i < locks.length; i++) {
      const x = unlockedMesh.positions[i * 3];
      const z = unlockedMesh.positions[i * 3 + 2];
      if (!corridor(x) || z === 0 || z === 32) continue;
      const key = `${x},${unlockedMesh.positions[i * 3 + 1]},${z}`;
      if (unlockedKept.has(key)) unlockedSurvivors++;
    }
    expect(unlockedSurvivors).toBeLessThan(corridorVerts / 2);
  });
});
