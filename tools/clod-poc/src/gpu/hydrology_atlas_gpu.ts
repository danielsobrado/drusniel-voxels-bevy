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
  bodyPhaseTexture: GPUTexture;
  prefetchRadiusM: number;
  uploads: number;
  uploadedTexels: number;
}

interface HydrologyAtlasGpuFallback {
  device: GPUDevice;
  waterTexture: GPUTexture;
  fieldsTexture: GPUTexture;
  bodyPhaseTexture: GPUTexture;
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
    includeBodyPhase: true,
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
    bodyPhaseTexture: device.createTexture({
      label: "hydrology streaming atlas gravel phase",
      size: { width: atlas.res, height: atlas.res },
      format: "r32float",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    }),
    prefetchRadiusM: (source.atlasTilesPerSide / 2) * source.tileSizeM,
    uploads: 0,
    uploadedTexels: 0,
  };
}

export function resetHydrologyAtlasGpu(): void {
  state?.waterTexture.destroy();
  state?.fieldsTexture.destroy();
  state?.bodyPhaseTexture.destroy();
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

/** Stone-only R32 atlas texture containing a stable phase derived from bodyId. */
export function hydrologyAtlasGpuBodyPhaseTexture(device: GPUDevice): GPUTexture {
  return atlasTexturesFor(device).bodyPhaseTexture;
}

/** Per-dispatch uniform payload: (originX, originZ, cellSize, enabled). */
export function hydrologyAtlasGpuParams(): [number, number, number, number] {
  if (!state || !state.atlas.initialized) return [0, 0, 0, 0];
  return [state.atlas.originX, state.atlas.originZ, state.atlas.cellSize, 1];
}

/** Recenter/refill the CPU atlas and upload changed atlas rectangles. */
export function updateHydrologyAtlasGpu(centerX: number, centerZ: number): void {
  if (!state) return;
  state.source.prefetch(centerX, centerZ, state.prefetchRadiusM);
  const dirty = state.atlas.update(centerX, centerZ, state.source);
  const rgbaBytesPerRow = state.atlas.res * 16;
  const phaseBytesPerRow = state.atlas.res * 4;
  const bodyPhase = state.atlas.bodyPhase;
  for (const rect of dirty) {
    const rgbaLayout = {
      offset: (rect.z * state.atlas.res + rect.x) * 16,
      bytesPerRow: rgbaBytesPerRow,
    };
    const size = { width: rect.width, height: rect.height };
    state.device.queue.writeTexture(
      { texture: state.waterTexture, origin: { x: rect.x, y: rect.z } },
      state.atlas.data,
      rgbaLayout,
      size,
    );
    state.device.queue.writeTexture(
      { texture: state.fieldsTexture, origin: { x: rect.x, y: rect.z } },
      state.atlas.dataB,
      rgbaLayout,
      size,
    );
    if (bodyPhase) {
      state.device.queue.writeTexture(
        { texture: state.bodyPhaseTexture, origin: { x: rect.x, y: rect.z } },
        bodyPhase,
        {
          offset: (rect.z * state.atlas.res + rect.x) * 4,
          bytesPerRow: phaseBytesPerRow,
        },
        size,
      );
    }
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

function atlasTexturesFor(
  device: GPUDevice,
): Pick<HydrologyAtlasGpuState, "waterTexture" | "fieldsTexture" | "bodyPhaseTexture"> {
  if (state && state.device === device) return state;
  if (!fallback || fallback.device !== device) {
    fallback?.waterTexture.destroy();
    fallback?.fieldsTexture.destroy();
    fallback?.bodyPhaseTexture.destroy();
    const rgbaDescriptor: GPUTextureDescriptor = {
      size: { width: 1, height: 1 },
      format: "rgba32float",
      usage: GPUTextureUsage.TEXTURE_BINDING,
    };
    fallback = {
      device,
      waterTexture: device.createTexture({ ...rgbaDescriptor, label: "hydrology atlas layout a fallback" }),
      fieldsTexture: device.createTexture({ ...rgbaDescriptor, label: "hydrology atlas layout b fallback" }),
      bodyPhaseTexture: device.createTexture({
        label: "hydrology atlas gravel phase fallback",
        size: { width: 1, height: 1 },
        format: "r32float",
        usage: GPUTextureUsage.TEXTURE_BINDING,
      }),
    };
  }
  return fallback;
}
