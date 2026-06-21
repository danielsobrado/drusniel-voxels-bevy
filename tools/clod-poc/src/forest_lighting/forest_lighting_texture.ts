import * as THREE from "three";
import type { ForestLightingField } from "./forest_lighting_fields.js";

export interface ForestLightingTextureHandle {
  texture: THREE.DataTexture;
  auxTexture: THREE.DataTexture;
  update(field: ForestLightingField): void;
  dispose(): void;
}

export function createForestLightingTexture(
  field: ForestLightingField,
): ForestLightingTextureHandle {
  const length = field.resolution * field.resolution * 4;
  const data = new Uint8Array(length);
  const auxData = new Uint8Array(length);
  const texture = createDataTexture(data, field.resolution);
  const auxTexture = createDataTexture(auxData, field.resolution);
  const handle: ForestLightingTextureHandle = {
    texture,
    auxTexture,
    update(nextField) {
      packField(nextField, data, auxData);
      texture.needsUpdate = true;
      auxTexture.needsUpdate = true;
    },
    dispose() {
      texture.dispose();
      auxTexture.dispose();
    },
  };
  handle.update(field);
  return handle;
}

function createDataTexture(data: Uint8Array, resolution: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(data, resolution, resolution, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function packField(field: ForestLightingField, data: Uint8Array, auxData: Uint8Array): void {
  const cells = field.resolution * field.resolution;
  for (let i = 0; i < cells; i++) {
    const offset = i * 4;
    data[offset] = byte(field.ambientOcclusion[i]);
    data[offset + 1] = byte(field.shadowProxy[i]);
    data[offset + 2] = byte(field.fogDensity[i]);
    data[offset + 3] = byte(field.sunShaftMask[i]);
    auxData[offset] = byte(field.canopyDensity[i]);
    auxData[offset + 1] = byte(field.forestEdge[i]);
    auxData[offset + 2] = byte(field.understoryDensity[i]);
    auxData[offset + 3] = 255;
  }
}

function byte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 255);
}
