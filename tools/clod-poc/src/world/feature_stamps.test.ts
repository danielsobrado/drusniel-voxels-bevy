import { describe, expect, it } from "vitest";
import type { WorldMetadataRecord } from "../save/save_schema.js";
import { buildCarvedHeightfieldTile } from "./heightfield_tiles/heightfield_tile_carve.js";
import { compileFeatureStamps, terrainSourceHashWithFeatureStamps } from "./feature_stamps.js";

function metadata(): WorldMetadataRecord {
  return {
    schemaVersion: 2, cities: [], districts: [], caveEntrances: [], caveSystems: [], criticalPaths: [], revision: 1,
    roads: [{ id: "hill-road", points: [[0, 12, 128], [256, 12, 128]], widthM: 8, materialId: 1, roadType: "dirt", connectedCityIds: [], revision: 1 }],
  };
}

describe("authored feature stamps", () => {
  it("compiles deterministically, flattens after carve, and clears scatter", () => {
    const a = compileFeatureStamps(metadata());
    const b = compileFeatureStamps(metadata());
    expect(a.hash).toBe(b.hash);
    const tile = buildCarvedHeightfieldTile(
      { x: 0, z: 0 }, { sampleHeight: (x) => 40 + x * 0.1 },
      { carveHeight: (_x: number, _z: number, height: number) => height - 2 } as never, {} as never, 1, a,
    );
    expect(tile.heights[128 * tile.res + 128]).toBeCloseTo(12);
    expect(a.excludesScatter(128, 128)).toBe(true);
    expect(a.excludesScatter(128, 150)).toBe(false);
    expect(a.sampleStructureCoverage(128, 128, 8)).toBe(1);
    expect(terrainSourceHashWithFeatureStamps("terrain", a)).toBe(terrainSourceHashWithFeatureStamps("terrain", b));
  });
});
