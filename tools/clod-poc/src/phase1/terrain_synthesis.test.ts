import { describe, expect, it } from "vitest";
import phase1ConfigText from "../../config/phase1_terrain.yaml?raw";
import { defaultBorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import { buildHeightfieldLeafNodes } from "../clod/heightfield_leaf_source.js";
import { parsePhase1Config } from "./phase1_config.js";
import { HeightfieldSampler } from "./heightfield_sampler.js";
import { generatePhase1Heightfield } from "./terrain_synthesis.js";

describe("generatePhase1Heightfield", () => {
  const config = parsePhase1Config(phase1ConfigText);

  it("is deterministic for the same seed and config", () => {
    const a = generatePhase1Heightfield(7, config, 64);
    const b = generatePhase1Heightfield(7, config, 64);
    expect(a.signature).toBe(b.signature);
    expect(a.minHeight).toBeCloseTo(b.minHeight);
    expect(a.maxHeight).toBeCloseTo(b.maxHeight);
  });

  it("changes signature for a different seed", () => {
    const a = generatePhase1Heightfield(7, config, 64);
    const b = generatePhase1Heightfield(8, config, 64);
    expect(a.signature).not.toBe(b.signature);
  });

  it("generates finite height, slope, flow, and valid biome ids", () => {
    const field = generatePhase1Heightfield(1, config, 96);
    for (const value of field.heights) expect(Number.isFinite(value)).toBe(true);
    for (const value of field.slope) expect(Number.isFinite(value)).toBe(true);
    for (const value of field.flow) expect(Number.isFinite(value)).toBe(true);
    for (const value of field.biome) expect(value).toBeGreaterThanOrEqual(0);
    for (const value of field.biome) expect(value).toBeLessThanOrEqual(3);
    for (let index = 0; index < field.heights.length; index++) {
      const weights = field.materialWeights.slice(index * 4, index * 4 + 4);
      for (const weight of weights) {
        expect(Number.isFinite(weight)).toBe(true);
        expect(weight).toBeGreaterThanOrEqual(0);
      }
      expect([...weights].reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    }
  });

  it("submerges the terminal border while leaving the inland center above it", () => {
    const field = generatePhase1Heightfield(5, config, 65);
    const last = field.size - 1;
    const water = defaultBorderCoastOceanConfig.world.water_level;

    for (let index = 0; index < field.size; index++) {
      expect(field.heights[index]).toBeLessThan(water);
      expect(field.heights[last * field.size + index]).toBeLessThan(water);
      expect(field.heights[index * field.size]).toBeLessThan(water);
      expect(field.heights[index * field.size + last]).toBeLessThan(water);
    }
    expect(field.heights[Math.floor(last / 2) * field.size + Math.floor(last / 2)]).toBeGreaterThan(water);
  });

  it("produces identical shared vertices where coastal leaf pages meet", () => {
    const field = generatePhase1Heightfield(11, config, 129);
    const leaves = buildHeightfieldLeafNodes(4, new HeightfieldSampler(field), config).leafNodes;
    const west = leaves.find((node) => node.id === "L0:0,1");
    const east = leaves.find((node) => node.id === "L0:1,1");
    expect(west).toBeDefined();
    expect(east).toBeDefined();

    const westEdge = new Map<number, { height: number; weights: number[] }>();
    for (let index = 0; index < west!.mesh.positions.length; index += 3) {
      if (west!.mesh.positions[index] === west!.footprint.maxX) {
        const vertex = index / 3;
        westEdge.set(west!.mesh.positions[index + 2], {
          height: west!.mesh.positions[index + 1],
          weights: [...west!.mesh.materialWeights.slice(vertex * 4, vertex * 4 + 4)],
        });
      }
    }
    for (let index = 0; index < east!.mesh.positions.length; index += 3) {
      if (east!.mesh.positions[index] === east!.footprint.minX) {
        const vertex = index / 3;
        const shared = westEdge.get(east!.mesh.positions[index + 2]);
        expect(east!.mesh.positions[index + 1]).toBe(
          shared?.height,
        );
        expect([...east!.mesh.materialWeights.slice(vertex * 4, vertex * 4 + 4)]).toEqual(
          shared?.weights,
        );
      }
    }
  });

  it("includes blended coastal weights in LOD0 page source attributes", () => {
    const field = generatePhase1Heightfield(13, config, 129);
    const leaves = buildHeightfieldLeafNodes(4, new HeightfieldSampler(field), config).leafNodes;
    const hasBlendedCoastVertex = leaves.some((node) => {
      for (let vertex = 0; vertex < node.mesh.materialWeights.length / 4; vertex += 1) {
        const weights = node.mesh.materialWeights.slice(vertex * 4, vertex * 4 + 4);
        if ([...weights].filter((weight) => weight > 0.001).length > 1) return true;
      }
      return false;
    });

    expect(hasBlendedCoastVertex).toBe(true);
  });
});
