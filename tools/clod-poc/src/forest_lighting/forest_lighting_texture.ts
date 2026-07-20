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
  auxTexture: GPUTexture;
  resolution: number;
  worldCells: number;
}

export interface ForestCanopyEcologySample {
  canopyDensity: number;
  forestEdge: number;
  understoryDensity: number;
}

let registeredGpuDevice: GPUDevice | null = null;
let activeHandle: ForestLightingTextureHandle | null = null;
let activeGpuTexture: GPUTexture | null = null;
let activeGpuAuxTexture: GPUTexture | null = null;
let activeGpuResolution = 0;

export function registerForestLightingGpuDevice(device: GPUDevice | null): void {
  if (registeredGpuDevice === device) return;
  activeGpuTexture?.destroy();
  activeGpuAuxTexture?.destroy();
  activeGpuTexture = null;
  activeGpuAuxTexture = null;
  activeGpuResolution = 0;
  registeredGpuDevice = device;
  if (device && activeHandle) uploadActiveGpuTextures(activeHandle);
}

export function activeForestLightingGpuTexture(): ForestLightingGpuTextureSource | null {
  if (!activeHandle || !activeGpuTexture || !activeGpuAuxTexture) return null;
  return {
    texture: activeGpuTexture,
    auxTexture: activeGpuAuxTexture,
    resolution: activeHandle.resolution,
    worldCells: activeHandle.worldCells,
  };
}

export function sampleActiveForestCanopyEcology(x: number, z: number): ForestCanopyEcologySample | null {
  const handle = activeHandle;
  if (!handle || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  const data = handle.auxTexture.image.data as Uint8Array;
  const worldSize = Math.max(1, handle.worldCells);
  const resolution = Math.max(1, handle.resolution);
  const tx = clamp01(x / worldSize) * Math.max(0, resolution - 1);
  const tz = clamp01(z / worldSize) * Math.max(0, resolution - 1);
  return {
    canopyDensity: sampleBilinearChannel(data, resolution, tx, tz, 0),
    forestEdge: sampleBilinearChannel(data, resolution, tx, tz, 1),
    understoryDensity: sampleBilinearChannel(data, resolution, tx, tz, 2),
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
      if (activeHandle === handle) uploadActiveGpuTextures(handle);
    },
    dispose() {
      texture.dispose();
      auxTexture.dispose();
      if (activeHandle !== handle) return;
      activeHandle = null;
      activeGpuTexture?.destroy();
      activeGpuAuxTexture?.destroy();
      activeGpuTexture = null;
      activeGpuAuxTexture = null;
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

function uploadActiveGpuTextures(handle: ForestLightingTextureHandle): void {
  const device = registeredGpuDevice;
  if (!device) return;
  if (!activeGpuTexture || !activeGpuAuxTexture || activeGpuResolution !== handle.resolution) {
    activeGpuTexture?.destroy();
    activeGpuAuxTexture?.destroy();
    activeGpuTexture = createGpuTexture(device, handle.resolution, "forest lighting canonical GPU texture");
    activeGpuAuxTexture = createGpuTexture(device, handle.resolution, "forest canopy ecology canonical GPU texture");
    activeGpuResolution = handle.resolution;
  }
  uploadTextureBytes(device, activeGpuTexture, handle.texture.image.data as Uint8Array, handle.resolution);
  uploadTextureBytes(device, activeGpuAuxTexture, handle.auxTexture.image.data as Uint8Array, handle.resolution);
}

function createGpuTexture(device: GPUDevice, resolution: number, label: string): GPUTexture {
  return device.createTexture({
    label,
    size: { width: resolution, height: resolution },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
}

function uploadTextureBytes(
  device: GPUDevice,
  texture: GPUTexture,
  source: Uint8Array,
  resolution: number,
): void {
  const rowBytes = resolution * 4;
  const bytesPerRow = alignTo(rowBytes, 256);
  const upload = bytesPerRow === rowBytes
    ? source
    : padRows(source, resolution, rowBytes, bytesPerRow);
  device.queue.writeTexture(
    { texture },
    upload as GPUAllowSharedBufferSource,
    { bytesPerRow, rowsPerImage: resolution },
    { width: resolution, height: resolution },
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

function sampleBilinearChannel(
  data: Uint8Array,
  resolution: number,
  x: number,
  z: number,
  channel: number,
): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = Math.min(resolution - 1, x0 + 1);
  const z1 = Math.min(resolution - 1, z0 + 1);
  const tx = x - x0;
  const tz = z - z0;
  const a = sampleByteChannel(data, resolution, x0, z0, channel);
  const b = sampleByteChannel(data, resolution, x1, z0, channel);
  const c = sampleByteChannel(data, resolution, x0, z1, channel);
  const d = sampleByteChannel(data, resolution, x1, z1, channel);
  return mix(mix(a, b, tx), mix(c, d, tx), tz);
}

function sampleByteChannel(
  data: Uint8Array,
  resolution: number,
  x: number,
  z: number,
  channel: number,
): number {
  const offset = (z * resolution + x) * 4 + channel;
  return (data[offset] ?? 0) / 255;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function byte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0)) * 255);
}
