import * as THREE from "three";
import type { TreeLod, TreeSpeciesId } from "./tree_config.js";
import { TREE_LODS, TREE_SPECIES } from "./tree_config.js";

export const TREE_RING_SHADOW_CASCADE_COUNT = 4;
export const TREE_RING_SHADOW_PLANE_COUNT = 6;
export const TREE_RING_SHADOW_PLANE_WORDS = 4;

const projectionMatrix = new THREE.Matrix4();
const frustum = new THREE.Frustum();

export interface TreeRingShadowCasterInstance {
  species: TreeSpeciesId;
  lod: TreeLod;
  center: readonly [number, number, number];
  radiusM: number;
}

export interface TreeRingShadowCasterCullResult {
  groupCounts: number[];
  overflowed: boolean;
}

export function treeRingShadowCasterGroupCount(cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT): number {
  return treeRingShadowSafeCascadeCount(cascadeCount) * TREE_SPECIES.length * TREE_LODS.length;
}

export function treeRingShadowCasterGroupIndex(
  species: TreeSpeciesId,
  lod: TreeLod,
  cascade: number,
  cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT,
): number {
  const safeCascade = Math.min(treeRingShadowSafeCascadeCount(cascadeCount) - 1, Math.max(0, Math.floor(cascade)));
  const visibleGroup = TREE_SPECIES.indexOf(species) * TREE_LODS.length + TREE_LODS.indexOf(lod);
  return safeCascade * TREE_SPECIES.length * TREE_LODS.length + visibleGroup;
}

export function treeRingShadowCasterGroupRegion(
  species: TreeSpeciesId,
  lod: TreeLod,
  cascade: number,
  maxCastersPerGroup: number,
  cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT,
): { start: number; end: number; firstInstance: number } {
  const capacity = Math.max(0, Math.floor(maxCastersPerGroup));
  const start = treeRingShadowCasterGroupIndex(species, lod, cascade, cascadeCount) * capacity;
  return { start, end: start + capacity, firstInstance: start };
}

export function treeRingShadowCascadePlaneOffset(cascade: number): number {
  return Math.max(0, Math.floor(cascade)) * TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS;
}

export function treeRingShadowCasterCascadeIndices(
  center: readonly [number, number, number],
  radiusM: number,
  packedCascadePlanes: ArrayLike<number>,
  cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT,
): number[] {
  const safeCascadeCount = treeRingShadowSafeCascadeCount(cascadeCount);
  const cascades: number[] = [];
  for (let cascade = 0; cascade < safeCascadeCount; cascade++) {
    if (treeRingShadowSphereIntersectsCascade(center, radiusM, packedCascadePlanes, cascade)) {
      cascades.push(cascade);
    }
  }
  return cascades;
}

export function treeRingShadowCasterGroupCounts(
  instances: readonly TreeRingShadowCasterInstance[],
  packedCascadePlanes: ArrayLike<number>,
  maxCastersPerGroup: number,
  cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT,
): TreeRingShadowCasterCullResult {
  const capacity = Math.max(0, Math.floor(maxCastersPerGroup));
  const groupCounts = new Array<number>(treeRingShadowCasterGroupCount(cascadeCount)).fill(0);
  let overflowed = false;
  if (capacity <= 0) return { groupCounts, overflowed: instances.length > 0 };

  for (const instance of instances) {
    for (const cascade of treeRingShadowCasterCascadeIndices(instance.center, instance.radiusM, packedCascadePlanes, cascadeCount)) {
      const group = treeRingShadowCasterGroupIndex(instance.species, instance.lod, cascade, cascadeCount);
      groupCounts[group]++;
      if (groupCounts[group] > capacity) overflowed = true;
    }
  }

  return {
    groupCounts: groupCounts.map((count) => Math.min(count, capacity)),
    overflowed,
  };
}

export function treeRingShadowSphereIntersectsCascade(
  center: readonly [number, number, number],
  radiusM: number,
  packedCascadePlanes: ArrayLike<number>,
  cascade: number,
): boolean {
  const slack = Math.max(0, radiusM);
  const base = treeRingShadowCascadePlaneOffset(cascade);
  for (let plane = 0; plane < TREE_RING_SHADOW_PLANE_COUNT; plane++) {
    const offset = base + plane * TREE_RING_SHADOW_PLANE_WORDS;
    const nx = Number(packedCascadePlanes[offset] ?? 0);
    const ny = Number(packedCascadePlanes[offset + 1] ?? 0);
    const nz = Number(packedCascadePlanes[offset + 2] ?? 0);
    const constant = Number(packedCascadePlanes[offset + 3] ?? 0);
    if (nx * center[0] + ny * center[1] + nz * center[2] + constant < -slack) return false;
  }
  return true;
}

export function treeRingShadowCascadePlanesFromCamera(camera: THREE.Camera): Float32Array {
  camera.updateMatrixWorld(true);
  projectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projectionMatrix);
  const out = new Float32Array(TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS);
  for (let i = 0; i < TREE_RING_SHADOW_PLANE_COUNT; i++) {
    const plane = frustum.planes[i];
    const offset = i * TREE_RING_SHADOW_PLANE_WORDS;
    out[offset] = plane.normal.x;
    out[offset + 1] = plane.normal.y;
    out[offset + 2] = plane.normal.z;
    out[offset + 3] = plane.constant;
  }
  return out;
}

export function treeRingShadowCascadePlanesFromCameras(
  cameras: readonly THREE.Camera[],
  cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT,
): Float32Array {
  const safeCascadeCount = treeRingShadowSafeCascadeCount(cascadeCount);
  const cascades = cameras.slice(0, safeCascadeCount).map((camera) => treeRingShadowCascadePlanesFromCamera(camera));
  return packTreeRingShadowCascadePlanes(cascades, safeCascadeCount);
}

export function packTreeRingShadowCascadePlanes(
  cascades: readonly ArrayLike<number>[],
  cascadeCount = TREE_RING_SHADOW_CASCADE_COUNT,
): Float32Array {
  const safeCascadeCount = treeRingShadowSafeCascadeCount(cascadeCount);
  const out = new Float32Array(safeCascadeCount * TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS);
  for (let cascade = 0; cascade < safeCascadeCount; cascade++) {
    const source = cascades[cascade];
    if (!source) continue;
    const offset = treeRingShadowCascadePlaneOffset(cascade);
    for (let i = 0; i < Math.min(TREE_RING_SHADOW_PLANE_COUNT * TREE_RING_SHADOW_PLANE_WORDS, source.length); i++) {
      out[offset + i] = Number(source[i] ?? 0);
    }
  }
  return out;
}

export function treeRingShadowSafeCascadeCount(cascadeCount: number): number {
  if (!Number.isFinite(cascadeCount)) return TREE_RING_SHADOW_CASCADE_COUNT;
  return Math.max(1, Math.min(TREE_RING_SHADOW_CASCADE_COUNT, Math.floor(cascadeCount)));
}
