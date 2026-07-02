import type { TreeHydrologyData } from "./tree_ring_compute.js";

export function createTreeHydrologyTexture(device: GPUDevice, hydroData: TreeHydrologyData | null): GPUTexture {
  if (hydroData && hydroData.data.length > 0) {
    const texture = device.createTexture({
      label: "tree ring hydro texture",
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
    label: "tree ring fallback hydro texture",
    size: { width: 1, height: 1 },
    format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING,
  });
}
