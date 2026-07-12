import { afterEach, describe, expect, it } from "vitest";
import type { PageMesh } from "../../types.js";
import { setTerrainFieldConfig } from "../terrain.js";
import { BIOME_IDS, BiomeRegionField } from "../../world_source/biome_region_field.js";
import { biomeIdsFor, pageAttributesPrimed, paintAttributesFor, primePageAttributesBudgeted, toGeometry } from "./page_geometry.js";

afterEach(() => {
  setTerrainFieldConfig(null);
});

describe("terrain page geometry biome attributes", () => {
  it("colors terrain debug from BiomeRegionField ids", () => {
    setTerrainFieldConfig({ seed: 7, seaLevel: 18 });
    const mesh: PageMesh = {
      positions: new Float32Array([
        0, 10, 0,
        16, 18, 0,
        32, 90, 0,
      ]),
      normals: new Float32Array([
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      ]),
      paintSlots: new Float32Array([0, 0, 0]),
      materialWeights: new Float32Array([
        1, 0, 0, 0,
        1, 0, 0, 0,
        1, 0, 0, 0,
      ]),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 1, 2]),
    };

    const biomeIds = biomeIdsFor(mesh);
    const expected = new BiomeRegionField({ seed: 7, seaLevel: 18 }).sample(32, 0, 90).biome;
    expect([...biomeIds]).toEqual([BIOME_IDS.ocean, BIOME_IDS.coast, expected]);
    const geometry = toGeometry(mesh);
    expect([...(geometry.getAttribute("biomeId").array as Float32Array)]).toEqual([...biomeIds]);
    geometry.dispose();
  });
});

describe("budgeted page attribute priming", () => {
  function testMesh(vertexCount: number): PageMesh {
    const positions = new Float32Array(vertexCount * 3);
    for (let i = 0; i < vertexCount; i++) {
      positions[i * 3] = i * 4;
      positions[i * 3 + 1] = 10 + (i % 7) * 5;
      positions[i * 3 + 2] = (i % 13) * 8;
    }
    return {
      positions,
      normals: new Float32Array(vertexCount * 3),
      paintSlots: new Float32Array(vertexCount),
      materialWeights: new Float32Array(vertexCount * 4),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 1, 2]),
    };
  }

  it("primed attributes match the synchronous path exactly", () => {
    setTerrainFieldConfig({ seed: 11, seaLevel: 18 });
    // Larger than one 2048-vertex slice so the past deadline forces at least one
    // suspend/resume cycle — the production shape.
    const primed = testMesh(3000);
    const synchronous = testMesh(3000);

    let calls = 1;
    while (!primePageAttributesBudgeted(primed, performance.now() - 1)) {
      calls++;
      expect(calls).toBeLessThan(1000);
    }
    expect(calls).toBeGreaterThan(1);
    expect(pageAttributesPrimed(primed)).toBe(true);

    const primedPaint = paintAttributesFor(primed);
    const syncPaint = paintAttributesFor(synchronous);
    expect([...primedPaint.slots]).toEqual([...syncPaint.slots]);
    expect([...primedPaint.weights]).toEqual([...syncPaint.weights]);
    expect([...biomeIdsFor(primed)]).toEqual([...biomeIdsFor(synchronous)]);
  });

  it("reports already-primed meshes as complete without work", () => {
    setTerrainFieldConfig({ seed: 11, seaLevel: 18 });
    const mesh = testMesh(8);
    paintAttributesFor(mesh);
    biomeIdsFor(mesh);
    expect(primePageAttributesBudgeted(mesh, performance.now() - 1)).toBe(true);
  });
});
