import type { FarSummaryConfig } from "./config.js";
import { computeRequiredFarSummaryTiles, tileWorldBounds } from "./clipmap-rings.js";
import type { FarSummaryRingRequest, TileBounds } from "./clipmap-rings.js";
import type { StreamCenter } from "./stream-center.js";
import type { FarSummaryTileKey } from "./types.js";
import {
  FAR_SUMMARY_GPU_DESCRIPTOR_BYTES,
  FAR_SUMMARY_GPU_RECORD_BYTES,
  type FarSummaryGpuConfig,
} from "./gpu-config.js";

export type FarSummaryGpuDirtyReason =
  | "startup"
  | "camera_ring_shift"
  | "streamed_page_ready"
  | "edit"
  | "water_change"
  | "fallback_rebuild"
  | "debug_force";

export interface FarSummaryGpuDirtyTile {
  key: FarSummaryTileKey;
  ring: number;
  tileX: number;
  tileZ: number;
  cellSizeM: number;
  tileCells: number;
  originX: number;
  originZ: number;
  sizeX: number;
  sizeZ: number;
  sampleGrid: number;
  priority: number;
  distanceToCamera: number;
  distanceToPredictedCenter: number;
  reason: FarSummaryGpuDirtyReason;
  revision: number;
}

export interface FarSummaryGpuBatch {
  tiles: FarSummaryGpuDirtyTile[];
  descriptorBytes: number;
  outputBytes: number;
  readbackBytes: number;
  totalBytes: number;
}

export interface FarSummaryGpuPlan {
  dirtyTiles: FarSummaryGpuDirtyTile[];
  batches: FarSummaryGpuBatch[];
  droppedTiles: number;
  estimatedBufferBytes: number;
}

export function planFarSummaryGpuDirtyTiles(
  center: StreamCenter,
  farSummaryConfig: FarSummaryConfig,
  gpuConfig: FarSummaryGpuConfig,
  reason: FarSummaryGpuDirtyReason,
  revision: number,
): FarSummaryGpuDirtyTile[] {
  const requests = computeRequiredFarSummaryTiles(center, farSummaryConfig);
  return requests.map((request) => requestToDirtyTile(request, farSummaryConfig, gpuConfig, reason, revision));
}

export function buildFarSummaryGpuPlan(
  center: StreamCenter,
  farSummaryConfig: FarSummaryConfig,
  gpuConfig: FarSummaryGpuConfig,
  reason: FarSummaryGpuDirtyReason,
  revision: number,
): FarSummaryGpuPlan {
  const dirtyTiles = planFarSummaryGpuDirtyTiles(center, farSummaryConfig, gpuConfig, reason, revision);
  const batches = splitFarSummaryGpuBatches(dirtyTiles, gpuConfig);
  const scheduledTiles = batches.reduce((sum, batch) => sum + batch.tiles.length, 0);
  return {
    dirtyTiles,
    batches,
    droppedTiles: Math.max(0, dirtyTiles.length - scheduledTiles),
    estimatedBufferBytes: batches.reduce((sum, batch) => Math.max(sum, batch.totalBytes), 0),
  };
}

export function splitFarSummaryGpuBatches(
  dirtyTiles: readonly FarSummaryGpuDirtyTile[],
  config: FarSummaryGpuConfig,
): FarSummaryGpuBatch[] {
  const batches: FarSummaryGpuBatch[] = [];
  const maxTilesPerBatch = Math.max(1, Math.floor(config.maxTilesPerBatch));
  const maxBatches = Math.max(1, Math.floor(config.maxBatchesPerFrame));
  let index = 0;

  while (index < dirtyTiles.length && batches.length < maxBatches) {
    const nextTiles: FarSummaryGpuDirtyTile[] = [];
    while (index < dirtyTiles.length && nextTiles.length < maxTilesPerBatch) {
      const candidate = dirtyTiles[index];
      if (!candidate) break;
      const nextCount = nextTiles.length + 1;
      const nextBytes = estimateFarSummaryGpuBatchBytes(nextCount, config);
      if (nextBytes > config.maxBufferBytes && nextTiles.length > 0) break;
      if (nextBytes > config.maxBufferBytes) {
        index++;
        continue;
      }
      nextTiles.push(candidate);
      index++;
    }
    if (nextTiles.length === 0) break;
    batches.push(createBatch(nextTiles, config));
  }

  return batches;
}

export function estimateFarSummaryGpuBatchBytes(tileCount: number, config: FarSummaryGpuConfig): number {
  const safeTileCount = Math.max(0, Math.floor(tileCount));
  const descriptorBytes = safeTileCount * FAR_SUMMARY_GPU_DESCRIPTOR_BYTES;
  const outputBytes = safeTileCount * FAR_SUMMARY_GPU_RECORD_BYTES;
  const readbackBytes = estimateFarSummaryGpuReadbackBytes(safeTileCount, config);
  return descriptorBytes + outputBytes + readbackBytes;
}

export function farSummaryGpuTileBounds(tile: Pick<FarSummaryGpuDirtyTile, "key" | "cellSizeM" | "tileCells">): TileBounds {
  return tileWorldBounds(tile.key, tile.cellSizeM, tile.tileCells);
}

function requestToDirtyTile(
  request: FarSummaryRingRequest,
  farSummaryConfig: FarSummaryConfig,
  gpuConfig: FarSummaryGpuConfig,
  reason: FarSummaryGpuDirtyReason,
  revision: number,
): FarSummaryGpuDirtyTile {
  const ring = farSummaryConfig.rings[request.ring];
  if (!ring) throw new Error(`missing far-summary ring ${request.ring}`);
  const bounds = tileWorldBounds(request.key, ring.cellM, ring.tileCells);
  return {
    key: request.key,
    ring: request.ring,
    tileX: request.key.x,
    tileZ: request.key.z,
    cellSizeM: ring.cellM,
    tileCells: ring.tileCells,
    originX: bounds.minX,
    originZ: bounds.minZ,
    sizeX: bounds.maxX - bounds.minX,
    sizeZ: bounds.maxZ - bounds.minZ,
    sampleGrid: gpuConfig.sampleGrid,
    priority: request.priority,
    distanceToCamera: request.distanceToCamera,
    distanceToPredictedCenter: request.distanceToPredictedCenter,
    reason,
    revision,
  };
}

function createBatch(tiles: FarSummaryGpuDirtyTile[], config: FarSummaryGpuConfig): FarSummaryGpuBatch {
  const descriptorBytes = tiles.length * FAR_SUMMARY_GPU_DESCRIPTOR_BYTES;
  const outputBytes = tiles.length * FAR_SUMMARY_GPU_RECORD_BYTES;
  const readbackBytes = estimateFarSummaryGpuReadbackBytes(tiles.length, config);
  return {
    tiles,
    descriptorBytes,
    outputBytes,
    readbackBytes,
    totalBytes: descriptorBytes + outputBytes + readbackBytes,
  };
}

function estimateFarSummaryGpuReadbackBytes(tileCount: number, config: FarSummaryGpuConfig): number {
  const readbackTiles = config.commitToCache
    ? tileCount
    : config.debugReadback ? Math.min(tileCount, config.debugReadbackTiles) : 0;
  return readbackTiles * FAR_SUMMARY_GPU_RECORD_BYTES;
}
