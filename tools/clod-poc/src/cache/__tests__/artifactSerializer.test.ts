import { describe, expect, it } from "vitest";
import {
  decodeClodPageNodeArtifact,
  encodeClodPageNodeArtifact,
  type ClodPageNodeArtifact,
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
});
