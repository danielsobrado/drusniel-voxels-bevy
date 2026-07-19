import type {
  GrassGpuRingOutputBuffers,
  GrassGpuTierOutputBuffers,
  GrassHydrologyData,
} from "./grass_ring_compute.js";

const TIER_COUNT = 4;

export function createGrassGpuRingFallbackOutputBuffers(
  device: GPUDevice,
  slotCount: number,
  indirectArgs: GPUBuffer,
): GrassGpuRingOutputBuffers {
  const bytes = Math.max(16, Math.max(1, slotCount) * TIER_COUNT * 4 * Float32Array.BYTES_PER_ELEMENT);
  const shared: GrassGpuTierOutputBuffers = {
    offset: device.createBuffer({ label: "grass ring fallback offset", size: bytes, usage: GPUBufferUsage.STORAGE }),
    packed0: device.createBuffer({ label: "grass ring fallback packed0", size: bytes, usage: GPUBufferUsage.STORAGE }),
    packed1: device.createBuffer({ label: "grass ring fallback packed1", size: bytes, usage: GPUBufferUsage.STORAGE }),
    terrainNormal: device.createBuffer({ label: "grass ring fallback normal", size: bytes, usage: GPUBufferUsage.STORAGE }),
  };
  return {
    near: shared,
    mid: shared,
    far: shared,
    super: shared,
    indirectArgs,
  };
}

export function createGrassHydrologyTexture(device: GPUDevice, hydroData: GrassHydrologyData | null): GPUTexture {
  if (hydroData && hydroData.data.length > 0) {
    const texture = device.createTexture({
      label: "grass ring hydro texture",
      size: { width: hydroData.res, height: hydroData.res },
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const bytes = new Uint8Array(hydroData.data.byteLength);
    bytes.set(new Uint8Array(hydroData.data.buffer, hydroData.data.byteOffset, hydroData.data.byteLength));
    device.queue.writeTexture(
      { texture },
      bytes,
      { bytesPerRow: hydroData.res * 16 },
      { width: hydroData.res, height: hydroData.res },
    );
    return texture;
  }

  return device.createTexture({
    label: "grass ring fallback hydro texture",
    size: { width: 1, height: 1 },
    format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
}

export function createGrassSunVisibilityFallbackTexture(device: GPUDevice): GPUTexture {
  const texture = device.createTexture({
    label: "grass ring fail-open sun visibility",
    size: { width: 1, height: 1 },
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture(
    { texture },
    new Uint8Array([0, 0, 0, 0]),
    {},
    { width: 1, height: 1 },
  );
  return texture;
}
