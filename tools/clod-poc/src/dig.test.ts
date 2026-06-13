// Dig-edit coverage: the carve overlay stays a pure function of (x,y,z) so the
// builder invariants (weld, locked borders, watertight assertions) must survive a
// targeted rebuild of the dug pages and their ancestors.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { addDigEdit, clearDigEdits, density, surfaceHeight } from "./terrain.js";
import { buildWorld, rebuildDirtyPages } from "./quadtree.js";
import { initSimplifier } from "./simplify.js";
import { assertBorderMatch, borderChain } from "./validate.js";
import type { ClodPagesConfig } from "./config.js";

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
  selection: {
    error_threshold_px: 1,
    hysteresis_merge_factor: 1.5,
    neighbor_level_delta_max: 1,
    crossfade_frames: 12,
  },
  near_field: { radius_chunks: 6 },
  meshopt_package_version: "0.22.0",
};

afterEach(clearDigEdits);

describe("dig edits in the density field", () => {
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
});
