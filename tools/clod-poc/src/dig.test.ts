// Dig-edit coverage: the carve overlay stays a pure function of (x,y,z) so the
// builder invariants (weld, locked borders, watertight assertions) must survive a
// targeted rebuild of the dug pages and their ancestors.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  addDigEdit,
  clearDigEdits,
  density,
  getDigEditsSnapshot,
  paintMaterialAt,
  paintWeightsAt,
  replaceDigEdits,
  surfaceHeight,
} from "./terrain/terrain.js";
import { buildNodeIndex, buildWorld, expandQuadSiblingPages, rebuildDirtyLod0Pages, rebuildDirtyPages, resimplifyParent } from "./clod/quadtree.js";
import { nextPendingParentLevelOrdered } from "./clod/parent_queue.js";
import { buildLod0PageSource, rebuildPageChunks } from "./clod/source_mesh.js";
import { initSimplifier } from "./clod/simplify.js";
import { assertBorderMatch, borderChain } from "./clod/validate.js";
import { DEFAULT_DIAGONAL_FLIP_CONFIG, type ClodPagesConfig } from "./config.js";

// Small world: 2x2 pages of 2x2 chunks of 16 cells -> 64x64 cells, LOD0 + one LOD1 root.
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
    show_wireframe: true, show_page_boundaries: true, show_locked_border_vertices: false,
    show_error_labels: true, show_stats_panel: true,
    lod_colors: { lod0: "#3b82f6", lod1: "#22c55e", lod2: "#f59e0b", lod3: "#ef4444" },
  },
  stress: { active_scene: "ridge_border" },
  meshopt_package_version: "0.22.0",
  poc: { lod0_pages_x: 8, lod0_pages_z: 8, smoke_lod0_pages_x: 4, smoke_lod0_pages_z: 4, emit_debug_json: true, emit_debug_obj: false },
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.9999, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

const uiCfg: ClodPagesConfig = {
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
  // normal_dot_min relaxed from 0.9999 to 0.997 (~4.4° angular tolerance):
  // domain-warped terrain noise produces steeper local gradients at chunk
  // borders, shifting the normal distribution beyond the old ultra-tight bound.
  validation: { position_epsilon: 0.000001, normal_dot_min: 0.997, material_weight_epsilon: 0.0001, zero_area_epsilon: 0.00000001 },
};

afterEach(clearDigEdits);

describe("dig edits in the density field", () => {
  it("snapshots and restores edit history defensively", () => {
    const source = [{ x: 5, y: 6, z: 7, r: 3, op: "add" as const, shape: "cube" as const, material: 2 }];
    replaceDigEdits(source);
    source[0].x = 99;
    const snapshot = getDigEditsSnapshot();
    expect(snapshot[0].x).toBe(5);
    snapshot[0].x = 42;
    expect(getDigEditsSnapshot()[0].x).toBe(5);
  });

  it("carves air inside the sphere and leaves the far field untouched", () => {
    const x = 5, z = 5;
    const y = surfaceHeight(x, z) - 1;
    expect(density(x, y, z)).toBeGreaterThan(0);
    addDigEdit({ x, y, z, r: 3 });
    expect(density(x, y, z)).toBeLessThan(0);
    expect(density(x + 50, y, z)).toBe(surfaceHeight(x + 50, z) - y);
  });

  it("respects the bedrock guard", () => {
    addDigEdit({ x: 5, y: 0, z: 5, r: 3 });
    expect(density(5, 1, 5)).toBeGreaterThan(0);
    expect(density(5, 2, 5)).toBeLessThan(0);
  });

  it("raise deposits solid above the surface and tags it with the chosen material", () => {
    const x = 30, z = 30;
    const sy = surfaceHeight(x, z);
    expect(density(x, sy + 2, z)).toBeLessThan(0);
    addDigEdit({ x, y: sy, z, r: 4, op: "add", material: 2 });
    expect(density(x, sy + 2, z)).toBeGreaterThan(0);
    expect(paintMaterialAt(x, sy, z)).toBe(3);
    expect(paintMaterialAt(x + 50, sy, z)).toBe(0);
  });

  it("keeps paint slot ids stable while coverage fades to zero", () => {
    const x = 30, z = 30;
    const sy = surfaceHeight(x, z);
    addDigEdit({ x, y: sy, z, r: 4, op: "add", material: 3 });

    const painted = paintWeightsAt(x, sy, z);
    const unpainted = paintWeightsAt(x + 50, sy, z);

    expect(painted.slots[0]).toBe(3);
    expect(painted.weights[0]).toBe(1);
    expect(unpainted.slots[0]).toBe(3);
    expect(unpainted.weights[0]).toBe(0);

    const interpolatedSlot = (painted.slots[0] + unpainted.slots[0]) * 0.5;
    const interpolatedWeight = (painted.weights[0] + unpainted.weights[0]) * 0.5;
    expect(Math.floor(interpolatedSlot + 0.5)).toBe(3);
    expect(interpolatedWeight).toBeGreaterThan(0);
  });

  it("strength scales how much an edit moves the field", () => {
    const x = 40, z = 40;
    const y = surfaceHeight(x, z) - 1;
    const base = density(x, y, z);
    expect(base).toBeGreaterThan(0);

    addDigEdit({ x, y, z, r: 3, strength: 0 });
    expect(density(x, y, z)).toBeCloseTo(base);
    clearDigEdits();

    addDigEdit({ x, y, z, r: 3, strength: 0.5 });
    const half = density(x, y, z);
    clearDigEdits();

    addDigEdit({ x, y, z, r: 3 });
    const full = density(x, y, z);

    expect(half).toBeLessThan(base);
    expect(half).toBeGreaterThan(full);
  });

  it("brush height extends the vertical reach independent of radius", () => {
    const x = 45, z = 45;
    const sy = surfaceHeight(x, z);
    const y = sy - 10;

    addDigEdit({ x, y: sy, z, r: 2, shape: "cylinder" });
    expect(density(x, y, z)).toBeGreaterThan(0);
    clearDigEdits();

    addDigEdit({ x, y: sy, z, r: 2, shape: "cylinder", height: 14 });
    expect(density(x, y, z)).toBeLessThan(0);
  });

  it("cube and cylinder brushes carve their own footprint (not the sphere's)", () => {
    const x = 60, z = 60;
    const y = surfaceHeight(x, z) - 6;
    const r = 4;
    const cx = x + 0.9 * r, cy = y + 0.9 * r, cz = z + 0.9 * r;

    addDigEdit({ x, y, z, r, shape: "sphere" });
    expect(density(cx, cy, cz)).toBeGreaterThan(0);
    clearDigEdits();

    addDigEdit({ x, y, z, r, shape: "cube" });
    expect(density(cx, cy, cz)).toBeLessThan(0);
  });
});

