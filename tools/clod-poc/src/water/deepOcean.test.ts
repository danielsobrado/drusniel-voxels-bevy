import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { defaultBorderCoastOceanConfig } from "../config/borderCoastOceanConfig.js";
import { filterPageSourceSections } from "../clod/pageSource.js";
import type { PageMesh } from "../types.js";
import { DeepOcean, DEEP_OCEAN_WGSL } from "./deepOcean.js";
import { buildDeepOceanMeshes } from "./deepOceanMesh.js";

const config = defaultBorderCoastOceanConfig;

describe("deep ocean mesh", () => {
  it("uses configured near/mid/far resolutions and complementary fades", () => {
    const meshes = buildDeepOceanMeshes(config.deep_ocean);
    expect(meshes.near.subdivisions).toBe(config.deep_ocean.near_subdivisions);
    expect(meshes.mid.subdivisions).toBe(config.deep_ocean.mid_subdivisions);
    expect(meshes.far.subdivisions).toBe(config.deep_ocean.far_subdivisions);
    expect(meshes.near.extentM).toBe(config.deep_ocean.near_grid_size_m);
    expect(meshes.mid.extentM).toBe(config.deep_ocean.mid_grid_size_m);
    expect(meshes.far.extentM).toBeGreaterThanOrEqual(config.deep_ocean.visual_extent_m * 2);
    expect(meshes.mid.fadeIn).toEqual(meshes.near.fadeOut);
    expect(meshes.far.fadeIn).toEqual(meshes.mid.fadeOut);
    expect(meshes.far.fadeOut[0]).toBeGreaterThanOrEqual(1e9);

    const positions = meshes.far.geometry.getAttribute("position");
    const quadrants = new Set<string>();
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      quadrants.add(`${Math.sign(positions.getX(vertex))},${Math.sign(positions.getZ(vertex))}`);
    }
    for (const quadrant of ["-1,-1", "1,-1", "-1,1", "1,1"]) {
      expect(quadrants.has(quadrant)).toBe(true);
    }
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
    expect(ocean.object.children).toHaveLength(3);
    for (const child of ocean.object.children as THREE.Mesh[]) {
      expect(child.userData["cornerCoverage"]).toBe(true);
      expect(child.userData["collisionEnabled"]).toBe(false);
      expect((child.material as MeshBasicNodeMaterialLike).depthWrite).toBe(true);
      expect(child.position.x).toBeCloseTo(Math.floor(2077.3 / snapFor(child)) * snapFor(child));
    }
    expect(ocean.stats().snapUpdates).toBe(3);
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
    expect(DEEP_OCEAN_WGSL).toContain("dow_fbm3");
    expect(DEEP_OCEAN_WGSL).toContain("foam_breakup");
    expect(DEEP_OCEAN_WGSL).toContain("fog_amount");
    expect(DEEP_OCEAN_WGSL).toContain("reef_line");
    expect(DEEP_OCEAN_WGSL).toContain("cliff_spray");
    expect(DEEP_OCEAN_WGSL).toContain("sky_zenith");
    expect(DEEP_OCEAN_WGSL).toContain("detail_params");
    expect(DEEP_OCEAN_WGSL).toContain("horizon_blend");
  });
});

interface MeshBasicNodeMaterialLike extends THREE.Material {
  depthWrite: boolean;
}

function snapFor(mesh: THREE.Mesh): number {
  if (mesh.userData["level"] === "near") {
    return config.deep_ocean.near_grid_size_m / config.deep_ocean.near_subdivisions;
  }
  if (mesh.userData["level"] === "mid") {
    return config.deep_ocean.mid_grid_size_m / config.deep_ocean.mid_subdivisions;
  }
  return config.deep_ocean.far_grid_size_m / config.deep_ocean.far_subdivisions;
}
