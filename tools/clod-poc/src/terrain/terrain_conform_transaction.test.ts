import { beforeEach, describe, expect, it } from "vitest";
import {
  applyDigEditTransaction,
  canUndoVoxelTransaction,
  clearDigEdits,
  densityFromEdits,
  voxelInverseTransaction,
  voxelTransactionFromTerrainConform,
} from "./terrain_edits.js";
import { surfaceHeight } from "./terrain_surface.js";

describe("terrain conform composite transaction", () => {
  beforeEach(() => clearDigEdits());

  it("flattens fill and cut voxels in one authoritative revision", () => {
    const transaction = voxelTransactionFromTerrainConform({
      minX: 10,
      maxX: 12,
      minZ: 10,
      maxZ: 12,
      targetY: surfaceHeight(11, 11),
      fillDepthM: 2,
      trimHeightM: 2,
      falloffM: 0,
      materialSlot: 1,
    });
    expect(transaction.source).toBe("construction-terrain-conform");
    expect(transaction.deltas.length).toBeGreaterThan(0);
    applyDigEditTransaction(transaction);
    expect(canUndoVoxelTransaction(transaction)).toBe(true);
  });

  it("creates a forward inverse transaction that restores previous densities", () => {
    const targetY = surfaceHeight(21, 21) + 0.5;
    const transaction = voxelTransactionFromTerrainConform({
      minX: 20,
      maxX: 22,
      minZ: 20,
      maxZ: 22,
      targetY,
      fillDepthM: 2,
      trimHeightM: 2,
      falloffM: 0,
      materialSlot: 1,
    });
    const sample = transaction.deltas[0]!;
    const originalDensity = surfaceHeight(sample.x, sample.z) - sample.y;
    applyDigEditTransaction(transaction);
    const inverse = voxelInverseTransaction(transaction);
    applyDigEditTransaction(inverse);
    expect(densityFromEdits(sample.x, sample.y, sample.z, originalDensity)).toBeCloseTo(originalDensity);
  });
});
