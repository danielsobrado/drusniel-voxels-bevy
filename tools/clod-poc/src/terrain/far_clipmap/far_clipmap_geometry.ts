import * as THREE from "three";

export interface FarClipmapGridGeometryOptions {
  gridResolution: number;
}

function safeGridResolution(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(2, Math.floor(value));
}

export function createFarClipmapGridGeometry(options: FarClipmapGridGeometryOptions): THREE.BufferGeometry {
  const resolution = safeGridResolution(options.gridResolution);
  const segments = resolution - 1;
  const vertexCount = resolution * resolution;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  let cursor = 0;
  let uvCursor = 0;

  for (let z = 0; z < resolution; z++) {
    for (let x = 0; x < resolution; x++) {
      const u = x / segments;
      const v = z / segments;
      positions[cursor++] = u - 0.5;
      positions[cursor++] = 0;
      positions[cursor++] = v - 0.5;
      uvs[uvCursor++] = u;
      uvs[uvCursor++] = v;
    }
  }

  const indices: number[] = [];
  for (let z = 0; z < segments; z++) {
    for (let x = 0; x < segments; x++) {
      const a = z * resolution + x;
      const b = a + 1;
      const c = a + resolution;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}
