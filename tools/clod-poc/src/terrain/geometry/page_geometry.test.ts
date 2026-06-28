import { afterEach, describe, expect, it } from "vitest";
import type { PageMesh } from "../../types.js";
import { setTerrainFieldConfig } from "../terrain.js";
import { BIOME_IDS, BiomeRegionField } from "../../world_source/biome_region_field.js";
import { biomeIdsFor, toGeometry } from "./page_geometry.js";

afterEach(() => {
  setTerrainFieldConfig(null);
});

describe("terrain page geometry biome attributes", () => {
  it("colors terrain debug from BiomeRegionField ids", () => {
    setTerrainFieldConfig({ seed: 7, seaLevel: 18 });
    const mesh: PageMesh = {
      positions: new Float32Array([
        0, 10, 0,
        16, 18, 0,
        32, 90, 0,
      ]),
      normals: new Float32Array([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      ]),
      paintSlots: new Float32Array([0, 0, 0]),
      materialWeights: new Float32Array([
        1, 0, 0, 0,
        1, 0, 0, 0,
        1, 0, 0, 0,
      ]),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 1, 2]),
    };

    const biomeIds = biomeIdsFor(mesh);
    const expected = new BiomeRegionField({ seed: 7, seaLevel: 18 }).sample(32, 0, 90).biome;
    expect([...biomeIds]).toEqual([BIOME_IDS.ocean, BIOME_IDS.coast, expected]);
    const geometry = toGeometry(mesh);
    expect([...(geometry.getAttribute("biomeId").array as Float32Array)]).toEqual([...biomeIds]);
    geometry.dispose();
  });
});
