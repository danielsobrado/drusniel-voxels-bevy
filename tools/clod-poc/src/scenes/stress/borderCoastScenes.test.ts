import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { ClodPageNode } from "../../types.js";
import { buildBorderBeachScene } from "./borderBeachScene.js";
import { buildBorderCliffScene } from "./borderCliffScene.js";
import { buildBorderCoveScene } from "./borderCoveScene.js";
import { buildBorderCornerScene } from "./borderCornerScene.js";
import type { StressSceneParams } from "../../clod/stress/stressSceneConfig.js";
import {
  setStressTerrainDebugMode,
  type TerrainBuildResult,
} from "../../clod/stress/stressTerrainFactory.js";

const params: StressSceneParams = {
  sceneName: "border_beach",
  lod0PagesX: 4,
  lod0PagesZ: 4,
  chunksPerPage: 4,
  chunkSize: 16,
};

const builders = [
  ["border beach", buildBorderBeachScene],
  ["border cliff", buildBorderCliffScene],
  ["border cove", buildBorderCoveScene],
  ["border corner", buildBorderCornerScene],
] as const;

function build(
  builder: (scene: THREE.Scene, params: StressSceneParams) => TerrainBuildResult,
): TerrainBuildResult {
  return builder(new THREE.Scene(), params);
}

function edgeVertices(node: ClodPageNode, axis: "x" | "z", value: number): Map<number, number[]> {
  const edge = new Map<number, number[]>();
  for (let vertex = 0; vertex < node.mesh.positions.length / 3; vertex += 1) {
    const x = node.mesh.positions[vertex * 3];
    const z = node.mesh.positions[vertex * 3 + 2];
    if ((axis === "x" ? x : z) !== value) continue;
    const key = axis === "x" ? z : x;
    edge.set(key, [
      node.mesh.positions[vertex * 3 + 1],
      ...node.mesh.materialWeights.slice(vertex * 4, vertex * 4 + 4),
    ]);
  }
  return edge;
}

describe.each(builders)("%s stress scene", (_name, builder) => {
  it("builds finite terrain-only CLOD nodes with debug attributes", () => {
    const result = build(builder);
    expect(result.nodes.size).toBeGreaterThan(0);
    expect(result.scene.userData["borderCoastStress"]).toMatchObject({
      pageSourceKinds: ["mainTerrain"],
      waterTrianglesInSimplifiedPages: 0,
    });
    for (const node of result.nodeDefs.values()) {
      expect(node.mesh.indices.length).toBeGreaterThan(0);
      for (const value of node.mesh.positions) expect(Number.isFinite(value)).toBe(true);
    }
    const firstMesh = result.nodes.values().next().value?.mesh;
    expect(firstMesh?.geometry.getAttribute("coastTypeColor")).toBeDefined();
    expect(firstMesh?.geometry.getAttribute("materialWeightColor")).toBeDefined();
    expect(firstMesh?.geometry.getAttribute("pageSourceSectionColor")).toBeDefined();
  });

  it("has exact height and material weights across a page border", () => {
    const result = build(builder);
    const west = result.nodeDefs.get("L0:0,1");
    const east = result.nodeDefs.get("L0:1,1");
    expect(west).toBeDefined();
    expect(east).toBeDefined();
    const westEdge = edgeVertices(west!, "x", west!.footprint.maxX);
    const eastEdge = edgeVertices(east!, "x", east!.footprint.minX);
    expect(eastEdge).toEqual(westEdge);
  });

  it("supports coast type, material, page-source, and LOD debug views", () => {
    const result = build(builder);
    for (const mode of ["coastType", "materialWeights", "pageSourceSections", "lod"] as const) {
      setStressTerrainDebugMode(result, mode);
      for (const node of result.nodes.values()) {
        const mesh = node.mesh!;
        const material = mesh.material as THREE.MeshStandardMaterial;
        if (mode === "lod") {
          expect(material.vertexColors).toBe(false);
          expect(mesh.geometry.getAttribute("color")).toBeUndefined();
        } else {
          expect(material.vertexColors).toBe(true);
          expect(mesh.geometry.getAttribute("color")).toBeDefined();
        }
      }
    }
  });
});

describe("border coast stress coverage", () => {
  it("places the cliff across both a page border and page corner", () => {
    const result = build(buildBorderCliffScene);
    const samples = [
      result.fixtureDef.height(128, 63),
      result.fixtureDef.height(128, 65),
      result.fixtureDef.height(127, 64),
      result.fixtureDef.height(129, 64),
    ];
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(5);
  });

  it("rounds and noises the world corner instead of following an axis-aligned cutoff", () => {
    const result = build(buildBorderCornerScene);
    const fixture = result.fixtureDef;
    expect(fixture.height(8, 90)).not.toBeCloseTo(fixture.height(90, 8));
    expect(fixture.height(64, 64)).not.toBeCloseTo(fixture.height(8, 90));
  });
});
