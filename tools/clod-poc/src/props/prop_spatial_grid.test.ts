import { describe, expect, it } from "vitest";
import placementsYaml from "../../config/custom_prop_placements.yaml?raw";
import { parsePropPlacements } from "./prop_placements.js";
import { PropSpatialGrid } from "./prop_spatial_grid.js";

describe("PropSpatialGrid", () => {
  it("groups instances into 64m cells", () => {
    const scene = parsePropPlacements(placementsYaml);
    const grid = PropSpatialGrid.fromInstances(scene.instances, 64);
    expect(grid.cells.size).toBeGreaterThan(0);
    expect(grid.instances.every((i) => i.cellCoord)).toBe(true);
    const totalIndexed = [...grid.cells.values()].reduce((sum, c) => sum + c.instanceIndices.length, 0);
    expect(totalIndexed).toBe(scene.instances.length);
  });
});
