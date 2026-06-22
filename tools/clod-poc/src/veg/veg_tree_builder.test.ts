import { describe, expect, it } from "vitest";
import { buildTree, type VegLod } from "./veg_tree_builder.js";
import { vegRng } from "./veg_rng.js";
import { VEG_BARK_COLOR, VEG_TREE_SPECIES } from "./veg_species.js";

const SPECIES = ["oak", "pine", "dead"] as const;
const LODS: VegLod[] = [0, 1, 2];

describe("veg tree builder", () => {
  it("builds bark + foliage with the clod-poc attribute contract", () => {
    const sp = VEG_TREE_SPECIES.oak;
    const { geometry, stats } = buildTree(sp, vegRng(1, "oak"), { lod: 0, barkColor: VEG_BARK_COLOR.oak });
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(geometry.getAttribute("treeWind").itemSize).toBe(2);
    expect(geometry.getAttribute("treeFoliageMask")).toBeTruthy();
    expect(stats.branches).toBeGreaterThan(1);
    expect(stats.anchors).toBeGreaterThan(0);
    // both bark (mask 0) and foliage (mask 1) verts present
    const mask = geometry.getAttribute("treeFoliageMask");
    let min = 1;
    let max = 0;
    for (let i = 0; i < mask.count; i++) {
      min = Math.min(min, mask.getX(i));
      max = Math.max(max, mask.getX(i));
    }
    expect(min).toBe(0);
    expect(max).toBe(1);
  });

  it("is deterministic per seed", () => {
    const a = buildTree(VEG_TREE_SPECIES.pine, vegRng(5, "pine"), { lod: 0, barkColor: VEG_BARK_COLOR.pine });
    const b = buildTree(VEG_TREE_SPECIES.pine, vegRng(5, "pine"), { lod: 0, barkColor: VEG_BARK_COLOR.pine });
    expect(a.geometry.getAttribute("position").count).toBe(b.geometry.getAttribute("position").count);
    expect(a.stats).toEqual(b.stats);
  });

  it("lower LODs reduce vertex count", () => {
    const counts = LODS.map((lod) => buildTree(VEG_TREE_SPECIES.oak, vegRng(9, "oak"), { lod, barkColor: VEG_BARK_COLOR.oak }).geometry.getAttribute("position").count);
    expect(counts[1]).toBeLessThan(counts[0]);
    expect(counts[2]).toBeLessThan(counts[1]);
  });

  it("dead snag has no foliage (all bark)", () => {
    const { geometry, stats } = buildTree(VEG_TREE_SPECIES.dead, vegRng(3, "dead"), { lod: 0, barkColor: VEG_BARK_COLOR.dead });
    expect(stats.anchors).toBe(0);
    const mask = geometry.getAttribute("treeFoliageMask");
    for (let i = 0; i < mask.count; i++) expect(mask.getX(i)).toBe(0);
  });

  it("reports per-species/per-LOD vertex counts (budget reconnaissance)", () => {
    const report: Record<string, Record<number, number>> = {};
    for (const sp of SPECIES) {
      report[sp] = {};
      for (const lod of LODS) {
        const built = buildTree(VEG_TREE_SPECIES[sp], vegRng(42, sp), { lod, barkColor: VEG_BARK_COLOR[sp] });
        report[sp]![lod] = built.geometry.getAttribute("position").count;
      }
    }
    // eslint-disable-next-line no-console
    console.log("[veg tree vertex counts]", JSON.stringify(report));
    for (const sp of SPECIES) for (const lod of LODS) expect(report[sp]![lod]).toBeGreaterThan(0);
  });
});
