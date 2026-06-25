import { beforeAll, describe, expect, it } from "vitest";
import configText from "../../../config/clod_pages.yaml?raw";
import type { PageMesh } from "../../types.js";
import { parseConfig } from "../../config.js";
import { filterPageSourceSections } from "../pageSource.js";
import {
  pageSourceSectionDebugColors,
  type PageSourceSection,
  type PageSourceSectionKind,
} from "../pageSourceSections.js";
import { initSimplifier, simplifyPage } from "../simplify.js";

function triangleMesh(materialWeights: [number, number, number, number]): PageMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    paintSlots: new Float32Array([0, 0, 0]),
    materialWeights: new Float32Array([
      ...materialWeights,
      ...materialWeights,
      ...materialWeights,
    ]),
    materialWeightStride: 4,
    indices: new Uint32Array([0, 1, 2]),
  };
}

function section(
  kind: PageSourceSectionKind,
  weights: [number, number, number, number],
  positionSource: PageSourceSection["positionSource"] = "extracted",
): PageSourceSection {
  return {
    kind,
    mesh: triangleMesh(weights),
    terrainClass: kind === "mainTerrain" ? "beach" : undefined,
    positionSource,
  };
}

describe("page source purity", () => {
  beforeAll(async () => {
    await initSimplifier();
  });

  it("excludes every non-terrain section before simplification", () => {
    const excludedKinds: PageSourceSectionKind[] = [
      "waterSurface",
      "deepOcean",
      "surfFoam",
      "debugOverlay",
      "prop",
      "collider",
      "skirt",
      "apron",
      "stitchFallback",
    ];
    const filtered = filterPageSourceSections([
      section("mainTerrain", [0, 0.65, 0.35, 0]),
      ...excludedKinds.map((kind) => section(kind, [0, 0, 0, 1])),
      section("mainTerrain", [1, 0, 0, 0], "morphDeformed"),
    ]);

    expect(filtered.includedTriangles).toBe(1);
    expect(filtered.excludedTriangles).toBe(excludedKinds.length + 1);
    expect(filtered.mesh.indices.length / 3).toBe(1);
    expect([...filtered.mesh.materialWeights]).not.toContain(1);

    const simplified = simplifyPage(
      filtered.mesh,
      new Uint8Array(filtered.mesh.positions.length / 3),
      parseConfig(configText),
    );
    expect(simplified.mesh.indices.length / 3).toBe(1);
    expect([...simplified.mesh.materialWeights]).not.toContain(1);
  });

  it.each(["beach", "cliff", "cove", "reef"] as const)(
    "includes %s terrain in simplifier source",
    (terrainClass) => {
      const coast = section("mainTerrain", [0, 0.4, 0.6, 0]);
      coast.terrainClass = terrainClass;
      const filtered = filterPageSourceSections([coast]);

      expect(filtered.includedSections[0].terrainClass).toBe(terrainClass);
      expect(filtered.includedTriangles).toBe(1);
      expect(filtered.mesh.materialWeights[1]).toBeCloseTo(0.4);
      expect(filtered.mesh.materialWeights[2]).toBeCloseTo(0.6);
    },
  );

  it("provides distinct debug colors for source purity inspection", () => {
    const sections = [
      section("mainTerrain", [1, 0, 0, 0]),
      section("waterSurface", [0, 1, 0, 0]),
      section("deepOcean", [0, 1, 0, 0]),
    ];
    const colors = pageSourceSectionDebugColors(sections);

    expect(colors).toHaveLength(3);
    expect([...colors[0]]).not.toEqual([...colors[1]]);
    expect([...colors[1]]).not.toEqual([...colors[2]]);
  });
});
