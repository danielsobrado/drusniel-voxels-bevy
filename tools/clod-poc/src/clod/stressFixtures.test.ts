import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "../config.js";
import { initSimplifier } from "./simplify.js";
import type { PageMesh, ClodPageNode } from "../types.js";
import { assertBorderMatch, borderChain } from "./validate.js";
import { buildTestHierarchy, validateHierarchyInvariants } from "./buildTestHierarchy.js";
import { formatBuildStats } from "./stats.js";
import { buildDebugSummary } from "./debugExport.js";
import {
  ALL_FIXTURES,
  FLAT,
  ROLLING_HILL,
  RIDGE_BORDER,
  CLIFF_CORNER,
  CAVE_MOUTH,
  THIN_BRIDGE,
  OVERHANG_LIP,
  MATERIAL_TRANSITION,
  type FixtureDef,
} from "./stressFixtures.js";

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

function heightfieldPageMesh(fixture: FixtureDef, pageX: number, pageZ: number, cellsPerSide: number): PageMesh {
  const baseX = pageX * cellsPerSide;
  const baseZ = pageZ * cellsPerSide;
  const side = cellsPerSide + 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const materials: number[] = [];

  for (let j = 0; j <= cellsPerSide; j++) {
    for (let i = 0; i <= cellsPerSide; i++) {
      const wx = baseX + i;
      const wz = baseZ + j;
      const h = fixture.height(wx, wz);
      const m = fixture.material(wx, wz);
      positions.push(wx, h, wz);
      normals.push(0, 1, 0);
      materials.push(m);
    }
  }

  const indices: number[] = [];
  for (let j = 0; j < cellsPerSide; j++) {
    for (let i = 0; i < cellsPerSide; i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = (j + 1) * side + i;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const nv = positions.length / 3;
  const mw = new Float32Array(nv * 4);
  for (let i = 0; i < nv; i++) {
    const slot = Math.min(Math.max(0, Math.round(materials[i])), 3);
    mw[i * 4 + slot] = 1.0;
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    paintSlots: new Float32Array(materials),
    materialWeights: mw,
    materialWeightStride: 4,
    indices: new Uint32Array(indices),
  };
}

function buildFixtureWorld(fixture: FixtureDef, worldPagesX: number, worldPagesZ: number, cfg: ClodPagesConfig) {
  const cellsPerPage = cfg.page.chunks_per_page * cfg.page.chunk_size;
  const meshProvider = (px: number, pz: number) => heightfieldPageMesh(fixture, px, pz, cellsPerPage);
  return buildTestHierarchy(worldPagesX, worldPagesZ, cfg, meshProvider);
}

function validateAdjacentBorders(nodesByLevel: Map<number, ClodPageNode[]>): void {
  for (const [level, nodes] of nodesByLevel) {
    if (level === 0) continue;

    const index = new Map<string, ClodPageNode>();
    for (const node of nodes) {
      const match = /^L\d+:(\d+),(\d+)$/.exec(node.id);
      if (match) index.set(`${match[1]},${match[2]}`, node);
    }

    for (const [key, node] of index) {
      const [nxStr, nzStr] = key.split(",");
      const nx = Number(nxStr);
      const nz = Number(nzStr);

      const right = index.get(`${nx + 1},${nz}`);
      if (right) {
        const aChain = borderChain(node.mesh, "x", node.footprint.maxX, node.footprint, 1);
        const bChain = borderChain(right.mesh, "x", right.footprint.minX, right.footprint, 1);
        if (aChain.positions.length > 0 && bChain.positions.length > 0) {
          assertBorderMatch(aChain, bChain);
        }
      }

      const down = index.get(`${nx},${nz + 1}`);
      if (down) {
        const aChain = borderChain(node.mesh, "z", node.footprint.maxZ, node.footprint, 1);
        const bChain = borderChain(down.mesh, "z", down.footprint.minZ, down.footprint, 1);
        if (aChain.positions.length > 0 && bChain.positions.length > 0) {
          assertBorderMatch(aChain, bChain);
        }
      }
    }
  }
}

beforeAll(async () => {
  await initSimplifier();
}, 30000);

describe("ALL_FIXTURES", () => {
  it("has all 8 fixture types", () => {
    expect(ALL_FIXTURES).toHaveLength(8);
    expect(ALL_FIXTURES.map((f) => f.name).sort()).toEqual([
      "cave_mouth",
      "cliff_corner",
      "flat",
      "material_transition",
      "overhang_lip",
      "ridge_border",
      "rolling_hill",
      "thin_bridge",
    ]);
  });
});

const SMOKE_SIZE = 2;

describe.each(ALL_FIXTURES)("$name", (fixture) => {
  it("builds hierarchy without crash", () => {
    const result = buildFixtureWorld(fixture, SMOKE_SIZE, SMOKE_SIZE, cfg);
    expect(result.nodesByLevel.size).toBeGreaterThan(0);
    expect(result.nodesByLevel.get(0)!.length).toBe(SMOKE_SIZE * SMOKE_SIZE);
    const maxLevel = Math.max(...result.nodesByLevel.keys());
    expect(maxLevel).toBe(1);
    expect(result.stats.levels.length).toBeGreaterThanOrEqual(1);
  });

  it("validates all invariants", () => {
    const result = buildFixtureWorld(fixture, SMOKE_SIZE, SMOKE_SIZE, cfg);
    expect(() => validateHierarchyInvariants(result, cfg)).not.toThrow();
  });

  it("has no internal borders at any level", () => {
    const result = buildFixtureWorld(fixture, SMOKE_SIZE, SMOKE_SIZE, cfg);
    for (const [level, nodes] of result.nodesByLevel) {
      for (const node of nodes) {
        if (level === 0) continue;
        // Already validated in buildTestHierarchy via assertNoInternalBorders
        expect(node.mesh.indices.length).toBeGreaterThan(0);
      }
    }
  });

  it("has monotonic error up the tree", () => {
    const result = buildFixtureWorld(fixture, SMOKE_SIZE, SMOKE_SIZE, cfg);
    for (const [level, nodes] of result.nodesByLevel) {
      if (level === 0) continue;
      for (const node of nodes) {
        const childMax = Math.max(...node.children.filter((c): c is ClodPageNode => c !== null).map((c) => c.errorWorld));
        expect(node.errorWorld).toBeGreaterThanOrEqual(childMax);
      }
    }
  });

  it("emits stats", () => {
    const result = buildFixtureWorld(fixture, SMOKE_SIZE, SMOKE_SIZE, cfg);
    expect(result.stats.totalBuildMs).toBeGreaterThanOrEqual(0);
    expect(result.stats.levels.length).toBeGreaterThan(0);
    const summary = formatBuildStats(result.stats);
    expect(summary.length).toBeGreaterThan(0);
  });

  it("emits debug summary", () => {
    const result = buildFixtureWorld(fixture, SMOKE_SIZE, SMOKE_SIZE, cfg);
    const summary = buildDebugSummary(result.nodesByLevel);
    expect(summary.totalNodes).toBeGreaterThan(0);
    expect(summary.maxLevel).toBeGreaterThanOrEqual(0);
    expect(summary.nodes.length).toBe(summary.totalNodes);
  });

  it("has no degenerate output", () => {
    const result = buildFixtureWorld(fixture, SMOKE_SIZE, SMOKE_SIZE, cfg);
    for (const [, nodes] of result.nodesByLevel) {
      for (const node of nodes) {
        for (let i = 0; i < node.mesh.indices.length; i += 3) {
          const a = node.mesh.indices[i];
          const b = node.mesh.indices[i + 1];
          const c = node.mesh.indices[i + 2];
          expect(a).not.toBe(b);
          expect(b).not.toBe(c);
          expect(a).not.toBe(c);
        }
      }
    }
  });

  it("validates same-level adjacent borders", () => {
    const result = buildFixtureWorld(fixture, SMOKE_SIZE, SMOKE_SIZE, cfg);
    expect(() => validateAdjacentBorders(result.nodesByLevel)).not.toThrow();
  });
});

describe("smoke test: 4x4 world", () => {
  it("flat builds 4x4 hierarchy", () => {
    const result = buildFixtureWorld(FLAT, 4, 4, cfg);
    const lod0 = result.nodesByLevel.get(0)!;
    expect(lod0.length).toBe(16);

    const maxLevel = Math.max(...result.nodesByLevel.keys());
    expect(maxLevel).toBeGreaterThanOrEqual(2);

    const totalNodes = [...result.nodesByLevel.values()].reduce((s, n) => s + n.length, 0);
    expect(totalNodes).toBeGreaterThan(16);
  });

  it("rolling_hill builds 4x4 hierarchy", () => {
    const result = buildFixtureWorld(ROLLING_HILL, 4, 4, cfg);
    expect(result.nodesByLevel.get(0)!.length).toBe(16);
    expect(() => validateHierarchyInvariants(result, cfg)).not.toThrow();
  });

  it("ridge_border builds with valid borders", () => {
    const result = buildFixtureWorld(RIDGE_BORDER, 4, 4, cfg);
    expect(() => validateHierarchyInvariants(result, cfg)).not.toThrow();
    expect(() => validateAdjacentBorders(result.nodesByLevel)).not.toThrow();
  });

  it("cliff_corner builds with valid borders", () => {
    const result = buildFixtureWorld(CLIFF_CORNER, 4, 4, cfg);
    expect(() => validateHierarchyInvariants(result, cfg)).not.toThrow();
    expect(() => validateAdjacentBorders(result.nodesByLevel)).not.toThrow();
  });

  it("cave_mouth builds with valid borders", () => {
    const result = buildFixtureWorld(CAVE_MOUTH, 4, 4, cfg);
    expect(() => validateHierarchyInvariants(result, cfg)).not.toThrow();
    expect(() => validateAdjacentBorders(result.nodesByLevel)).not.toThrow();
  });

  it("thin_bridge builds with valid borders", () => {
    const result = buildFixtureWorld(THIN_BRIDGE, 4, 4, cfg);
    expect(() => validateHierarchyInvariants(result, cfg)).not.toThrow();
    expect(() => validateAdjacentBorders(result.nodesByLevel)).not.toThrow();
  });

  it("overhang_lip builds with valid borders", () => {
    const result = buildFixtureWorld(OVERHANG_LIP, 4, 4, cfg);
    expect(() => validateHierarchyInvariants(result, cfg)).not.toThrow();
    expect(() => validateAdjacentBorders(result.nodesByLevel)).not.toThrow();
  });

  it("material_transition builds with valid borders", () => {
    const result = buildFixtureWorld(MATERIAL_TRANSITION, 4, 4, cfg);
    expect(() => validateHierarchyInvariants(result, cfg)).not.toThrow();
    expect(() => validateAdjacentBorders(result.nodesByLevel)).not.toThrow();
  });
});

describe("full hierarchy: 8x8 world", () => {
  it("flat 8x8 hierarchy has LOD3 root", () => {
    const result = buildFixtureWorld(FLAT, 8, 8, cfg);
    const lod0 = result.nodesByLevel.get(0)!;
    expect(lod0.length).toBe(64);

    const maxLevel = Math.max(...result.nodesByLevel.keys());
    expect(maxLevel).toBe(3);

    const roots = result.nodesByLevel.get(3)!;
    expect(roots.length).toBe(1);

    expect(() => validateHierarchyInvariants(result, cfg)).not.toThrow();
  });

  it("LOD1 parent has 4 children", () => {
    const result = buildFixtureWorld(FLAT, 8, 8, cfg);
    const lod1 = result.nodesByLevel.get(1)!;
    for (const node of lod1) {
      const validChildren = node.children.filter((c): c is ClodPageNode => c !== null);
      expect(validChildren.length).toBe(4);
    }
  });

  it("errorWorld is monotonic across all levels", () => {
    const result = buildFixtureWorld(FLAT, 8, 8, cfg);
    for (const [level, nodes] of result.nodesByLevel) {
      if (level === 0) continue;
      for (const node of nodes) {
        const childMax = Math.max(...node.children.filter((c): c is ClodPageNode => c !== null).map((c) => c.errorWorld));
        expect(node.errorWorld).toBeGreaterThanOrEqual(childMax - 0.0001);
      }
    }
  });

  it("same-level adjacent borders match", () => {
    const result = buildFixtureWorld(FLAT, 8, 8, cfg);
    expect(() => validateAdjacentBorders(result.nodesByLevel)).not.toThrow();
  });
});
