import { describe, expect, it } from "vitest";
import { finiteWaterWorldBounds, waterQuadRenderable } from "./waterClipmap.js";

const positions = new Float32Array([
  -10, 2, -10,
  10, 2, -10,
  -10, 2, 10,
  10, 2, 10,
]);
const terrainY = new Float32Array([0, 0, 0, 0]);
const bodyMask = new Float32Array([1, 1, 1, 1]);
const flow = new Float32Array(16);

describe("water clipmap bounds", () => {
  it("treats positive world bounds as finite", () => {
    expect(finiteWaterWorldBounds({ cellsX: 1000, cellsZ: 1000 })).toBe(true);
    expect(waterQuadRenderable([0, 1, 2, 3], positions, terrainY, bodyMask, flow, { cellsX: 1000, cellsZ: 1000 })).toBe(false);
  });

  it("treats zero world bounds as unbounded", () => {
    expect(finiteWaterWorldBounds({ cellsX: 0, cellsZ: 0 })).toBe(false);
    expect(waterQuadRenderable([0, 1, 2, 3], positions, terrainY, bodyMask, flow, { cellsX: 0, cellsZ: 0 })).toBe(true);
  });
});
