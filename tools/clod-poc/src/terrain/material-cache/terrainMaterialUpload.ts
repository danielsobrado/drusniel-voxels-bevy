import * as THREE from "three";
import type { TerrainMaterialBakePayload } from "./terrainMaterialCacheTypes.js";

export interface TerrainMaterialUploadResult {
  uploadedBytes: number;
  dirtyRectSupported: boolean;
  uploadMs: number;
}

export interface TerrainMaterialUploadTarget {
  texture: THREE.DataTexture;
  data: Uint8Array | Uint16Array | Float32Array;
  width: number;
  height: number;
}

export function uploadTerrainMaterialTile(
  target: TerrainMaterialUploadTarget,
  payload: TerrainMaterialBakePayload,
  channel: keyof Omit<TerrainMaterialBakePayload, "debug">,
): TerrainMaterialUploadResult {
  const start = performance.now();
  const source = payload[channel];
  if (!source?.available) return { uploadedBytes: 0, dirtyRectSupported: false, uploadMs: performance.now() - start };
  target.data.set(source.data as never, 0);
  target.texture.needsUpdate = true;
  return {
    uploadedBytes: source.data.byteLength,
    dirtyRectSupported: false,
    uploadMs: performance.now() - start,
  };
}
