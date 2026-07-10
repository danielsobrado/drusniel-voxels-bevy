import type { CanopyShellConfig } from "./canopy_types_internal.js";
import type { CanopyMetrics, CanopySummaryTile, CanopyWorldKey } from "./canopy_types.js";
import { createEmptyCanopyMetrics, stableTileKey } from "./canopy_types.js";
import { createCanopySummaryTileJob, tileResolutionForCellSize, type CanopySummaryTileJob } from "./canopy_summary_builder.js";
import type { CanopyTerrainSampler } from "./canopy_terrain_sampler.js";
import type { TreeDistribution } from "./deterministic_tree_distribution.js";

export interface CanopyClipmapUpdate {
  metrics: CanopyMetrics;
  texturesDirty: boolean;
  centerX: number;
  centerZ: number;
}

export interface CanopyClipmap {
  update(
    cameraX: number,
    cameraZ: number,
    config: CanopyShellConfig,
    terrainSampler: CanopyTerrainSampler,
    treeDistribution: TreeDistribution,
  ): CanopyClipmapUpdate;
  getVisibleTiles(): CanopySummaryTile[];
  getTileMetrics(): CanopyMetrics;
  setFreezeCenter(enabled: boolean): void;
  disposeFarTiles(): void;
  dispose(): void;
}

export function ringForDistance(dist: number, config: CanopyShellConfig): number | null {
  for (let i = 0; i < config.clipmap.rings.length; i++) {
    const ring = config.clipmap.rings[i];
    if (dist >= ring.startM && dist < ring.endM) return i;
  }
  return null;
}

function wantedTileMap(
  cameraX: number,
  cameraZ: number,
  config: CanopyShellConfig,
): Map<string, CanopyWorldKey> {
  const { tileSizeM } = config.clipmap;
  const wanted = new Map<string, CanopyWorldKey>();
  const maxEnd = config.distances.shellEndM + tileSizeM;
  const tileRadius = Math.ceil(maxEnd / tileSizeM);
  const centerTileX = Math.floor(cameraX / tileSizeM);
  const centerTileZ = Math.floor(cameraZ / tileSizeM);

  for (let tz = centerTileZ - tileRadius; tz <= centerTileZ + tileRadius; tz++) {
    for (let tx = centerTileX - tileRadius; tx <= centerTileX + tileRadius; tx++) {
      const tileCenterX = (tx + 0.5) * tileSizeM;
      const tileCenterZ = (tz + 0.5) * tileSizeM;
      const dist = Math.hypot(tileCenterX - cameraX, tileCenterZ - cameraZ);
      if (dist > maxEnd) continue;
      const ring = ringForDistance(dist, config);
      if (ring === null) continue;
      wanted.set(stableTileKey(tx, tz), { tileX: tx, tileZ: tz, ring });
    }
  }
  return wanted;
}

