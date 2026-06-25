import type { FarSummaryConfig } from "./config.js";
import type { FarSummaryTileKey, FarSummaryTile } from "./types.js";
import { worldToTileCoord } from "./tile-key.js";
import type { StreamCenter } from "./stream-center.js";

export interface FarSummaryRingRequest {
  ring: number;
  key: FarSummaryTileKey;
  priority: number;
  distanceToCamera: number;
  distanceToPredictedCenter: number;
}

export interface TileBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function tileWorldBounds(
  key: FarSummaryTileKey | Pick<FarSummaryTileKey, 'x' | 'z'>,
  cellSizeM: number,
  tileCells: number,
): TileBounds {
  const tileSize = cellSizeM * tileCells;
  return {
    minX: key.x * tileSize,
    maxX: (key.x + 1) * tileSize,
    minZ: key.z * tileSize,
    maxZ: (key.z + 1) * tileSize,
  };
}

export function computeRequiredFarSummaryTiles(
  center: StreamCenter,
  config: FarSummaryConfig,
): FarSummaryRingRequest[] {
  const requests: FarSummaryRingRequest[] = [];
  const predictedX = center.predictedX;
  const predictedZ = center.predictedZ;

  for (let ri = 0; ri < config.rings.length; ri++) {
    const ring = config.rings[ri];
    const radiusM = ring.endM;

    const minTileX = worldToTileCoord(predictedX - radiusM, ring.cellM, ring.tileCells);
    const maxTileX = worldToTileCoord(predictedX + radiusM, ring.cellM, ring.tileCells);
    const minTileZ = worldToTileCoord(predictedZ - radiusM, ring.cellM, ring.tileCells);
    const maxTileZ = worldToTileCoord(predictedZ + radiusM, ring.cellM, ring.tileCells);

    const tileCount = (maxTileX - minTileX + 1) * (maxTileZ - minTileZ + 1);
    if (tileCount > 10000) {
      console.warn(`[far-summary] ring ${ri} tile count ${tileCount} exceeds sanity limit; clamping`);
      continue;
    }

    for (let tz = minTileZ; tz <= maxTileZ; tz++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        const bounds = tileWorldBounds({ x: tx, z: tz }, ring.cellM, ring.tileCells);
        const tileCenterX = (bounds.minX + bounds.maxX) / 2;
        const tileCenterZ = (bounds.minZ + bounds.maxZ) / 2;
        const distCamera = Math.hypot(tileCenterX - center.worldX, tileCenterZ - center.worldZ);
        const distPredicted = Math.hypot(tileCenterX - predictedX, tileCenterZ - predictedZ);

        if (distCamera < ring.startM) {
          continue;
        }

        // Lower cost = more important = earlier in the build queue.
        // aheadCost: 0 = ahead of movement, ~500 = sideways, ~1000 = behind.
        const aheadCost = computeAheadCost(
          tileCenterX, tileCenterZ,
          center.worldX, center.worldZ,
          center.velocityX, center.velocityZ,
        );
        const distanceCost = Math.round(distPredicted);

        const priority = (
          ri * 1_000_000 +
          aheadCost * 1_000 +
          distanceCost
        );

        requests.push({
          ring: ri,
          key: { ring: ri, x: tx, z: tz, cellSizeM: ring.cellM },
          priority,
          distanceToCamera: distCamera,
          distanceToPredictedCenter: distPredicted,
        });
      }
    }
  }

  requests.sort((a, b) => a.priority - b.priority);
  return requests;
}

/**
 * Cost for tile priority: 0 when moving directly toward the tile,
 * ~500 for sideways, ~1000 for directly behind. Lower = more urgent.
 * When stationary, returns 500 (neutral).
 */
function computeAheadCost(
  tx: number, tz: number,
  cx: number, cz: number,
  vx: number, vz: number,
): number {
  const speed = Math.hypot(vx, vz);
  if (speed < 0.01) return 500;

  const dx = tx - cx;
  const dz = tz - cz;
  const dist = Math.hypot(dx, dz);
  if (dist < 1) return 500;

  const dot = (dx * vx + dz * vz) / (dist * speed);
  return Math.round((1 - dot) * 500);
}

export function findCachedTileForSample(
  cache: Map<string, FarSummaryTile>,
  x: number,
  z: number,
  preferredRing: number,
): FarSummaryTile | null {
  const candidates: FarSummaryTile[] = [];
  for (const tile of cache.values()) {
    if (tile.state === 'evicted') continue;
    const bounds = tileWorldBounds(tile.key, tile.cellSizeM, tile.tileCells);
    if (x >= bounds.minX && x < bounds.maxX && z >= bounds.minZ && z < bounds.maxZ) {
      candidates.push(tile);
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const aRing = a.key.ring;
    const bRing = b.key.ring;
    const aPreferred = Math.abs(aRing - preferredRing);
    const bPreferred = Math.abs(bRing - preferredRing);
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    const aReady = a.state === 'ready' ? 0 : a.state === 'stale' ? 1 : a.state === 'cooling' ? 2 : 3;
    const bReady = b.state === 'ready' ? 0 : b.state === 'stale' ? 1 : b.state === 'cooling' ? 2 : 3;
    return aReady - bReady;
  });

  return candidates[0] ?? null;
}
