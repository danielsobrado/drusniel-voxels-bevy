import { describe, expect, it } from "vitest";
import {
  decodeClodPageNodeArtifact,
  decodeTerrainSummaryArtifact,
  encodeClodPageNodeArtifact,
  encodeTerrainSummaryArtifact,
  type ClodPageNodeArtifact,
  type TerrainSummaryArtifact,
} from "../artifactSerializer.js";

function sampleArtifact(): ClodPageNodeArtifact {
  return {
    nodeId: "L0:1,2",
    level: 0,
    positions: new Float32Array([0, 1, 2, 3, 4, 5]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0]),
    paintSlots: new Float32Array([0, 1]),
    materialWeights: new Float32Array([1, 0, 0, 0, 0.5, 0.5, 0, 0]),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2]),
    errorWorld: 0.25,
    boundingSphere: [1, 2, 3, 4.5],
    lowBenefit: false,
    footprint: { minX: 0, minZ: 0, maxX: 64, maxZ: 64 },
    bounds: { center: [1, 2, 3], radius: 4.5, minY: 0, maxY: 10 },
  };
}

function sampleSummary(): TerrainSummaryArtifact {
  return {
    res: 2,
    worldSize: 128,
    farReduceFactor: 8,
    heightMin: new Float32Array([1, 2, 3, 4]),
    heightMax: new Float32Array([5, 6, 7, 8]),
    normalX: new Float32Array([0.1, 0.2, 0.3, 0.4]),
    normalY: new Float32Array([0.9, 0.8, 0.7, 0.6]),
    normalZ: new Float32Array([0.3, 0.4, 0.5, 0.6]),
    coverage: new Float32Array([1, 0, 1, 0]),
  };
}

describe("artifact serializer", () => {
  it("round-trips clod-page-node", () => {
    const original = sampleArtifact();
    const bytes = encodeClodPageNodeArtifact(original);
    const decoded = decodeClodPageNodeArtifact(bytes);
    expect(decoded.nodeId).toBe(original.nodeId);
    expect(decoded.level).toBe(original.level);
    expect(decoded.positions.length).toBe(original.positions.length);
    expect(decoded.indices.length).toBe(original.indices.length);
    expect(decoded.errorWorld).toBeCloseTo(original.errorWorld);
    expect(decoded.lowBenefit).toBe(original.lowBenefit);
    expect(decoded.footprint).toEqual(original.footprint);
    for (let i = 0; i < original.positions.length; i++) {
      expect(decoded.positions[i]).toBeCloseTo(original.positions[i]!);
    }
  });

  it("rejects clod-page-node with mismatched normal length before caching", () => {
    const original = sampleArtifact();
    expect(() => encodeClodPageNodeArtifact({
      ...original,
      normals: new Float32Array([0, 1, 0]),
    })).toThrow();
  });

  it("rejects clod-page-node with invalid index count before caching", () => {
    const original = sampleArtifact();
    expect(() => encodeClodPageNodeArtifact({
      ...original,
      indices: new Uint32Array([0, 1]),
    })).toThrow();
  });

  it("round-trips terrain-summary", () => {
    const original = sampleSummary();
    const bytes = encodeTerrainSummaryArtifact(original);
    const decoded = decodeTerrainSummaryArtifact(bytes);
    expect(decoded.res).toBe(original.res);
    expect(decoded.worldSize).toBe(original.worldSize);
    expect(decoded.heightMin.length).toBe(original.heightMin.length);
    expect(decoded.coverage[0]).toBeCloseTo(1);
  });

  it("rejects terrain-summary with wrong channel grid size before caching", () => {
    const original = sampleSummary();
    expect(() => encodeTerrainSummaryArtifact({
      ...original,
      coverage: new Float32Array([1, 0, 1]),
    })).toThrow();
  });

  it("rejects corrupt terrain-summary payload length on decode", () => {
    const bytes = encodeTerrainSummaryArtifact(sampleSummary());
    const broken = bytes.slice(0, bytes.byteLength - 4);
    expect(() => decodeTerrainSummaryArtifact(broken)).toThrow();
  });
});
