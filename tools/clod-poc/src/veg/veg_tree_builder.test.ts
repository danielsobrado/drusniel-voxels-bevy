import { describe, expect, it } from "vitest";
import { buildTree, type VegLod } from "./veg_tree_builder.js";
import { vegRng } from "./veg_rng.js";
import { VEG_BARK_COLOR, VEG_TREE_SPECIES } from "./veg_species.js";

const SPECIES = ["oak", "pine", "dead", "birch", "willow", "spruce"] as const;
const LODS: VegLod[] = [0, 1, 2];

function foliageCounts(geometry: import("three").BufferGeometry): { cards: number; real: number } {
  const mask = geometry.getAttribute("treeFoliageMask");
  const card = geometry.getAttribute("treeFoliageCard");
  let cards = 0;
  let real = 0;
  for (let index = 0; index < mask.count; index++) {
    if (mask.getX(index) <= 0.5) continue;
    if (card.getX(index) > 0.5) cards++;
    else real++;
  }
  return { cards, real };
}

describe("veg tree builder", () => {
  it("builds bark, cards and real foliage in the hero LOD", () => {
    const species = VEG_TREE_SPECIES.oak;
    const { geometry, stats } = buildTree(species, vegRng(1, "oak"), {
      lod: 0,
      barkColor: VEG_BARK_COLOR.oak,
    });
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
    expect(geometry.getAttribute("treeWind").itemSize).toBe(2);
    expect(geometry.getAttribute("treeFoliageMask")).toBeTruthy();
    expect(geometry.getAttribute("treeFoliageCard")).toBeTruthy();
    expect(stats.branches).toBeGreaterThan(1);
    expect(stats.anchors).toBeGreaterThan(0);

    const counts = foliageCounts(geometry);
    expect(counts.cards).toBeGreaterThan(0);
    expect(counts.real).toBeGreaterThan(0);
  });

  it("uses captured-cluster cards without real leaf meshes in mid and far LODs", () => {
    for (const lod of [1, 2] as const) {
      const { geometry } = buildTree(VEG_TREE_SPECIES.oak, vegRng(12, "oak"), {
        lod,
        barkColor: VEG_BARK_COLOR.oak,
      });
      const counts = foliageCounts(geometry);
      expect(counts.cards).toBeGreaterThan(0);
      expect(counts.real).toBe(0);
    }
  });

  it("is deterministic per seed", () => {
    const a = buildTree(VEG_TREE_SPECIES.pine, vegRng(5, "pine"), { lod: 0, barkColor: VEG_BARK_COLOR.pine });
    const b = buildTree(VEG_TREE_SPECIES.pine, vegRng(5, "pine"), { lod: 0, barkColor: VEG_BARK_COLOR.pine });
    expect(a.geometry.getAttribute("position").count).toBe(b.geometry.getAttribute("position").count);
    expect(a.geometry.getAttribute("treeFoliageCard").count).toBe(b.geometry.getAttribute("treeFoliageCard").count);
    expect(a.stats).toEqual(b.stats);
  });

  it("lower LODs reduce vertex count", () => {
    const counts = LODS.map((lod) => buildTree(VEG_TREE_SPECIES.oak, vegRng(9, "oak"), {
      lod,
      barkColor: VEG_BARK_COLOR.oak,
    }).geometry.getAttribute("position").count);
    expect(counts[1]).toBeLessThan(counts[0]);
    expect(counts[2]).toBeLessThan(counts[1]);
  });

  it("dead snag has no foliage or foliage cards", () => {
    const { geometry, stats } = buildTree(VEG_TREE_SPECIES.dead, vegRng(3, "dead"), {
      lod: 0,
      barkColor: VEG_BARK_COLOR.dead,
    });
    expect(stats.anchors).toBe(0);
    const counts = foliageCounts(geometry);
    expect(counts.cards).toBe(0);
    expect(counts.real).toBe(0);
  });

  it("keeps all six species structurally distinct", () => {
    const signatures = SPECIES.map((species) => {
      const built = buildTree(VEG_TREE_SPECIES[species], vegRng(42, species), {
        lod: 0,
        barkColor: VEG_BARK_COLOR[species],
      });
      return `${built.stats.branches}:${built.stats.anchors}:${built.geometry.getAttribute("position").count}`;
    });
    expect(new Set(signatures).size).toBe(SPECIES.length);
  });

  it("reports per-species and per-LOD vertex counts", () => {
    const report: Record<string, Record<number, number>> = {};
    for (const species of SPECIES) {
      report[species] = {};
      for (const lod of LODS) {
        const built = buildTree(VEG_TREE_SPECIES[species], vegRng(42, species), {
          lod,
          barkColor: VEG_BARK_COLOR[species],
        });
        report[species]![lod] = built.geometry.getAttribute("position").count;
      }
    }
    // eslint-disable-next-line no-console
    console.log("[veg tree vertex counts]", JSON.stringify(report));
    for (const species of SPECIES) {
      for (const lod of LODS) expect(report[species]![lod]).toBeGreaterThan(0);
    }
  });
});
