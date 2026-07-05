import { describe, expect, it } from "vitest";
import {
  assertRegionManifest,
  assertRegionRecordSet,
  assertRegionVoxelDeltas,
  assertSavedPropInstance,
  assertSaveWorldManifest,
  assertWorldMetadataPropLinks,
  assertWorldMetadataRecord,
  type RegionManifest,
  type RegionVoxelDeltas,
  type SavedPropInstance,
  type SaveWorldManifest,
  type WorldMetadataRecord,
} from "../save_schema.js";
import { encodeVoxelDeltasBin1 } from "../voxel_delta_binary.js";

function manifest(): SaveWorldManifest {
  return {
    schemaVersion: 1,
    saveId: "qa-roundtrip",
    worldId: "world-1",
    seed: 1,
    proceduralProfile: "infinite-islands-v1",
    regionSizeM: 512,
    chunkSizeM: 16,
    regionKeys: ["r_0_0"],
    createdAt: "2026-07-05T00:00:00.000Z",
    updatedAt: "2026-07-05T00:00:01.000Z",
  };
}

function regionManifest(): RegionManifest {
  return {
    schemaVersion: 1,
    regionKey: "r_0_0",
    rx: 0,
    rz: 0,
    revision: 2,
    authorityRevision: 9,
    voxelDeltaCount: 1,
    propCount: 1,
    updatedAt: "2026-07-05T00:00:01.000Z",
  };
}

function prop(): SavedPropInstance {
  return {
    id: "p_000001_ab12",
    prefabId: "building/wall",
    position: [1, 2, 3],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    anchor: "terrain",
    seed: 10,
    variationId: 2,
    flags: 0,
    revision: 9,
    regionKey: "r_0_0",
    state: "active",
    tags: [],
    cityId: "city-1",
  };
}

function metadata(): WorldMetadataRecord {
  return {
    schemaVersion: 1,
    cities: [{ id: "city-1", name: "Gate Town", center: [0, 0, 0], radiusM: 64, districtIds: ["district-1"], roadIds: ["road-1"], criticalPathIds: ["path-1"], revision: 1 }],
    districts: [{ id: "district-1", cityId: "city-1", name: "Harbor", bounds: { minX: 0, minZ: 0, maxX: 10, maxZ: 10 }, tags: [] }],
    roads: [{ id: "road-1", points: [[0, 0, 0], [8, 0, 8]], widthM: 4, materialId: 1, roadType: "dirt", connectedCityIds: ["city-1"], criticalPathId: "path-1", revision: 1 }],
    caveEntrances: [{ id: "entrance-1", position: [3, 4, 5], facing: [0, 0, 1], caveSystemId: "cave-1", linkedCriticalPathId: "path-1", farMaskRadiusM: 24, revision: 1 }],
    caveSystems: [{ id: "cave-1", entranceIds: ["entrance-1"], proceduralSeed: 99, authored: true, criticalPathIds: ["path-1"], revision: 1 }],
    criticalPaths: [{ id: "path-1", name: "Main Gate", purpose: "cityAccess", points: [[0, 2, 0], [8, 2, 8]], linkedRoadIds: ["road-1"], linkedPropIds: [], mustRemainPassable: true, status: "valid", revision: 1 }],
    revision: 1,
  };
}

describe("save schemas", () => {
  it("accepts the v1 manifest and rejects wrong chunk size", () => {
    expect(() => assertSaveWorldManifest(manifest())).not.toThrow();
    expect(() => assertSaveWorldManifest({ ...manifest(), chunkSizeM: 32 })).toThrow(/chunkSizeM/i);
  });

  it("validates region records and rejects count mismatch", () => {
    const region = regionManifest();
    const deltas: RegionVoxelDeltas = { schemaVersion: 1, regionKey: "r_0_0", format: "json", deltas: [{ x: 1, y: 2, z: 3, density: 0.5, materialSlot: 2, revision: 9 }] };
    const props = [prop()];

    expect(() => assertRegionManifest(region)).not.toThrow();
    expect(() => assertRegionVoxelDeltas(deltas)).not.toThrow();
    expect(() => assertRegionRecordSet(region, deltas, props)).not.toThrow();
    expect(() => assertRegionRecordSet({ ...region, voxelDeltaCount: 2 }, deltas, props)).toThrow(/count/i);
  });

  it("accepts binary voxel payloads after SV-10", () => {
    const payload = encodeVoxelDeltasBin1([{ x: -1, y: 2, z: -3, density: 0.5, materialSlot: 2, revision: 9 }]);
    expect(() => assertRegionVoxelDeltas({ schemaVersion: 1, regionKey: "r_0_0", format: "bin1", payload })).not.toThrow();
  });

  it("round-trips a prop with a factory id shape", () => {
    expect(() => assertSavedPropInstance(prop())).not.toThrow();
    expect(() => assertSavedPropInstance({ ...prop(), tags: undefined })).toThrow(/tags/i);
    expect(() => assertSavedPropInstance({ ...prop(), scale: [1, 0, 1] })).toThrow(/scale/i);
  });

  it("rejects dangling and malformed world metadata", () => {
    expect(() => assertWorldMetadataRecord(metadata())).not.toThrow();
    const brokenLink = metadata();
    brokenLink.cities[0] = { ...brokenLink.cities[0]!, roadIds: ["missing-road"] };
    expect(() => assertWorldMetadataRecord(brokenLink)).toThrow(/dangling road/i);

    const brokenShape = metadata();
    brokenShape.roads[0] = { ...brokenShape.roads[0]!, points: [] };
    expect(() => assertWorldMetadataRecord(brokenShape)).toThrow(/points/i);
  });

  it("rejects negative metadata radii and widths", () => {
    const negativeCity = metadata();
    negativeCity.cities[0] = { ...negativeCity.cities[0]!, radiusM: -1 };
    expect(() => assertWorldMetadataRecord(negativeCity)).toThrow(/radiusM/i);

    const negativeRoad = metadata();
    negativeRoad.roads[0] = { ...negativeRoad.roads[0]!, widthM: -1 };
    expect(() => assertWorldMetadataRecord(negativeRoad)).toThrow(/widthM/i);

    const negativeEntrance = metadata();
    negativeEntrance.caveEntrances[0] = { ...negativeEntrance.caveEntrances[0]!, farMaskRadiusM: -1 };
    expect(() => assertWorldMetadataRecord(negativeEntrance)).toThrow(/farMaskRadiusM/i);
  });

  it("validates metadata prop links against loaded saved props", () => {
    const withPropLink = metadata();
    withPropLink.criticalPaths[0] = { ...withPropLink.criticalPaths[0]!, linkedPropIds: ["p_000001_ab12"] };

    expect(() => assertWorldMetadataPropLinks(withPropLink, new Set(["p_000001_ab12"]))).not.toThrow();
    expect(() => assertWorldMetadataPropLinks(withPropLink, new Set())).toThrow(/prop/i);
  });
});
