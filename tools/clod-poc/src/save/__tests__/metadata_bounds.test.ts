import { describe, expect, it } from "vitest";
import type { WorldMetadataRecord } from "../save_schema.js";
import { regionKeysForBounds, WorldMetadataStore } from "../world_metadata/metadata_store.js";

function metadataWithCities(cities: WorldMetadataRecord["cities"]): WorldMetadataRecord {
  return {
    schemaVersion: 1,
    cities,
    districts: [],
    roads: [],
    caveEntrances: [],
    caveSystems: [],
    criticalPaths: [],
    revision: 1,
  };
}

describe("regionKeysForBounds", () => {
  it("maps exact positive area boundary as half-open", () => {
    expect(regionKeysForBounds({ minX: 0, minZ: 0, maxX: 512, maxZ: 512 })).toEqual(["r_0_0"]);
  });

  it("maps exact point bounds normally", () => {
    expect(regionKeysForBounds({ minX: 512, minZ: 0, maxX: 512, maxZ: 0 })).toEqual(["r_1_0"]);
  });

  it("maps exact negative area boundary as half-open", () => {
    expect(regionKeysForBounds({ minX: -512, minZ: -512, maxX: 0, maxZ: 0 })).toEqual(["r_-1_-1"]);
  });

  it("maps small area across the origin to four regions", () => {
    expect(regionKeysForBounds({ minX: -0.5, minZ: -0.5, maxX: 0.5, maxZ: 0.5 })).toEqual(["r_-1_-1", "r_-1_0", "r_0_-1", "r_0_0"]);
  });

  it("keeps tiny cross-boundary bounds on both sides", () => {
    expect(regionKeysForBounds({ minX: 511.99999995, minZ: 0, maxX: 512.00000005, maxZ: 1 })).toEqual(["r_0_0", "r_1_0"]);
  });
});

describe("WorldMetadataStore region queries", () => {
  it("does not query area bounds ending exactly on a region boundary from the next region", () => {
    const store = new WorldMetadataStore(metadataWithCities([{
      id: "city-0",
      name: "Boundary City",
      center: [256, 0, 256],
      radiusM: 256,
      districtIds: [],
      roadIds: [],
      criticalPathIds: [],
      revision: 1,
    }]));

    expect(store.entityRegionKeys()).toEqual([{ kind: "cities", id: "city-0", regionKeys: ["r_0_0"] }]);
    expect(store.queryRegion("r_0_0").cities.map((city) => city.id)).toEqual(["city-0"]);
    expect(store.queryRegion("r_1_0").cities).toEqual([]);
  });

  it("queries point metadata on a region boundary only from the owning region", () => {
    const store = new WorldMetadataStore(metadataWithCities([{
      id: "point-city",
      name: "Point City",
      center: [512, 0, 0],
      radiusM: 0,
      districtIds: [],
      roadIds: [],
      criticalPathIds: [],
      revision: 1,
    }]));

    expect(store.entityRegionKeys()).toEqual([{ kind: "cities", id: "point-city", regionKeys: ["r_1_0"] }]);
    expect(store.queryRegion("r_0_0").cities).toEqual([]);
    expect(store.queryRegion("r_1_0").cities.map((city) => city.id)).toEqual(["point-city"]);
  });
});
