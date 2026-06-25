import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { defaultBorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import { filterPageSourceSections } from "../clod/pageSource.js";
import type { PageMesh } from "../types.js";
import { DeepOcean, DEEP_OCEAN_WGSL } from "./deepOcean.js";
import { buildDeepOceanMeshes } from "./deepOceanMesh.js";

const config = defaultBorderCoastOceanConfig;

describe("deep ocean mesh", () => {
  it("uses configured near/far resolutions and covers every corner quadrant", () => {
    const meshes = buildDeepOceanMeshes(config.deep_ocean);
    expect(meshes.near.subdivisions).toBe(config.deep_ocean.near_subdivisions);
    expect(meshes.far.subdivisions).toBe(config.deep_ocean.far_subdivisions);
    expect(meshes.near.extentM).toBe(config.deep_ocean.near_grid_size_m);
    expect(meshes.far.extentM).toBeGreaterThanOrEqual(config.deep_ocean.visual_extent_m * 2);

    const positions = meshes.far.geometry.getAttribute("position");
    const quadrants = new Set<string>();
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      quadrants.add(`${Math.sign(positions.getX(vertex))},${Math.sign(positions.getZ(vertex))}`);
    }
    expect(quadrants).toEqual(expect.objectContaining(new Set(["-1,-1", "1,-1", "-1,1", "1,1"])));
  });
});

describe("DeepOcean", () => {
  it("is render-only, non-collidable, GPU displaced, and camera-snapped", () => {
    const ocean = new DeepOcean({
      config,
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.3),
    });
    ocean.update(1 / 60, new THREE.Vector3(2077.3, 30, -511.7));

    expect(ocean.renderOnly).toBe(true);
    expect(ocean.collisionEnabled).toBe(false);
    expect(ocean.pageSourceKind).toBe("deepOcean");
    expect(ocean.object.userData["waveEvaluation"]).toBe("gpu-wgsl");
    expect(ocean.object.children).toHaveLength(2);
    for (const child of ocean.object.children as THREE.Mesh[]) {
      expect(child.userData["cornerCoverage"]).toBe(true);
      expect(child.userData["collisionEnabled"]).toBe(false);
      expect((child.material as MeshBasicNodeMaterialLike).depthWrite).toBe(false);
      expect(child.position.x).toBeCloseTo(
        Math.floor(2077.3 / snapFor(child)) * snapFor(child),
      );
    }
    expect(ocean.stats().snapUpdates).toBe(2);
    ocean.dispose();
  });

  it("is excluded from strict CLOD page source filtering", () => {
    const ocean = new DeepOcean({
      config,
      sunDirection: new THREE.Vector3(0.4, 0.8, 0.3),
    });
    const deepMesh = ocean.object.children[0] as THREE.Mesh<THREE.BufferGeometry>;
    const positions = deepMesh.geometry.getAttribute("position").array as Float32Array;
    const indices = deepMesh.geometry.getIndex()!.array as Uint32Array;
    const vertexCount = positions.length / 3;
    const deepPageMesh: PageMesh = {
      positions,
      normals: new Float32Array(vertexCount * 3),
      paintSlots: new Float32Array(vertexCount),
      materialWeights: new Float32Array(vertexCount * 4),
      materialWeightStride: 4,
      indices,
    };
    const terrain: PageMesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
      paintSlots: new Float32Array(3),
      materialWeights: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
      materialWeightStride: 4,
      indices: new Uint32Array([0, 1, 2]),
    };
    const filtered = filterPageSourceSections([
      { kind: "mainTerrain", terrainClass: "beach", positionSource: "extracted", mesh: terrain },
      { kind: "deepOcean", positionSource: "extracted", mesh: deepPageMesh },
    ]);
    expect(filtered.includedTriangles).toBe(1);
    expect(filtered.excludedTriangles).toBe(indices.length / 3);
    expect(filtered.excludedSections[0].kind).toBe("deepOcean");
    ocean.dispose();
  });

  it("ships GPU wave, shading, foam, and fog functions", () => {
    expect(DEEP_OCEAN_WGSL).toContain("fn deep_ocean_wave_sample");
    expect(DEEP_OCEAN_WGSL).toContain("fn deep_ocean_shade");
    expect(DEEP_OCEAN_WGSL).toContain("sun_specular");
    expect(DEEP_OCEAN_WGSL).toContain("fog_exponential");
    expect(DEEP_OCEAN_WGSL).toContain("sandy_calm");
    expect(DEEP_OCEAN_WGSL).toContain("cove_calm");
    expect(DEEP_OCEAN_WGSL).toContain("reef_line");
    expect(DEEP_OCEAN_WGSL).toContain("cliff_spray");
  });
});

interface MeshBasicNodeMaterialLike extends THREE.Material {
  depthWrite: boolean;
}

function snapFor(mesh: THREE.Mesh): number {
  return mesh.userData["level"] === "near"
    ? config.deep_ocean.near_grid_size_m / config.deep_ocean.near_subdivisions
    : config.deep_ocean.far_grid_size_m / config.deep_ocean.far_subdivisions;
}
