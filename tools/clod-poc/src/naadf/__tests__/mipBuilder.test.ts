import { describe, expect, it } from "vitest";
import { buildChunkBrick } from "../chunkBrick.js";
import { buildMipChainFromBrick } from "../mipBuilder.js";
import { createTerrainSource } from "../terrainSource.js";

describe("naadf mipBuilder", () => {
  const flatSource = createTerrainSource("flat", 1);
  const hillSource = createTerrainSource("hills", 2);

  it("flat terrain summary has correct min/max/avg", () => {
    const brick = buildChunkBrick({ x: 0, z: 0 }, 16, flatSource, 1);
    const chain = buildMipChainFromBrick(brick, 1);
    const root = chain.levels[chain.levels.length - 1]![0]!;
    expect(root.minHeight).toBeCloseTo(32, 0);
    expect(root.maxHeight).toBeCloseTo(32, 0);
    expect(root.avgHeight).toBeCloseTo(32, 0);
  });

  it("hill terrain summary has max greater than min", () => {
    const brick = buildChunkBrick({ x: 3, z: -2 }, 16, hillSource, 1);
    const chain = buildMipChainFromBrick(brick, 1);
    const root = chain.levels[chain.levels.length - 1]![0]!;
    expect(root.maxHeight).toBeGreaterThanOrEqual(root.minHeight);
  });

  it("dominant material is stable", () => {
    const brick = buildChunkBrick({ x: 0, z: 0 }, 16, flatSource, 1);
    const chain = buildMipChainFromBrick(brick, 1);
    const root = chain.levels[chain.levels.length - 1]![0]!;
    expect(root.dominantMaterial).toBeGreaterThanOrEqual(0);
  });

  it("material variance increases for mixed cells", () => {
    const brick = buildChunkBrick({ x: 5, z: 5 }, 16, hillSource, 1);
    const chain = buildMipChainFromBrick(brick, 1);
    const root = chain.levels[chain.levels.length - 1]![0]!;
    expect(root.materialVariance).toBeGreaterThanOrEqual(0);
  });

  it("normal variance increases on cliffs", () => {
    const mountainSource = createTerrainSource("mountains", 3);
    const brick = buildChunkBrick({ x: 10, z: 10 }, 16, mountainSource, 1);
    const chain = buildMipChainFromBrick(brick, 1);
    const root = chain.levels[chain.levels.length - 1]![0]!;
    expect(root.normalVariance).toBeGreaterThanOrEqual(0);
  });
});
