import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_DIAGONAL_FLIP_CONFIG } from "./config.js";
import {
  chooseBestQuadDiagonal,
  polishDiagonals,
  type DiagonalChoice,
  type QuadVertex,
} from "./diagonalPolish.js";
import type { PageMesh } from "./types.js";

interface Fixture {
  positions: [number, number, number][];
  normals: [number, number, number][];
  material_weights: number[][];
  current_diagonal: "ac" | "bd";
  expected_choice: DiagonalChoice;
}

const cfg = DEFAULT_DIAGONAL_FLIP_CONFIG;

function v(position: [number, number, number], material = [0]): QuadVertex {
  return { position, normal: [0, 1, 0], material };
}

function meshFromQuad(materials = [0, 0, 0, 0]): PageMesh {
  return {
    positions: new Float32Array([
      0, 0, 0,
      0, 0, 1,
      1, 0, 1,
      1, 0, 0,
    ]),
    normals: new Float32Array([
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
      0, 1, 0,
    ]),
    paintSlots: new Float32Array(materials),
    materialWeights: new Float32Array(materials.length * 4),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  };
}

describe("diagonal polish", () => {
  it("flips a diamond when the current diagonal creates skinny triangles", () => {
    const decision = chooseBestQuadDiagonal(
      v([0, 0, 0]),
      v([0, 0, 1]),
      v([0.05, 0, 0.8]),
      v([0.05, 0, 0.5]),
      "ac",
      cfg,
    );
    expect(decision.choice).toBe("flip");
    expect(decision.chosenDiagonal).toBe("bd");
  });

  it("keeps the current diagonal on a planar square tie", () => {
    const decision = chooseBestQuadDiagonal(
      v([0, 0, 0]),
      v([0, 0, 1]),
      v([1, 0, 1]),
      v([1, 0, 0]),
      "ac",
      cfg,
    );
    expect(decision.choice).toBe("keep");
    expect(decision.chosenDiagonal).toBe("ac");
  });

  it("rejects a flipped-winding alternate candidate and keeps the current diagonal", () => {
    const decision = chooseBestQuadDiagonal(
      v([0, 0, 0]),
      v([0, 0, 1]),
      v([0.1, 0, -2]),
      v([-2, 0, -1]),
      "ac",
      { ...cfg, min_angle_improvement_degrees: 0.0 },
    );
    expect(decision.choice).toBe("keep");
    expect(decision.reason).toBe("winding");
  });

  it("does not flip when the shared edge is locked as a border", () => {
    const mesh = meshFromQuad([0, 0, 1, 0]);
    const stats = polishDiagonals(mesh, new Uint8Array([1, 0, 1, 0]), cfg);
    expect(stats.candidateQuads).toBe(1);
    expect(stats.flipped).toBe(0);
    expect(stats.rejectedLockedBorder).toBe(1);
    expect([...mesh.indices]).toEqual([0, 1, 2, 0, 2, 3]);
  });

  it("prefers the diagonal with closer material continuity", () => {
    const decision = chooseBestQuadDiagonal(
      v([0, 0, 0], [1, 0, 0, 0]),
      v([0, 0, 1], [0, 1, 0, 0]),
      v([1, 0, 1], [0, 0, 1, 0]),
      v([1, 0, 0], [0, 1, 0, 0]),
      "ac",
      cfg,
    );
    expect(decision.choice).toBe("flip");
    expect(decision.chosenDiagonal).toBe("bd");
  });

  it("does not let material continuity choose when material weight is zero", () => {
    const decision = chooseBestQuadDiagonal(
      v([0, 0, 0], [1, 0, 0, 0]),
      v([0, 0, 1], [0, 1, 0, 0]),
      v([1, 0, 1], [0, 0, 1, 0]),
      v([1, 0, 0], [0, 1, 0, 0]),
      "ac",
      { ...cfg, material_error_weight: 0 },
    );
    expect(decision.choice).toBe("keep");
    expect(decision.chosenDiagonal).toBe("ac");
  });

  it("matches the shared fixture diagonal choice", () => {
    const fixture = JSON.parse(
      readFileSync(new URL("../tests/fixtures/clod/diagonal_polish.json", import.meta.url), "utf8"),
    ) as Fixture;
    const vertices = fixture.positions.map((position, i): QuadVertex => ({
      position,
      normal: fixture.normals[i],
      material: fixture.material_weights[i],
    }));
    const decision = chooseBestQuadDiagonal(
      vertices[0],
      vertices[1],
      vertices[2],
      vertices[3],
      fixture.current_diagonal,
      cfg,
    );
    expect(decision.choice).toBe(fixture.expected_choice);
  });
});
