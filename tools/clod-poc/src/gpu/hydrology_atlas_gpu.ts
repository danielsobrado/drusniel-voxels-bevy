// GPU side of the streaming hydrology atlas (Phase 4b).
//
// One shared rgba32float texture holds the camera-following Layout A window built by
// HydrologyStreamingAtlas; every vegetation placement compute (grass/understory/stone/
// tree rings) binds it next to its static startup-world hydrology texture and samples it
// for world positions OUTSIDE [0, worldCells] (see placement_height.wgsl). Module-scoped
// like the other vegetation GPU wiring (e.g. setTreeGpuRingHydrologyData): initialized
// once in runVegetationStartup before any ring compute is created, updated once per
// frame from the vegetation frame phase.
import {
  HydrologyStreamingAtlas,
  type HydrologyStreamingAtlasStats,
  type HydrologyTileAtlasSource,
} from "../water/hydrologyAtlas.js";

interface HydrologyAtlasGpuState {
  device: GPUDevice;
  atlas: HydrologyStreamingAtlas;
  source: HydrologyTileAtlasSource;
  texture: GPUTexture;
  prefetchRadiusM: number;
  uploads: number;
  uploadedTexels: number;
}

let state: HydrologyAtlasGpuState | null = null;
let fallback: { device: GPUDevice; texture: GPUTexture } | null = null;

export function initHydrologyAtlasGpu(device: GPUDevice, source: HydrologyTileAtlasSource): void {
  resetHydrologyAtlasGpu();
  if (source.atlasTilesPerSide <= 0) return;
  const atlas = new HydrologyStreamingAtlas({
    tileSizeM: source.tileSizeM,
    tileRes: source.tileRes,
    tilesPerSide: source.atlasTilesPerSide,
  });
  const texture = device.createTexture({
    label: "hydrology streaming atlas",
    size: { width: atlas.res, height: atlas.res },
    format: "rgba32float",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  state = {
    device,
    atlas,
    source,
    texture,
    // Half the window edge: a square prefetch ring of this radius covers every tile the
    // tile-snapped window can need before the next recenter.
    prefetchRadiusM: (source.atlasTilesPerSide / 2) * source.tileSizeM,
    uploads: 0,
    uploadedTexels: 0,
  };
}

export function resetHydrologyAtlasGpu(): void {
  state?.texture.destroy();
  state = null;
}

/** Shared atlas texture for placement compute bind groups; a 1×1 texture (dimension 1
 *  disables the shader path) when no atlas is active or it lives on another device. */
export function hydrologyAtlasGpuTexture(device: GPUDevice): GPUTexture {
  if (state && state.device === device) return state.texture;
  if (!fallback || fallback.device !== device) {
    fallback = {
      device,
      texture: device.createTexture({
        label: "hydrology streaming atlas fallback",
        size: { width: 1, height: 1 },
        format: "rgba32float",
        usage: GPUTextureUsage.TEXTURE_BINDING,
      }),
    };
  }
  return fallback.texture;
}

/** Per-dispatch uniform payload: (originX, originZ, cellSize, enabled). */
export function hydrologyAtlasGpuParams(): [number, number, number, number] {
  if (!state || !state.atlas.initialized) return [0, 0, 0, 0];
  return [state.atlas.originX, state.atlas.originZ, state.atlas.cellSize, 1];
}

/** Recenter/refill the CPU atlas around the vegetation ring center and upload any texel
 *  rects that changed. Call once per frame before the ring computes dispatch. */
export function updateHydrologyAtlasGpu(centerX: number, centerZ: number): void {
  if (!state) return;
  state.source.prefetch(centerX, centerZ, state.prefetchRadiusM);
  const dirty = state.atlas.update(centerX, centerZ, state.source);
  const bytesPerRow = state.atlas.res * 16;
  for (const rect of dirty) {
    state.device.queue.writeTexture(
      { texture: state.texture, origin: { x: rect.x, y: rect.z } },
      state.atlas.data,
      { offset: (rect.z * state.atlas.res + rect.x) * 16, bytesPerRow },
      { width: rect.width, height: rect.height },
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
