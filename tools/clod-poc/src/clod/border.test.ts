import { describe, expect, it } from "vitest";
import type { PageFootprint, PageMesh } from "../types.js";
import { assertBorderMatch, borderChain } from "../validate.js";

function adjacentPageMeshes(): { a: PageMesh; b: PageMesh; footprintA: PageFootprint; footprintB: PageFootprint } {
  const footA: PageFootprint = { minX: 0, minZ: 0, maxX: 4, maxZ: 4 };
  const footB: PageFootprint = { minX: 4, minZ: 0, maxX: 8, maxZ: 4 };

  const makeGrid = (xOff: number) => {
    const positions: number[] = [];
    const normals: number[] = [];
    const materials: number[] = [];
    for (let z = 0; z <= 4; z++) {
      for (let x = 0; x <= 4; x++) {
        positions.push(xOff + x, Math.sin((xOff + x) * 0.5) + Math.cos(z * 0.5), z);
        normals.push(0, 1, 0);
        materials.push(0);
      }
    }
    const indices: number[] = [];
    for (let z = 0; z < 4; z++) {
      for (let x = 0; x < 4; x++) {
        const a = z * 5 + x;
        const b = a + 1;
        const c = a + 5;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      materials: new Float32Array(materials),
      indices: new Uint32Array(indices),
    };
  };

  return {
    a: makeGrid(0),
    b: makeGrid(4),
    footprintA: footA,
    footprintB: footB,
  };
}

describe("border chain", () => {
  it("produces deterministic sorting", () => {
    const { a, footprintA } = adjacentPageMeshes();
    const chain1 = borderChain(a, "x", footprintA.maxX, footprintA, 1);
    const chain2 = borderChain(a, "x", footprintA.maxX, footprintA, 1);
    expect(chain1.positions.length).toBe(chain2.positions.length);
    for (let i = 0; i < chain1.positions.length; i++) {
      expect(chain1.positions[i]).toEqual(chain2.positions[i]);
    }
  });

  it("adjacent pages produce matching border chains", () => {
    const { a, b, footprintA, footprintB } = adjacentPageMeshes();
    const chainA = borderChain(a, "x", footprintA.maxX, footprintA, 1);
    const chainB = borderChain(b, "x", footprintB.minX, footprintB, 1);
    expect(chainA.positions.length).toBeGreaterThan(0);
    expect(chainB.positions.length).toBeGreaterThan(0);
    expect(() => assertBorderMatch(chainA, chainB)).not.toThrow();
  });
});

describe("assertBorderMatch", () => {
  it("position mismatch fails", () => {
    const chainA = { positions: [[0, 0, 0], [1, 0, 0]] as [number, number, number][], normals: [[0, 1, 0], [0, 1, 0]] as [number, number, number][], materials: [0, 0] };
    const chainB = { positions: [[0, 0, 0], [1.1, 0, 0]] as [number, number, number][], normals: [[0, 1, 0], [0, 1, 0]] as [number, number, number][], materials: [0, 0] };
    expect(() => assertBorderMatch(chainA, chainB)).toThrow(/BorderPositionMismatch/);
  });

  it("normal mismatch fails", () => {
    const chainA = { positions: [[0, 0, 0], [1, 0, 0]] as [number, number, number][], normals: [[0, 1, 0], [0, 1, 0]] as [number, number, number][], materials: [0, 0] };
    const chainB = { positions: [[0, 0, 0], [1, 0, 0]] as [number, number, number][], normals: [[0, -1, 0], [0, 1, 0]] as [number, number, number][], materials: [0, 0] };
    expect(() => assertBorderMatch(chainA, chainB)).toThrow(/BorderNormalMismatch/);
  });

  it("material mismatch fails", () => {
    const chainA = { positions: [[0, 0, 0], [1, 0, 0]] as [number, number, number][], normals: [[0, 1, 0], [0, 1, 0]] as [number, number, number][], materials: [0, 0] };
    const chainB = { positions: [[0, 0, 0], [1, 0, 0]] as [number, number, number][], normals: [[0, 1, 0], [0, 1, 0]] as [number, number, number][], materials: [0, 0.5] };
    expect(() => assertBorderMatch(chainA, chainB)).toThrow(/BorderMaterialMismatch/);
  });

  it("chain length mismatch fails", () => {
    const chainA = { positions: [[0, 0, 0]] as [number, number, number][], normals: [[0, 1, 0]] as [number, number, number][], materials: [0] };
    const chainB = { positions: [[0, 0, 0], [1, 0, 0]] as [number, number, number][], normals: [[0, 1, 0], [0, 1, 0]] as [number, number, number][], materials: [0, 0] };
    expect(() => assertBorderMatch(chainA, chainB)).toThrow(/vertex counts differ/);
  });

  it("matching chains pass", () => {
    const chainA = { positions: [[0, 0, 0], [1, 0, 0]] as [number, number, number][], normals: [[0, 1, 0], [0, 1, 0]] as [number, number, number][], materials: [0, 0] };
    const chainB = { positions: [[0, 0, 0], [1, 0, 0]] as [number, number, number][], normals: [[0, 1, 0], [0, 1, 0]] as [number, number, number][], materials: [0, 0] };
    expect(() => assertBorderMatch(chainA, chainB)).not.toThrow();
  });
});
