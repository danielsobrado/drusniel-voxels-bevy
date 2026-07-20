import { describe, expect, it } from "vitest";
import treeRingSource from "./shaders/tree_ring.compute.wgsl?raw";
import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import { packTreeGpuRingParams } from "./tree_ring_compute.js";
import { composeTreeRingShader } from "./wgsl_modules.js";
import { DEFAULT_TREE_SETTINGS, TREE_LODS, TREE_SPECIES, type TreeLod, type TreeSpeciesId } from "../trees/tree_config.js";

function indexCounts(): Record<TreeSpeciesId, Record<TreeLod, number>> {
  const result = {} as Record<TreeSpeciesId, Record<TreeLod, number>>;
  for (const species of TREE_SPECIES) {
    result[species] = {} as Record<TreeLod, number>;
    for (const lod of TREE_LODS) result[species][lod] = 0;
  }
  return result;
}

describe("tree canonical canopy competition WGSL", () => {
  it("adds one sampled texture and preserves synthetic fail-open fallback", () => {
    const composed = composeTreeRingShader();

    expect(treeRingSource).not.toContain("sample_tree_canopy_competition");
    expect(composed).toContain("canopy_competition: vec4<f32>");
    expect(composed).toContain("@binding(17) var canopy_competition_texture: texture_2d<f32>");
    expect(composed).toContain("fn sample_tree_canopy_competition");
    expect(composed).toContain("textureLoad(canopy_competition_texture");
    expect(composed).toContain("mix(synthetic_pressure, canonical.x, canonical.y)");
    expect(composed).toContain("params.settings_u.z ^ 0x1005u ^ species");
  });

  it("packs canonical field dimensions and activation after the hydrology atlas", () => {
    const layout = treeRingSpeciesLayout(TREE_SPECIES.length, 4);
    const packed = packTreeGpuRingParams(DEFAULT_TREE_SETTINGS, {
      centerX: 0,
      centerZ: 0,
      cameraY: 0,
      worldCells: 256,
      maxInstancesPerGroup: 1,
      indexCounts: indexCounts(),
      canopyCompetition: [512, 128, 1, 0],
    });
    const values = new Float32Array(packed);

    expect(layout.canopyCompetitionOffset).toBe(layout.hydroAtlasOffset + 4);
    expect(Array.from(values.slice(layout.canopyCompetitionOffset, layout.canopyCompetitionOffset + 4)))
      .toEqual([512, 128, 1, 0]);
  });

  it("fails open when no canonical field is supplied", () => {
    const layout = treeRingSpeciesLayout(TREE_SPECIES.length, 4);
    const packed = packTreeGpuRingParams(DEFAULT_TREE_SETTINGS, {
      centerX: 0,
      centerZ: 0,
      cameraY: 0,
      worldCells: 256,
      maxInstancesPerGroup: 1,
      indexCounts: indexCounts(),
    });
    const values = new Float32Array(packed);

    expect(Array.from(values.slice(layout.canopyCompetitionOffset, layout.canopyCompetitionOffset + 4)))
      .toEqual([1, 1, 0, 0]);
  });
});
