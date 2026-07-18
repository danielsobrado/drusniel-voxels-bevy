// GPU side of the streaming hydrology atlas (Phase 4b).
//
// Shared rgba32float textures hold the camera-following Layout A and Layout B windows
// built by HydrologyStreamingAtlas. Vegetation placement computes bind them beside the
// static startup-world hydrology textures and sample them for positions outside the
// startup world. Module-scoped like the other vegetation GPU wiring: initialized once
// before ring computes are created and updated once per frame.
import {
  HydrologyStreamingAtlas,
  type HydrologyStreamingAtlasStats,
  type HydrologyTileAtlasSource,
} from "../water/hydrologyAtlas.js";

interface HydrologyAtlasGpuState {
  device: GPUDevice;
  atlas: HydrologyStreamingAtlas;
  source: HydrologyTileAtlasSource;
  waterTexture: GPUTexture;
  fieldsTexture: GPUTexture;
  prefetchRadiusM: number;
  uploads: number;
  uploadedTexels: number;
}

interface HydrologyAtlasGpuFallback {
  device: GPUDevice;
  waterTexture: GPUTexture;
  fieldsTexture: GPUTexture;
}

let state: HydrologyAtlasGpuState | null = null;
let fallback: HydrologyAtlasGpuFallback | null = null;

export function initHydrologyAtlasGpu(device: GPUDevice, source: HydrologyTileAtlasSource): void {
  resetHydrologyAtlasGpu();
  if (source.atlasTilesPerSide <= 0) return;
  const atlas = new HydrologyStreamingAtlas({
    tileSizeM: source.tileSizeM,
    tileRes: source.tileRes,
    tilesPerSide: source.atlasTilesPerSide,
  });
  const textureDescriptor: GPUTextureDescriptor = {
    size: { width: atlas.res, height: atlas.res },
    format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  };
  state = {
    device,
    atlas,
    source,
    waterTexture: device.createTexture({ ...textureDescriptor, label: "hydrology streaming atlas layout a" }),
    fieldsTexture: device.createTexture({ ...textureDescriptor, label: "hydrology streaming atlas layout b" }),
    // Half the window edge covers every tile the tile-snapped window can need before
    // the next recenter.
    prefetchRadiusM: (source.atlasTilesPerSide / 2) * source.tileSizeM,
    uploads: 0,
    uploadedTexels: 0,
  };
}

export function resetHydrologyAtlasGpu(): void {
  state?.waterTexture.destroy();
  state?.fieldsTexture.destroy();
  state = null;
}

/** Layout A atlas texture. A 1x1 texture disables the shader path. */
export function hydrologyAtlasGpuTexture(device: GPUDevice): GPUTexture {
  return atlasTexturesFor(device).waterTexture;
}

/** Layout B atlas texture: flow XY, flow strength, and raw body kind. */
export function hydrologyAtlasGpuFieldsTexture(device: GPUDevice): GPUTexture {
  return atlasTexturesFor(device).fieldsTexture;
}

/** Per-dispatch uniform payload: (originX, originZ, cellSize, enabled). */
export function hydrologyAtlasGpuParams(): [number, number, number, number] {
  if (!state || !state.atlas.initialized) return [0, 0, 0, 0];
  return [state.atlas.originX, state.atlas.originZ, state.atlas.cellSize, 1];
}

/** Recenter/refill the CPU atlas and upload changed Layout A and Layout B rectangles. */
export function updateHydrologyAtlasGpu(centerX: number, centerZ: number): void {
  if (!state) return;
  state.source.prefetch(centerX, centerZ, state.prefetchRadiusM);
  const dirty = state.atlas.update(centerX, centerZ, state.source);
  const bytesPerRow = state.atlas.res * 16;
  for (const rect of dirty) {
    const dataLayout = {
      offset: (rect.z * state.atlas.res + rect.x) * 16,
      bytesPerRow,
    };
    const size = { width: rect.width, height: rect.height };
    state.device.queue.writeTexture(
      { texture: state.waterTexture, origin: { x: rect.x, y: rect.z } },
      state.atlas.data,
      dataLayout,
      size,
    );
    state.device.queue.writeTexture(
      { texture: state.fieldsTexture, origin: { x: rect.x, y: rect.z } },
      state.atlas.dataB,
      dataLayout,
      size,
    );
    state.uploads++;
    state.uploadedTexels += rect.width * rect.height;
  }
}

export interface HydrologyAtlasGpuStats extends HydrologyStreamingAtlasStats {
  uploads: number;
  uploadedTexels: number;
  res: number;
}

export function hydrologyAtlasGpuStats(): HydrologyAtlasGpuStats | null {
  if (!state) return null;
  return {
    ...state.atlas.currentStats(),
    uploads: state.uploads,
    uploadedTexels: state.uploadedTexels,
    res: state.atlas.res,
  };
}

function atlasTexturesFor(device: GPUDevice): Pick<HydrologyAtlasGpuState, "waterTexture" | "fieldsTexture"> {
  if (state && state.device === device) return state;
  if (!fallback || fallback.device !== device) {
    fallback?.waterTexture.destroy();
    fallback?.fieldsTexture.destroy();
    const descriptor: GPUTextureDescriptor = {
      size: { width: 1, height: 1 },
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    };
    fallback = {
      device,
      waterTexture: device.createTexture({ ...descriptor, label: "hydrology atlas layout a fallback" }),
      fieldsTexture: device.createTexture({ ...descriptor, label: "hydrology atlas layout b fallback" }),
    };
  }
  return fallback;
}
