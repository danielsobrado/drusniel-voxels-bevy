import * as THREE from "three";

const TERRAIN_NON_INDEXED_FALLBACK_KEY = "__drusnielWebGpuTerrainNonIndexedFallback";

type WebGpuTerrainFallbackGeometry = THREE.BufferGeometry & {
  [TERRAIN_NON_INDEXED_FALLBACK_KEY]?: boolean;
};

export function isSetIndexBufferError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("setIndexBuffer") && message.includes("GPUBuffer");
}

function isIndexedTerrainGeometry(geometry: THREE.BufferGeometry): boolean {
  return geometry.index !== null
    && geometry.getAttribute("paintSlots") !== undefined
    && geometry.getAttribute("paintWeights") !== undefined;
}

function convertTerrainGeometryToNonIndexed(mesh: THREE.Mesh): boolean {
  const geometry = mesh.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) return false;
  const fallbackGeometry = geometry as WebGpuTerrainFallbackGeometry;
  if (fallbackGeometry[TERRAIN_NON_INDEXED_FALLBACK_KEY] || !isIndexedTerrainGeometry(geometry)) return false;

  const replacement = geometry.toNonIndexed() as WebGpuTerrainFallbackGeometry;
  replacement.name = geometry.name ? `${geometry.name}-webgpu-nonindexed` : "clod-terrain-webgpu-nonindexed";
  replacement[TERRAIN_NON_INDEXED_FALLBACK_KEY] = true;
  mesh.geometry = replacement;
  geometry.dispose();
  return true;
}

export function convertVisibleTerrainMeshesToNonIndexed(scene: THREE.Scene): number {
  let converted = 0;
  scene.traverseVisible((object) => {
    if (object instanceof THREE.Mesh && convertTerrainGeometryToNonIndexed(object)) converted += 1;
  });
  return converted;
}
