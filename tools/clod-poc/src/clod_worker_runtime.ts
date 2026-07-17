import { baseSurfaceHeight, setBorderCoastRuntime, setTerrainSurfaceOverride } from "./terrain/terrain.js";
import { makeStartupHeightfieldSampler, type StartupHeightfieldRaster } from "./terrain/startup_heightfield_raster.js";
import type { ClodWorkerRequest, ClodWorkerResponse, SerializedHydrologyTerrain } from "./clod_worker_protocol.js";
import type { HeightfieldTileWorkerResponse } from "./world/heightfield_tiles/heightfield_tile_worker_protocol.js";
import type { ClodPagesConfig } from "./config.js";

export type ExtendedClodWorkerResponse = ClodWorkerResponse | HeightfieldTileWorkerResponse;

export interface WorkerPostContext {
  postMessage(message: ExtendedClodWorkerResponse, transfer?: Transferable[]): void;
}

export interface InstallHydrologyTerrainOptions {
  /**
   * When set, coordinates outside [0..worldCells] fall back to the base terrain
   * field instead of the edge-clamped carved grid. Used for streamed root pages
   * outside the startup world so worker meshes match main-thread live chunks
   * (HydrologySystem.terrainHeight applies the same bound). The startup world
   * build keeps the legacy clamp so cached page geometry stays byte-stable.
   */
  boundedToStartupWorld?: boolean;
}

export function installHydrologyTerrain(
  terrain: SerializedHydrologyTerrain | null | undefined,
  options: InstallHydrologyTerrainOptions = {},
): void {
  if (!terrain) {
    setTerrainSurfaceOverride(null);
    return;
  }
  const { res, worldCells, carvedBed } = terrain;
  const bounded = options.boundedToStartupWorld === true;
  const scale = (res - 1) / Math.max(1e-6, worldCells);
  setTerrainSurfaceOverride((x, z) => {
    if (bounded && (x < 0 || z < 0 || x > worldCells || z > worldCells)) {
      return baseSurfaceHeight(x, z);
    }
    const gx = Math.max(0, Math.min(res - 1, x * scale));
    const gz = Math.max(0, Math.min(res - 1, z * scale));
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const x1 = Math.min(res - 1, x0 + 1);
    const z1 = Math.min(res - 1, z0 + 1);
    const fx = gx - x0;
    const fz = gz - z0;
    const a = carvedBed[z0 * res + x0] * (1 - fx) + carvedBed[z0 * res + x1] * fx;
    const b = carvedBed[z1 * res + x0] * (1 - fx) + carvedBed[z1 * res + x1] * fx;
    return a * (1 - fz) + b * fz;
  });
}

/**
 * Install the active terrain surface override for worker builds. The startup heightfield
 * raster (unified mode) wins when present: it already falls back to the base field outside
 * its padded domain, so it covers both the startup-world build and the bounded semantics
 * streamed roots need. Otherwise the legacy carved hydrology grid path applies.
 */
export function installWorkerTerrainOverride(
  startupHeightfield: StartupHeightfieldRaster | null | undefined,
  hydrologyTerrain: SerializedHydrologyTerrain | null | undefined,
  options: InstallHydrologyTerrainOptions = {},
  rasterFallback?: (x: number, z: number) => number,
): void {
  if (startupHeightfield) {
    setTerrainSurfaceOverride(makeStartupHeightfieldSampler(startupHeightfield, rasterFallback));
    return;
  }
  if (rasterFallback) {
    setTerrainSurfaceOverride(rasterFallback);
    return;
  }
  installHydrologyTerrain(hydrologyTerrain, options);
}

export function installBorderCoastRuntime(
  config: Extract<ClodWorkerRequest, { type: "build" }>["borderCoastOceanConfig"],
  worldPagesX: number,
  pagesCfg: ClodPagesConfig,
): void {
  const worldCells = worldPagesX * pagesCfg.page.chunks_per_page * pagesCfg.page.chunk_size;
  setBorderCoastRuntime(config ?? null, worldCells);
}

export function postWorkerMessage(ctx: WorkerPostContext, message: ExtendedClodWorkerResponse, transfer?: Transferable[]): void {
  if (!transfer || transfer.length === 0) {
    ctx.postMessage(message);
    return;
  }
  const safeTransfer: Transferable[] = [];
  for (const item of transfer) {
    if (!(item instanceof ArrayBuffer) || item.byteLength === 0 || safeTransfer.includes(item)) continue;
    safeTransfer.push(item);
  }
  ctx.postMessage(message, safeTransfer);
}

export function errorResponse(requestId: number | null, error: unknown): ClodWorkerResponse {
  const err = error as Error & { code?: string; details?: Record<string, unknown> };
  return {
    type: "error",
    requestId,
    message: err?.message ?? String(error),
    name: err?.name,
    code: err?.code,
    details: err?.details,
  };
}
