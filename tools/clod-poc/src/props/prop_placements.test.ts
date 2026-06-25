import { describe, expect, it } from "vitest";
import placementsYaml from "../../config/custom_prop_placements.yaml?raw";
import { assignPropCellCoords, parsePropPlacements, resolvePropPlacementScene } from "./prop_placements.js";

describe("parsePropPlacements", () => {
  it("parses the smoke placement scene", () => {
    const scene = parsePropPlacements(placementsYaml);
    expect(scene.schemaVersion).toBe(1);
    expect(scene.sceneId).toBe("poc_smoke_500");
    expect(scene.instances).toHaveLength(3);
    expect(scene.instances[0]?.assetId).toBe("crate_a");
  });

  it("assigns spatial cell coords from world position", () => {
    const scene = parsePropPlacements(placementsYaml);
    const withCells = assignPropCellCoords(scene.instances, 64);
    expect(withCells[0]?.cellCoord).toEqual([0, 0]);
    expect(withCells[2]?.cellCoord).toEqual([1, -1]);
  });

  it("resolves bench scenes from query params", () => {
    const scenes = {
      smoke: parsePropPlacements(placementsYaml),
      "500": { schemaVersion: 1, sceneId: "poc_bench_500", instances: [] },
    };
    const params = new URLSearchParams("customPropScene=500");
    const scene = resolvePropPlacementScene(params, scenes, scenes.smoke);
    expect(scene.sceneId).toBe("poc_bench_500");
  });
});
