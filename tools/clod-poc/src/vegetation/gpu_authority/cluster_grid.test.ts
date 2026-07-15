import { describe, expect, it } from "vitest";
import { VEGETATION_CATEGORY } from "./constants.js";
import {
  candidateCellRangeForCluster,
  candidateCountForCluster,
  clusterCoordinatesForWorld,
  vegetationClusterId,
} from "./cluster_grid.js";

describe("vegetation authority cluster grid", () => {
  it("keeps world-anchored cluster coordinates stable across camera movement", () => {
    expect(clusterCoordinatesForWorld(31.999, -0.001, 32)).toEqual({ clusterX: 0, clusterZ: -1 });

    const identity = {
      worldSeed: 0xfeedbeef,
      schemaVersion: 1,
      category: VEGETATION_CATEGORY.TREE,
      clusterX: -7,
      clusterZ: 12,
    } as const;
    expect(vegetationClusterId(identity)).toEqual(vegetationClusterId(identity));
    expect(vegetationClusterId(identity)).not.toEqual(vegetationClusterId({
      ...identity,
      category: VEGETATION_CATEGORY.GRASS,
    }));
  });

  it("uses exact half-open lattice ownership when spacing does not divide 32 m", () => {
    const left = candidateCellRangeForCluster(-1, 32, 3.4);
    const right = candidateCellRangeForCluster(0, 32, 3.4);

    expect(left).toEqual({ firstCell: -9, endCellExclusive: 0, count: 9 });
    expect(right).toEqual({ firstCell: 0, endCellExclusive: 10, count: 10 });
    expect(left.endCellExclusive).toBe(right.firstCell);
    expect(candidateCountForCluster(-1, 0, 32, 3.4)).toBe(90);
  });

  it("never duplicates or drops cells at negative cluster boundaries", () => {
    const ranges = [-2, -1, 0, 1].map((cluster) => candidateCellRangeForCluster(cluster, 32, 1.7));
    for (let index = 1; index < ranges.length; index++) {
      expect(ranges[index - 1].endCellExclusive).toBe(ranges[index].firstCell);
    }
    expect(ranges.reduce((sum, range) => sum + range.count, 0))
      .toBe(ranges.at(-1)!.endCellExclusive - ranges[0].firstCell);
  });
});
