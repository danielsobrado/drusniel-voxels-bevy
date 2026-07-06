import { describe, expect, it } from "vitest";
import { assertWorldMetadataRecord, createEmptyWorldMetadataRecord, type WorldMetadataRecord } from "../metadata_schema.js";
import {
  boundsForRegion,
  caveEntranceBounds,
  criticalPathBounds,
  regionKeysForBounds,
  roadBounds,
  WorldMetadataStore,
} from "../metadata_store.js";

function metadata(): WorldMetadataRecord {
  return {
    schemaVersion: 1,
    revision: 3,
    cities: [{
      id: "city-1",
      name: "Gate Town",
      center: [256, 20, 256],
      radiusM: 80,
      districtIds: ["district-1"],
      roadIds: ["road-1"],
      criticalPathIds: ["path-1"],
      revision: 1,
    }],
    districts: [{
      id: "district-1",
      cityId: "city-1",
      name: "Market",
      bounds: { minX: 200, minZ: 200, maxX: 300, maxZ: 300 },
      tags: ["trade"],
    }],
    roads: [{
      id: "road-1",
      points: [[240, 20, 240], [700, 21, 240]],
      widthM: 8,
      materialId: 1,
      roadType: "dirt",
      connectedCityIds: ["city-1"],
      criticalPathId: "path-1",
      revision: 1,
    }],
    caveEntrances: [{
      id: "entrance-1",
      position: [-16, 15, -16],
      facing: [0, 0, 1],
      caveSystemId: "cave-1",
      linkedCriticalPathId: "path-1",
      farMaskRadiusM: 32,
      revision: 1,
    }],
    caveSystems: [{
      id: "cave-1",
      entranceIds: ["entrance-1"],
      proceduralSeed: 99,
      authored: true,
      criticalPathIds: ["path-1"],
      revision: 1,
    }],
    criticalPaths: [{
      id: "path-1",
      name: "Gate Route",
      purpose: "cityAccess",
      points: [[-16, 20, -16], [256, 20, 256], [700, 21, 240]],
      linkedRoadIds: ["road-1"],
      linkedPropIds: ["p_000001_ab12"],
      mustRemainPassable: true,
      status: "valid",
      revision: 1,
    }],
  };
}

describe("world metadata store", () => {
  it("creates and counts a single world-level metadata record", () => {
    const store = new WorldMetadataStore(metadata());

    expect(store.counts()).toEqual({
      cities: 1,
      districts: 1,
      roads: 1,
      caveEntrances: 1,
      caveSystems: 1,
      criticalPaths: 1,
    });
    expect(createEmptyWorldMetadataRecord().schemaVersion).toBe(1);
  });

  it("fails loud on dangling links", () => {
    const broken = metadata();
    broken.roads[0] = { ...broken.roads[0]!, connectedCityIds: ["missing-city"] };

    expect(() => assertWorldMetadataRecord(broken)).toThrow(/dangling city/i);
    expect(() => new WorldMetadataStore(broken)).toThrow(/dangling city/i);
  });

  it("derives region membership from bounds instead of stored region arrays", () => {
    const store = new WorldMetadataStore(metadata());
    const rows = store.entityRegionKeys();
    const road = rows.find((row) => row.kind === "roads" && row.id === "road-1");
    const cave = rows.find((row) => row.kind === "caveSystems" && row.id === "cave-1");

    expect(road?.regionKeys).toEqual(["r_0_0", "r_1_0"]);
    expect(cave?.regionKeys).toEqual(["r_-1_-1", "r_-1_0", "r_0_-1", "r_0_0", "r_1_-1", "r_1_0"]);
    expect(Object.prototype.hasOwnProperty.call(store.get().cities[0] ?? {}, "regionKeys")).toBe(false);
  });

  it("queries all metadata linked to a region", () => {
    const store = new WorldMetadataStore(metadata());
    const nearCity = store.queryRegion("r_0_0");
    const caveRegion = store.queryRegion("r_-1_-1");

    expect(nearCity.cities.map((city) => city.id)).toEqual(["city-1"]);
    expect(nearCity.roads.map((road) => road.id)).toEqual(["road-1"]);
    expect(nearCity.criticalPaths.map((path) => path.id)).toEqual(["path-1"]);
    expect(caveRegion.caveEntrances.map((entrance) => entrance.id)).toEqual(["entrance-1"]);
    expect(caveRegion.caveSystems.map((system) => system.id)).toEqual(["cave-1"]);
  });

  it("returns defensive copies from getters and queries", () => {
    const store = new WorldMetadataStore(metadata());
    const city = store.cityById("city-1");
    if (!city) throw new Error("city fixture missing");
    city.name = "Mutated";
    const query = store.queryRegion("r_0_0");
    query.cities[0]!.name = "Mutated Again";

    expect(store.cityById("city-1")?.name).toBe("Gate Town");
  });

  it("exposes reusable bounds helpers for metadata systems", () => {
    const fixture = metadata();

    expect(boundsForRegion("r_-1_0")).toEqual({ minX: -512, minZ: 0, maxX: 0, maxZ: 512 });
    expect(regionKeysForBounds({ minX: -0.5, minZ: -0.5, maxX: 512, maxZ: 1 })).toEqual(["r_-1_-1", "r_-1_0", "r_0_-1", "r_0_0"]);
    expect(roadBounds(fixture.roads[0]!).maxX).toBe(704);
    expect(caveEntranceBounds(fixture.caveEntrances[0]!)).toEqual({ minX: -48, minZ: -48, maxX: 16, maxZ: 16 });
    expect(criticalPathBounds(fixture.criticalPaths[0]!).maxX).toBe(700);
  });
});
