import * as THREE from "three";
import type { ForestLightingField } from "./forest_lighting_fields.js";

export interface ForestLightingTextureHandle {
  texture: THREE.DataTexture;
  auxTexture: THREE.DataTexture;
  resolution: number;
  worldCells: number;
  update(field: ForestLightingField): void;
  dispose(): void;
}

export interface ForestLightingGpuTextureSource {
  texture: GPUTexture;
  resolution: number;
  worldCells: number;
}

let registeredGpuDevice: GPUDevice | null = null;
let activeHandle: ForestLightingTextureHandle | null = null;
let activeGpuTexture: GPUTexture | null = null;
let activeGpuResolution = 0;

export function registerForestLightingGpuDevice(device: GPUDevice | null): void {
  if (registeredGpuDevice === device) return;
  activeGpuTexture?.destroy();
  activeGpuTexture = null;
  activeGpuResolution = 0;
  registeredGpuDevice = device;
  if (device && activeHandle) uploadActiveGpuTexture(activeHandle);
}

export function activeForestLightingGpuTexture(): ForestLightingGpuTextureSource | null {
  if (!activeHandle || !activeGpuTexture) return null;
  return {
    texture: activeGpuTexture,
    resolution: activeHandle.resolution,
    worldCells: activeHandle.worldCells,
  };
}

export function createForestLightingTexture(
  field: ForestLightingField,
): ForestLightingTextureHandle {
  const length = field.resolution * field.resolution * 4;
  const data = new Uint8Array(length);
  const auxData = new Uint8Array(length);
  const texture = createDataTexture(data, field.resolution);
  const auxTexture = createDataTexture(auxData, field.resolution);
  let handle: ForestLightingTextureHandle;
  handle = {
    texture,
    auxTexture,
    resolution: field.resolution,
    worldCells: field.worldCells,
    update(nextField) {
      if (nextField.resolution !== handle.resolution) {
        throw new Error("forest lighting texture resolution changed without recreating the handle");
      }
      handle.worldCells = nextField.worldCells;
      packField(nextField, data, auxData);
      texture.needsUpdate = true;
      auxTexture.needsUpdate = true;
      if (activeHandle === handle) uploadActiveGpuTexture(handle);
    },
    dispose() {
      texture.dispose();
      auxTexture.dispose();
      if (activeHandle !== handle) return;
      activeHandle = null;
      activeGpuTexture?.destroy();
      activeGpuTexture = null;
      activeGpuResolution = 0;
    },
  };
  activeHandle = handle;
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
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function uploadActiveGpuTexture(handle: ForestLightingTextureHandle): void {
  const device = registeredGpuDevice;
  if (!device) return;
  if (!activeGpuTexture || activeGpuResolution !== handle.resolution) {
    activeGpuTexture?.destroy();
    activeGpuTexture = device.createTexture({
      label: "forest lighting canonical GPU texture",
      size: { width: handle.resolution, height: handle.resolution },
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    activeGpuResolution = handle.resolution;
  }

  const source = handle.texture.image.data as Uint8Array;
  const rowBytes = handle.resolution * 4;
  const bytesPerRow = alignTo(rowBytes, 256);
  const upload = bytesPerRow === rowBytes
    ? source
    : padRows(source, handle.resolution, rowBytes, bytesPerRow);
  device.queue.writeTexture(
    { texture: activeGpuTexture },
    upload as GPUAllowSharedBufferSource,
    { bytesPerRow, rowsPerImage: handle.resolution },
    { width: handle.resolution, height: handle.resolution },
  );
}

function padRows(source: Uint8Array, rows: number, rowBytes: number, bytesPerRow: number): Uint8Array {
  const padded = new Uint8Array(rows * bytesPerRow);
  for (let row = 0; row < rows; row++) {
    padded.set(source.subarray(row * rowBytes, (row + 1) * rowBytes), row * bytesPerRow);
  }
  return padded;
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
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
