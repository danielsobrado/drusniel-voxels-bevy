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
} from "./terrain.js";
import { buildNodeIndex, buildWorld, rebuildDirtyLod0Pages, rebuildDirtyPages } from "./quadtree.js";
import { buildLod0PageSource } from "./source_mesh.js";
import { initSimplifier } from "./simplify.js";
import { assertBorderMatch, borderChain } from "./validate.js";
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
  },
  near_field: { radius_chunks: 6 },
  meshopt_package_version: "0.22.0",
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
  },
  near_field: { radius_chunks: 6 },
  meshopt_package_version: "0.22.0",
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
    const y = surfaceHeight(x, z) - 1; // just below the surface: solid
    expect(density(x, y, z)).toBeGreaterThan(0);
    addDigEdit({ x, y, z, r: 3 });
    expect(density(x, y, z)).toBeLessThan(0);
    expect(density(x + 50, y, z)).toBe(surfaceHeight(x + 50, z) - y);
  });

  it("respects the bedrock guard", () => {
    addDigEdit({ x: 5, y: 0, z: 5, r: 3 });
    expect(density(5, 1, 5)).toBeGreaterThan(0); // y <= bedrock: untouched
    expect(density(5, 2, 5)).toBeLessThan(0); // above bedrock, inside sphere: air
  });

  it("raise deposits solid above the surface and tags it with the chosen material", () => {
    const x = 30, z = 30;
    const sy = surfaceHeight(x, z);
    expect(density(x, sy + 2, z)).toBeLessThan(0); // above the surface: air before
    addDigEdit({ x, y: sy, z, r: 4, op: "add", material: 2 });
    expect(density(x, sy + 2, z)).toBeGreaterThan(0); // raised: now solid

    // deposited vertices carry a one-hot weight on the chosen slot; far field stays natural
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
    const y = surfaceHeight(x, z) - 1; // solid
    const base = density(x, y, z);
    expect(base).toBeGreaterThan(0);

    addDigEdit({ x, y, z, r: 3, strength: 0 });
    expect(density(x, y, z)).toBeCloseTo(base); // 0 strength is a no-op
    clearDigEdits();

    addDigEdit({ x, y, z, r: 3, strength: 0.5 });
    const half = density(x, y, z);
    clearDigEdits();

    addDigEdit({ x, y, z, r: 3 }); // full (default strength 1)
    const full = density(x, y, z);

    // a half-strength carve lands between untouched and full
    expect(half).toBeLessThan(base);
    expect(half).toBeGreaterThan(full);
  });

  it("brush height extends the vertical reach independent of radius", () => {
    const x = 45, z = 45;
    const sy = surfaceHeight(x, z);
    const y = sy - 10; // 10 cells below the surface

    // a radius-2 cylinder (height defaults to 2) can't reach this deep
    addDigEdit({ x, y: sy, z, r: 2, shape: "cylinder" });
    expect(density(x, y, z)).toBeGreaterThan(0); // still solid
    clearDigEdits();

    // same radius, but tall enough to carve down to it
    addDigEdit({ x, y: sy, z, r: 2, shape: "cylinder", height: 14 });
    expect(density(x, y, z)).toBeLessThan(0); // now air
  });

  it("cube and cylinder brushes carve their own footprint (not the sphere's)", () => {
    const x = 60, z = 60;
    const y = surfaceHeight(x, z) - 6; // solidly underground
    const r = 4;
    // a corner of the radius-r box, well outside the inscribed sphere (|offset| ≈ 1.56r)
    const cx = x + 0.9 * r, cy = y + 0.9 * r, cz = z + 0.9 * r;

    addDigEdit({ x, y, z, r, shape: "sphere" });
    expect(density(cx, cy, cz)).toBeGreaterThan(0); // sphere doesn't reach the corner
    clearDigEdits();

    addDigEdit({ x, y, z, r, shape: "cube" });
    expect(density(cx, cy, cz)).toBeLessThan(0); // cube does
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

    // dig across the x=32 page border, well inside the z extent of the bottom row
    const x = 32, z = 16;
    const y = surfaceHeight(x, z);
    const r = 3;
    addDigEdit({ x, y, z, r });
    const rebuild = rebuildDirtyPages(
      result,
      { minX: x - r - 4, maxX: x + r + 4, minZ: z - r - 4, maxZ: z + r + 4 },
      cfg,
    );

    expect(rebuild.lod0Pages).toBe(2); // pages (0,0) and (1,0)
    expect(rebuild.parentNodes).toBe(1); // the single LOD1 root
    expect(a.mesh.indices.length).not.toBe(trisBefore);

    // the dug border chain must still match exactly between the two pages (gate A2)
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

    // raise solid (painted material 1) across the x=32 page border
    const x = 32, z = 16, r = 4;
    addDigEdit({ x, y: surfaceHeight(x, z), z, r, op: "add", material: 1 });
    // a per-edit material mismatch at the seam would hard-fail the weld here
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
    const y = surfaceHeight(x, z) - 12; // fully below the surface band
    const r = 4;
    addDigEdit({ x, y, z, r });
    // rebuild throws ClodBuildError on any weld conflict / open internal border
    const rebuild = rebuildDirtyPages(
      result,
      { minX: x - r - 4, maxX: x + r + 4, minZ: z - r - 4, maxZ: z + r + 4 },
      cfg,
    );

    expect(rebuild.lod0Pages).toBeGreaterThanOrEqual(1);
    expect(node.mesh.indices.length).toBeGreaterThan(trisBefore);
  });

  it("per-chunk rebuild re-meshes only the touched chunks, identical to a full page rebuild", () => {
    const world = { cellsX: 2 * cfg.page.chunks_per_page * cfg.page.chunk_size, cellsZ: 2 * cfg.page.chunks_per_page * cfg.page.chunk_size };
    const result = buildWorld(2, 2, cfg);
    const node = result.nodesByLevel.get(0)!.find((n) => n.id === "L0:0,0")!;

    // dig deep inside chunk (0,0) so its 6-cell reach can't touch the other 3 chunks
    const x = 6, z = 6, r = 2;
    const y = surfaceHeight(x, z) - 4;
    addDigEdit({ x, y, z, r });
    const margin = r + 4;
    const dirty = { minX: x - margin, maxX: x + margin, minZ: z - margin, maxZ: z + margin };

    const lod0 = rebuildDirtyLod0Pages(result, dirty, cfg, buildNodeIndex(result));
    expect(lod0.chunksTotal).toBe(cfg.page.chunks_per_page ** 2); // 4 chunks in the page
    expect(lod0.chunksRemeshed).toBe(1); // only chunk (0,0)

    // the per-chunk welded page must equal a from-scratch full extract of the same page
    const full = buildLod0PageSource(0, 0, cfg, world);
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
  }, 20000);
});
