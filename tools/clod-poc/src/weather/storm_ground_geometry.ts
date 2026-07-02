import * as THREE from "three";
import { IMPACT_ROOT_COUNT } from "./storm_ground_constants.js";
import type { StrikeBuffers } from "./storm_ground_types.js";

export function createStrikeGeometry(count: number): { geometry: THREE.InstancedBufferGeometry; buffers: StrikeBuffers } {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
    -1, 0, 0,
    1, 0, 0,
    -1, 1, 0,
    1, 1, 0,
    -1, 0, 1,
    1, 0, 1,
    -1, 1, 1,
    1, 1, 1,
  ]), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ]), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([
    0, 1, 2,
    2, 1, 3,
    4, 5, 6,
    6, 5, 7,
  ]), 1));
  geometry.instanceCount = count;

  const buffers: StrikeBuffers = {
    center: new Float32Array(count * 3),
    normal: new Float32Array(count * 3),
    params: new Float32Array(count * 4),
  };
  for (let i = 0; i < count; i++) buffers.normal[i * 3 + 1] = 1;
  setStrikeAttributes(geometry, buffers);
  return { geometry, buffers };
}

export function createImpactGeometry(buffers: StrikeBuffers): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let root = 0; root < IMPACT_ROOT_COUNT; root++) {
    const base = root * 4;
    positions.push(-1, 0, root, 1, 0, root, -1, 1, root, 1, 1, root);
    uvs.push(0, 0, 1, 0, 0, 1, 1, 1);
    indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(indices), 1));
  geometry.instanceCount = buffers.params.length / 4;
  setStrikeAttributes(geometry, buffers);
  return geometry;
}

export function markStrikeAttributesDirty(geometries: readonly THREE.BufferGeometry[]): void {
  for (const geometry of geometries) {
    for (const key of ["aLightningCenter", "aLightningNormal", "aLightningParams"]) {
      const attr = geometry.getAttribute(key);
      if (attr) attr.needsUpdate = true;
    }
  }
}

function setStrikeAttributes(geometry: THREE.InstancedBufferGeometry, buffers: StrikeBuffers): void {
  geometry.setAttribute("aLightningCenter", new THREE.InstancedBufferAttribute(buffers.center, 3));
  geometry.setAttribute("aLightningNormal", new THREE.InstancedBufferAttribute(buffers.normal, 3));
  geometry.setAttribute("aLightningParams", new THREE.InstancedBufferAttribute(buffers.params, 4));
}