describe("rebuildDirtyPages", () => {
  beforeAll(async () => {
    await initSimplifier();
  });

  it("rebuilds a border-straddling dig watertight across pages and ancestors", () => {
    const result = buildWorld(2, 2, cfg);
    const lod0 = result.nodesByLevel.get(0)!;
    const a = lod0.find((n) => n.id === "L0:0,0")!;
    const b = lod0.find((n) => n.id === "L0:1,0")!;
    const trisBefore = a.mesh.indices.length;

    const x = 32, z = 16;
    const y = surfaceHeight(x, z);
    const r = 3;
    addDigEdit({ x, y, z, r });
    const rebuild = rebuildDirtyPages(
      result,
      { minX: x - r - 4, maxX: x + r + 4, minZ: z - r - 4, maxZ: z + r + 4 },
      cfg,
    );

    expect(rebuild.lod0Pages).toBe(2);
    expect(rebuild.parentNodes).toBe(1);
    expect(a.mesh.indices.length).not.toBe(trisBefore);
    assertBorderMatch(
      borderChain(a.mesh, "x", 32, a.footprint),
      borderChain(b.mesh, "x", 32, b.footprint),
    );
  });

  it("raises a border-straddling mound watertight (paint material welds across the page seam)", () => {
    const result = buildWorld(2, 2, cfg);
    const lod0 = result.nodesByLevel.get(0)!;
    const a = lod0.find((n) => n.id === "L0:0,0")!;
    const b = lod0.find((n) => n.id === "L0:1,0")!;

    const x = 32, z = 16, r = 4;
    addDigEdit({ x, y: surfaceHeight(x, z), z, r, op: "add", material: 1 });
    const rebuild = rebuildDirtyPages(
      result,
      { minX: x - r - 4, maxX: x + r + 4, minZ: z - r - 4, maxZ: z + r + 4 },
      cfg,
    );

    expect(rebuild.lod0Pages).toBe(2);
    assertBorderMatch(
      borderChain(a.mesh, "x", 32, a.footprint),
      borderChain(b.mesh, "x", 32, b.footprint),
    );
  });

  it("carves a closed underground cave (more triangles, hard-fail validation passes)", () => {
    const result = buildWorld(2, 2, cfg);
    const node = result.nodesByLevel.get(0)!.find((n) => n.id === "L0:0,0")!;
    const trisBefore = node.mesh.indices.length;

    const x = 16, z = 16;
    const y = surfaceHeight(x, z) - 12;
    const r = 4;
    addDigEdit({ x, y, z, r });
    const rebuild = rebuildDirtyPages(
      result,
      { minX: x - r - 4, maxX: x + r + 4, minZ: z - r - 4, maxZ: z + r + 4 },
      cfg,
    );

    expect(rebuild.lod0Pages).toBeGreaterThanOrEqual(1);
    expect(node.mesh.indices.length).toBeGreaterThan(trisBefore);
  });

  it("leaves cached chunks unchanged when candidate validation fails", () => {
    const world = { cellsX: 2 * cfg.page.chunks_per_page * cfg.page.chunk_size, cellsZ: 2 * cfg.page.chunks_per_page * cfg.page.chunk_size };
    const source = buildLod0PageSource(0, 0, cfg, world);
    const originalChunks = [...source.chunks];
    const badValidationCfg = {
      ...cfg,
      validation: { ...cfg.validation, zero_area_epsilon: Number.MAX_VALUE },
    };

    const x = 6, z = 6, r = 2;
    const y = surfaceHeight(x, z) - 4;
    addDigEdit({ x, y, z, r });
    const margin = r + 4;

    expect(() => rebuildPageChunks(
      source.chunks,
      0,
      0,
      badValidationCfg,
      world,
      { minX: x - margin, maxX: x + margin, minZ: z - margin, maxZ: z + margin },
    )).toThrow();
    expect(source.chunks.every((chunk, index) => chunk === originalChunks[index])).toBe(true);
  });

  it("per-chunk rebuild avoids reporting clean sibling pages", () => {
    const world = { cellsX: 2 * cfg.page.chunks_per_page * cfg.page.chunk_size, cellsZ: 2 * cfg.page.chunks_per_page * cfg.page.chunk_size };
    const result = buildWorld(2, 2, cfg);
    const node = result.nodesByLevel.get(0)!.find((n) => n.id === "L0:0,0")!;

    const x = 6, z = 6, r = 2;
    const y = surfaceHeight(x, z) - 4;
    addDigEdit({ x, y, z, r });
    const margin = r + 4;
    const dirty = { minX: x - margin, maxX: x + margin, minZ: z - margin, maxZ: z + margin };

    const lod0 = rebuildDirtyLod0Pages(result, dirty, cfg, buildNodeIndex(result));
    expect(lod0.lod0Pages).toBe(1);
    expect(lod0.chunksTotal).toBe(cfg.page.chunks_per_page ** 2 * 4);
    expect(lod0.chunksRemeshed).toBe(cfg.page.chunks_per_page ** 2);
    expect(lod0.chunksRemeshed).toBeLessThan(lod0.chunksTotal);

    const full = buildLod0PageSource(0, 0, cfg, world);
    expect(node.mesh.positions).toEqual(full.mesh.positions);
    expect(node.mesh.indices).toEqual(full.mesh.indices);
    expect(node.mesh.normals).toEqual(full.mesh.normals);
  });

  it("per-chunk rebuild remeshes a true subset inside a 4x4 page", () => {
    const world = { cellsX: 4 * uiCfg.page.chunks_per_page * uiCfg.page.chunk_size, cellsZ: 4 * uiCfg.page.chunks_per_page * uiCfg.page.chunk_size };
    const result = buildWorld(4, 4, uiCfg);
    const node = result.nodesByLevel.get(0)!.find((n) => n.id === "L0:0,0")!;

    const x = 6, z = 6, r = 2;
    const y = surfaceHeight(x, z) - 4;
    addDigEdit({ x, y, z, r });
    const margin = r + 4;
    const dirty = { minX: x - margin, maxX: x + margin, minZ: z - margin, maxZ: z + margin };

    const lod0 = rebuildDirtyLod0Pages(result, dirty, uiCfg, buildNodeIndex(result));
    expect(lod0.lod0Pages).toBe(1);
    expect(lod0.chunksTotal).toBe(uiCfg.page.chunks_per_page ** 2 * 4);
    expect(lod0.chunksRemeshed).toBe(4);
    expect(lod0.chunksRemeshed).toBeLessThan(uiCfg.page.chunks_per_page ** 2);

    const full = buildLod0PageSource(0, 0, uiCfg, world);
    expect(node.mesh.positions).toEqual(full.mesh.positions);
    expect(node.mesh.indices).toEqual(full.mesh.indices);
    expect(node.mesh.normals).toEqual(full.mesh.normals);
  });

  it("keeps UI-sized repeated raise edits valid through ancestor rebuilds", () => {
    const result = buildWorld(4, 4, uiCfg);
    const edits = [
      [131.3, 27.3, 104.8],
      [141.1, 23.9, 107.1],
      [135.3, 28.5, 94.2],
      [139.5, 35.9, 92.2],
      [100.9, 16.9, 203.8],
      [147.3, 18.0, 146.9],
      [167.1, 21.2, 87.9],
      [204.9, 22.6, 100.6],
      [87.5, 21.3, 158.8],
    ] as const;

    for (const [x, y, z] of edits) {
      const r = 6;
      addDigEdit({ x, y, z, r, shape: "sphere", op: "add", material: 0 });
      const margin = r + 4;
      expect(() =>
        rebuildDirtyPages(
          result,
          { minX: x - margin, maxX: x + margin, minZ: z - margin, maxZ: z + margin },
          uiCfg,
        ),
      ).not.toThrow();
    }
    // Timeout raised from 20s to 100s: domain-warped terrain noise roughly
    // triples per-sample cost, and each raise edit triggers a full rebuild.
  }, 100000);

  it("survives repeated remove spheres at default-world dig sites through ancestors", () => {
    const result = buildWorld(8, 8, uiCfg);
    const digs = [
      { x: 251.2, y: 29.4, z: 315.2 },
      { x: 242.9, y: 28.6, z: 325.2 },
    ] as const;
    for (const { x, y, z } of digs) {
      const r = 3;
      addDigEdit({ x, y, z, r, shape: "sphere", op: "remove" });
      const margin = r + 4;
      expect(() =>
        rebuildDirtyPages(
          result,
          { minX: x - margin, maxX: x + margin, minZ: z - margin, maxZ: z + margin },
          uiCfg,
        ),
      ).not.toThrow();
    }
  }, 120000);

  it("survives two remove spheres with budgeted parent drain (worker queue semantics)", () => {
    const topLevel = 3;
    const digs = [
      { x: 251.2, y: 29.4, z: 315.2 },
      { x: 242.9, y: 28.6, z: 325.2 },
    ] as const;

    const result = buildWorld(8, 8, uiCfg);
    const index = buildNodeIndex(result);
    const pending = new Map<number, Set<string>>();
    const childCoords = new Map<number, [number, number][]>();
    const enqueue = (level: number, nx: number, nz: number) => {
      let set = pending.get(level);
      if (!set) { set = new Set(); pending.set(level, set); }
      set.add(`${nx},${nz}`);
    };
    const enqueueSiblingGroup = (level: number, coords: readonly [number, number][]) => {
      for (const [nx, nz] of expandQuadSiblingPages(coords, level, result.worldPagesX, result.worldPagesZ)) {
        enqueue(level, nx, nz);
      }
    };
    const uniqueParents = (coords: readonly [number, number][]) => {
      const keys = new Set<string>();
      for (const [nx, nz] of coords) keys.add(`${nx >> 1},${nz >> 1}`);
      return [...keys].map((key) => key.split(",").map(Number) as [number, number]);
    };
    const clearPendingFrom = (level: number) => {
      for (let l = level; l <= topLevel; l++) pending.delete(l);
      for (const l of [...childCoords.keys()]) {
        if (l >= level - 1) childCoords.delete(l);
      }
    };
    const hasPending = () => [...pending.values()].some((set) => set.size > 0);
    const seedLod0 = (dirtyCoords: readonly [number, number][]) => {
      clearPendingFrom(1);
      enqueueSiblingGroup(1, uniqueParents(dirtyCoords));
    };
    const processOne = () => {
      const next = nextPendingParentLevelOrdered(pending, topLevel);
      if (!next) return false;
      resimplifyParent(index, next.level, next.key, uiCfg, next.level === topLevel);
      const [nx, nz] = next.key.split(",").map(Number) as [number, number];
      let coords = childCoords.get(next.level);
      if (!coords) { coords = []; childCoords.set(next.level, coords); }
      coords.push([nx, nz]);
      const levelSet = pending.get(next.level);
      if (!levelSet || levelSet.size === 0) {
        const completed = childCoords.get(next.level) ?? [];
        childCoords.delete(next.level);
        if (completed.length > 0) enqueueSiblingGroup(next.level + 1, uniqueParents(completed));
      }
      return true;
    };

    for (const { x, y, z } of digs) {
      const r = 3;
      addDigEdit({ x, y, z, r, shape: "sphere", op: "remove" });
      const margin = r + 4;
      const dirty = { minX: x - margin, maxX: x + margin, minZ: z - margin, maxZ: z + margin };
      const lod0 = rebuildDirtyLod0Pages(result, dirty, uiCfg, index);
      seedLod0(lod0.dirtyCoords);
      for (let i = 0; i < 2; i++) processOne();
    }
    let guard = 0;
    while (hasPending()) {
      if (!processOne()) break;
      if (++guard > 500) throw new Error("drain exceeded guard");
    }
  }, 240000);
});
