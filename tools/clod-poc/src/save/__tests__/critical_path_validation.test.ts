import { describe, expect, it } from "vitest";
import { assertCriticalPathValidation, validateCriticalPaths } from "../critical_path_validation.js";
import type { WorldMetadataRecord } from "../save_schema.js";

function metadata(): WorldMetadataRecord {
  return {
    schemaVersion: 1,
    cities: [],
    districts: [],
    roads: [{
      id: "road-1",
      points: [[0, 0, 0], [8, 0, 8]],
      widthM: 4,
      materialId: 1,
      roadType: "dirt",
      connectedCityIds: [],
      criticalPathId: "path-1",
      revision: 1,
    }],
    caveEntrances: [{
      id: "entrance-1",
      position: [4, 0, 4],
      facing: [0, 0, 1],
      caveSystemId: "cave-1",
      linkedCriticalPathId: "path-1",
      farMaskRadiusM: 8,
      revision: 1,
    }],
    caveSystems: [{
      id: "cave-1",
      entranceIds: ["entrance-1"],
      proceduralSeed: 1,
      authored: true,
      criticalPathIds: ["path-1"],
      revision: 1,
    }],
    criticalPaths: [{
      id: "path-1",
      name: "Gate path",
      purpose: "cityAccess",
      points: [[0, 0, 0], [8, 0, 8]],
      linkedRoadIds: ["road-1"],
      linkedPropIds: ["p_000001_ab12"],
      mustRemainPassable: true,
      status: "valid",
      revision: 1,
    }],
    revision: 1,
  };
}

describe("critical path validation", () => {
  it("passes a valid critical path", () => {
    const result = validateCriticalPaths(metadata(), {
      propIds: new Set(["p_000001_ab12"]),
      nowMs: () => 5,
    });

    expect(result).toEqual({
      errors: [],
      warnings: [],
      touchedCriticalPathIds: ["path-1"],
      durationMs: 0,
    });
    expect(() => assertCriticalPathValidation(result)).not.toThrow();
  });

  it("fails hard for missing linked roads, props, empty points, and cave links", () => {
    const broken = metadata();
    broken.criticalPaths[0] = {
      ...broken.criticalPaths[0]!,
      points: [],
      linkedRoadIds: ["missing-road"],
      linkedPropIds: ["missing-prop"],
    };
    broken.caveSystems[0] = { ...broken.caveSystems[0]!, entranceIds: ["missing-entrance"] };

    const result = validateCriticalPaths(broken, { propIds: new Set(), nowMs: () => 1 });

    expect(result.errors.map((entry) => entry.code)).toEqual([
      "empty_points",
      "missing_cave_entrance",
      "missing_prop",
      "missing_road",
    ]);
    expect(() => assertCriticalPathValidation(result)).toThrow(/critical path path-1/);
  });

  it("keeps warning statuses non-blocking unless configured", () => {
    const warning = metadata();
    warning.criticalPaths[0] = { ...warning.criticalPaths[0]!, status: "warning" };

    const result = validateCriticalPaths(warning, {
      propIds: new Set(["p_000001_ab12"]),
      nowMs: () => 1,
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((entry) => entry.code)).toEqual(["status_warning"]);
    expect(() => assertCriticalPathValidation(result)).not.toThrow();
    expect(() => assertCriticalPathValidation(result, { blockWarnings: true })).toThrow(/status is warning/);
  });
});