export function createCanopyClipmap(): CanopyClipmap {
  const tiles = new Map<string, CanopySummaryTile>();
  const tileRing = new Map<string, number>();
  const staleSince = new Map<string, number>();
  const rebuildQueue: CanopyWorldKey[] = [];
  let metrics = createEmptyCanopyMetrics();
  let freezeCenter = false;
  let frozenX = 0;
  let frozenZ = 0;
  let revision = 0;
  let centerInitialized = false;
  let lastCenterX = 0;
  let lastCenterZ = 0;
  let activeBuild: { stableKey: string; ring: number; job: CanopySummaryTileJob } | null = null;
  // Tile cells are immutable once built, so the coverage aggregates only change when the tile
  // set changes; scanning every cell of every tile per frame is far too hot for the frame loop.
  let coverageStatsDirty = true;

  const createTileJob = (
    key: CanopyWorldKey,
    config: CanopyShellConfig,
    terrainSampler: CanopyTerrainSampler,
    treeDistribution: TreeDistribution,
  ): CanopySummaryTileJob => {
    const ringCfg = config.clipmap.rings[key.ring] ?? config.clipmap.rings[0];
    const cellSizeM = ringCfg.cellSizeM;
    const tileSizeM = config.clipmap.tileSizeM;
    const resolution = tileResolutionForCellSize(tileSizeM, cellSizeM);
    const originX = key.tileX * tileSizeM;
    const originZ = key.tileZ * tileSizeM;
    revision++;
    return createCanopySummaryTileJob({
      key,
      originX,
      originZ,
      cellSizeM,
      resolution,
      config,
      terrainSampler,
      treeDistribution,
      revision,
    });
  };

  return {
    update(cameraX, cameraZ, config, terrainSampler, treeDistribution) {
      const t0 = performance.now();
      if (!centerInitialized) {
        lastCenterX = cameraX;
        lastCenterZ = cameraZ;
        if (freezeCenter) {
          frozenX = cameraX;
          frozenZ = cameraZ;
        }
        centerInitialized = true;
      }

      const centerX = freezeCenter ? frozenX : cameraX;
      const centerZ = freezeCenter ? frozenZ : cameraZ;
      if (!freezeCenter) {
        lastCenterX = centerX;
        lastCenterZ = centerZ;
      }

      if (!config.clipmap.enabled) {
        const evicted = tiles.size;
        tiles.clear();
        tileRing.clear();
        staleSince.clear();
        rebuildQueue.length = 0;
        activeBuild = null;
        metrics = {
          ...createEmptyCanopyMetrics(),
          evictedTiles: evicted,
          buildMs: performance.now() - t0,
        };
        return {
          metrics: { ...metrics },
          texturesDirty: evicted > 0,
          centerX,
          centerZ,
        };
      }

      const wanted = wantedTileMap(centerX, centerZ, config);
      metrics.requestedTiles = wanted.size;
      metrics.builtThisFrame = 0;
      metrics.evictedTiles = 0;

      rebuildQueue.length = 0;
      if (activeBuild && wanted.get(activeBuild.stableKey)?.ring !== activeBuild.ring) activeBuild = null;
      for (const [stableKey, key] of wanted) {
        const existingRing = tileRing.get(stableKey);
        if (!tiles.has(stableKey) || existingRing !== key.ring) {
          if (activeBuild?.stableKey !== stableKey || activeBuild.ring !== key.ring) rebuildQueue.push(key);
        }
        staleSince.delete(stableKey);
      }

      for (const stableKey of tiles.keys()) {
        if (!wanted.has(stableKey) && !staleSince.has(stableKey)) {
          staleSince.set(stableKey, performance.now());
        }
      }

      const graceMs = config.clipmap.evictionGraceSeconds * 1000;
      const tileSizeM = config.clipmap.tileSizeM;
      const evictionDist = config.distances.shellEndM + config.clipmap.evictionGraceTiles * tileSizeM;
      for (const [stableKey, staleAt] of [...staleSince.entries()]) {
        const tile = tiles.get(stableKey);
        if (!tile) {
          staleSince.delete(stableKey);
          continue;
        }
        const cx = tile.originX + tileSizeM * 0.5;
        const cz = tile.originZ + tileSizeM * 0.5;
        const dist = Math.hypot(cx - centerX, cz - centerZ);
        if (performance.now() - staleAt >= graceMs || dist > evictionDist) {
          tiles.delete(stableKey);
          tileRing.delete(stableKey);
          staleSince.delete(stableKey);
          metrics.evictedTiles++;
        }
      }

      metrics.queuedTiles = rebuildQueue.length + (activeBuild ? 1 : 0);
      const budget = config.budgets.maxTilesBuiltPerFrame;
      const buildBudgetMs = Math.max(0.25, config.budgets.maxBuildMsPerFrame);
      const buildStartedAt = performance.now();
      let built = 0;
      while (built < budget && (activeBuild || rebuildQueue.length > 0)) {
        if (!activeBuild) {
          const key = rebuildQueue.shift()!;
          const stableKey = stableTileKey(key.tileX, key.tileZ);
          activeBuild = { stableKey, ring: key.ring, job: createTileJob(key, config, terrainSampler, treeDistribution) };
        }
        const remainingMs = Math.max(0, buildBudgetMs - (performance.now() - buildStartedAt));
        const tile = activeBuild.job.step(remainingMs);
        if (!tile) break;
        tiles.set(activeBuild.stableKey, tile);
        tileRing.set(activeBuild.stableKey, activeBuild.ring);
        activeBuild = null;
        built++;
        if (performance.now() - buildStartedAt >= buildBudgetMs) break;
      }
      metrics.builtThisFrame = built;
      metrics.queuedTiles = rebuildQueue.length + (activeBuild ? 1 : 0);
      metrics.builtTiles = tiles.size;
      metrics.visibleTiles = tiles.size;
      metrics.buildMs = performance.now() - t0;

      if (built > 0 || metrics.evictedTiles > 0 || coverageStatsDirty) {
        let covSum = 0;
        let covMax = 0;
        let covCount = 0;
        for (const tile of tiles.values()) {
          for (const cell of tile.cells) {
            if (!Number.isFinite(cell.coverage)) continue;
            covSum += cell.coverage;
            covMax = Math.max(covMax, cell.coverage);
            covCount++;
          }
        }
        metrics.averageCoverage = covCount > 0 ? covSum / covCount : 0;
        metrics.maxCoverage = covMax;
        coverageStatsDirty = false;
      }

      return {
        metrics: { ...metrics },
        texturesDirty: built > 0 || metrics.evictedTiles > 0,
        centerX,
        centerZ,
      };
    },
    getVisibleTiles() {
      return [...tiles.values()];
    },
    getTileMetrics() {
      return { ...metrics };
    },
    setFreezeCenter(enabled: boolean) {
      if (enabled && !freezeCenter && centerInitialized) {
        frozenX = lastCenterX;
        frozenZ = lastCenterZ;
      }
      freezeCenter = enabled;
    },
    disposeFarTiles() {
      const n = tiles.size;
      tiles.clear();
      tileRing.clear();
      staleSince.clear();
      rebuildQueue.length = 0;
      activeBuild = null;
      metrics = { ...createEmptyCanopyMetrics(), evictedTiles: n };
      coverageStatsDirty = true;
    },
    dispose() {
      tiles.clear();
      tileRing.clear();
      staleSince.clear();
      rebuildQueue.length = 0;
      activeBuild = null;
      metrics = createEmptyCanopyMetrics();
      centerInitialized = false;
      coverageStatsDirty = true;
    },
  };
}

export function updateCanopyClipmap(
  clipmap: CanopyClipmap,
  cameraPosition: { x: number; z: number },
  config: CanopyShellConfig,
  terrainSampler: CanopyTerrainSampler,
  treeDistribution: TreeDistribution,
): CanopyClipmapUpdate {
  return clipmap.update(cameraPosition.x, cameraPosition.z, config, terrainSampler, treeDistribution);
}
