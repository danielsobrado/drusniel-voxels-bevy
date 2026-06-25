import * as THREE from "three";
import type { DeepOceanConfig } from "../config/borderCoastOceanConfig.js";

export type DeepOceanLevel = "near" | "far";

export interface DeepOceanGridMesh {
  level: DeepOceanLevel;
  geometry: THREE.BufferGeometry;
  extentM: number;
  subdivisions: number;
  snapM: number;
  innerFadeM: number;
  outerFadeM: number;
  triangleCount: number;
}

export interface DeepOceanMeshSet {
  near: DeepOceanGridMesh;
  far: DeepOceanGridMesh;
}

export function buildDeepOceanMeshes(config: DeepOceanConfig): DeepOceanMeshSet {
  const nearExtent = config.near_grid_size_m;
  const farExtent = Math.max(config.visual_extent_m * 2, config.far_grid_size_m);
  const near = buildGrid(
    "near",
    nearExtent,
    config.near_subdivisions,
    config.near_grid_size_m / config.near_subdivisions,
    0,
    nearExtent * 0.5,
  );
  const far = buildGrid(
    "far",
    farExtent,
    config.far_subdivisions,
    config.far_grid_size_m / config.far_subdivisions,
    nearExtent * 0.42,
    farExtent * 0.5,
  );
  return { near, far };
}

function buildGrid(
  level: DeepOceanLevel,
  extentM: number,
  subdivisions: number,
  snapM: number,
  innerFadeM: number,
  outerFadeM: number,
): DeepOceanGridMesh {
  if (!Number.isFinite(extentM) || extentM <= 0) {
    throw new Error(`Deep ocean mesh: ${level} extent must be positive`);
  }
  if (!Number.isInteger(subdivisions) || subdivisions < 1) {
    throw new Error(`Deep ocean mesh: ${level} subdivisions must be a positive integer`);
  }

  const side = subdivisions + 1;
  const half = extentM * 0.5;
  const positions = new Float32Array(side * side * 3);
  const indices = new Uint32Array(subdivisions * subdivisions * 6);
  for (let z = 0; z < side; z += 1) {
    for (let x = 0; x < side; x += 1) {
      const vertex = z * side + x;
      positions[vertex * 3] = -half + (x / subdivisions) * extentM;
      positions[vertex * 3 + 1] = 0;
      positions[vertex * 3 + 2] = -half + (z / subdivisions) * extentM;
    }
  }
  let write = 0;
  for (let z = 0; z < subdivisions; z += 1) {
    for (let x = 0; x < subdivisions; x += 1) {
      const a = z * side + x;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices[write++] = a;
      indices[write++] = c;
      indices[write++] = b;
      indices[write++] = b;
      indices[write++] = c;
      indices[write++] = d;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.SQRT2 * half);

  return {
    level,
    geometry,
    extentM,
    subdivisions,
    snapM,
    innerFadeM,
    outerFadeM,
    triangleCount: indices.length / 3,
  };
}
