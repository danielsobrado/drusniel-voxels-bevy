import type { CanopyShellConfig } from "./canopy_types_internal.js";
import type { CanopyMetrics, CanopySummaryTile, CanopyWorldKey } from "./canopy_types.js";
import { createEmptyCanopyMetrics, stableTileKey } from "./canopy_types.js";
import { createCanopySummaryTileJob, tileResolutionForCellSize, type CanopySummaryTileJob } from "./canopy_summary_builder.js";
import type { CanopyTerrainSampler } from "./canopy_terrain_sampler.js";
import type { TreeDistribution } from "./deterministic_tree_distribution.js";
import type { CanopyRemoteTileBuilder, CanopyWorkerTileCoord } from "./canopy_worker_client.js";

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

const REMOTE_BATCH_TILES = 8;
const REMOTE_MAX_INFLIGHT_TILES = 32;

export function createCanopyClipmap(remote?: CanopyRemoteTileBuilder | null): CanopyClipmap {
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
  // Tiles dispatched to the build worker and not yet answered; completed results wait in
  // remoteCompleted until the next update adopts the ones that are still wanted.
  const remoteInflight = new Map<string, number>();
  let remoteCompleted: CanopySummaryTile[] = [];
  // Tile cells are immutable once built, so the coverage aggregates only change when the tile
  // set changes; scanning every cell of every tile per frame is far too hot for the frame loop.
  let coverageStatsDirty = true;

  const tileGeometry = (key: CanopyWorldKey, config: CanopyShellConfig) => {
    const ringCfg = config.clipmap.rings[key.ring] ?? config.clipmap.rings[0];
    const cellSizeM = ringCfg.cellSizeM;
    const tileSizeM = config.clipmap.tileSizeM;
    return {
      cellSizeM,
      resolution: tileResolutionForCellSize(tileSizeM, cellSizeM),
      originX: key.tileX * tileSizeM,
      originZ: key.tileZ * tileSizeM,
    };
  };

  const createTileJob = (
    key: CanopyWorldKey,
    config: CanopyShellConfig,
    terrainSampler: CanopyTerrainSampler,
    treeDistribution: TreeDistribution,
  ): CanopySummaryTileJob => {
    const geometry = tileGeometry(key, config);
    revision++;
    return createCanopySummaryTileJob({
      key,
      originX: geometry.originX,
      originZ: geometry.originZ,
      cellSizeM: geometry.cellSizeM,
      resolution: geometry.resolution,
      config,
      terrainSampler,
      treeDistribution,
      revision,
    });
  };

  const remoteActive = (): boolean => remote?.available() === true;

  /** Adopt worker-built tiles that are still wanted with an unchanged ring. */
  const adoptRemoteTiles = (wanted: Map<string, CanopyWorldKey>): number => {
    if (remoteCompleted.length === 0) return 0;
    const completed = remoteCompleted;
    remoteCompleted = [];
    let adopted = 0;
    for (const tile of completed) {
      const stableKey = stableTileKey(tile.key.tileX, tile.key.tileZ);
      remoteInflight.delete(stableKey);
      if (wanted.get(stableKey)?.ring !== tile.key.ring) continue;
      tiles.set(stableKey, tile);
      tileRing.set(stableKey, tile.key.ring);
      adopted++;
    }
    return adopted;
  };

  const dispatchRemoteBuilds = (config: CanopyShellConfig): void => {
    if (!remote) return;
    while (remoteInflight.size < REMOTE_MAX_INFLIGHT_TILES && rebuildQueue.length > 0) {
      const batch: CanopyWorkerTileCoord[] = [];
      while (batch.length < REMOTE_BATCH_TILES && rebuildQueue.length > 0 && remoteInflight.size < REMOTE_MAX_INFLIGHT_TILES) {
        const key = rebuildQueue.shift()!;
        const stableKey = stableTileKey(key.tileX, key.tileZ);
        const geometry = tileGeometry(key, config);
        revision++;
        remoteInflight.set(stableKey, key.ring);
        batch.push({
          key: { ...key },
          originX: geometry.originX,
          originZ: geometry.originZ,
          cellSizeM: geometry.cellSizeM,
          resolution: geometry.resolution,
          revision,
        });
      }
      if (batch.length === 0) return;
      remote.build(batch).then((built) => {
        remoteCompleted.push(...built);
        // Batches answered as [] raced a reconfigure; release their slots so they re-queue.
        if (built.length < batch.length) {
          const builtKeys = new Set(built.map((tile) => stableTileKey(tile.key.tileX, tile.key.tileZ)));
          for (const coord of batch) {
            const stableKey = stableTileKey(coord.key.tileX, coord.key.tileZ);
            if (!builtKeys.has(stableKey)) remoteInflight.delete(stableKey);
          }
        }
      }).catch(() => {
        // Worker failed; release the slots so the local build path picks the tiles back up.
        for (const coord of batch) remoteInflight.delete(stableTileKey(coord.key.tileX, coord.key.tileZ));
      });
    }
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
        remoteInflight.clear();
        remoteCompleted = [];
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
      for (const [stableKey, ring] of remoteInflight) {
        if (wanted.get(stableKey)?.ring !== ring) remoteInflight.delete(stableKey);
      }
      const adopted = adoptRemoteTiles(wanted);
      for (const [stableKey, key] of wanted) {
        const existingRing = tileRing.get(stableKey);
        if (!tiles.has(stableKey) || existingRing !== key.ring) {
          const buildingLocally = activeBuild?.stableKey === stableKey && activeBuild.ring === key.ring;
          const buildingRemotely = remoteInflight.get(stableKey) === key.ring;
          if (!buildingLocally && !buildingRemotely) rebuildQueue.push(key);
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

      metrics.queuedTiles = rebuildQueue.length + remoteInflight.size + (activeBuild ? 1 : 0);
      let built = adopted;
      if (remoteActive()) {
        // Worker path: tiles build off-thread; this frame only pays for dispatch bookkeeping
        // and adopting completed results above.
        dispatchRemoteBuilds(config);
      } else {
        const budget = config.budgets.maxTilesBuiltPerFrame;
        const buildBudgetMs = Math.max(0.25, config.budgets.maxBuildMsPerFrame);
        const buildStartedAt = performance.now();
        while (built - adopted < budget && (activeBuild || rebuildQueue.length > 0)) {
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
      }
      metrics.builtThisFrame = built;
      metrics.queuedTiles = rebuildQueue.length + remoteInflight.size + (activeBuild ? 1 : 0);
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
      remoteInflight.clear();
      remoteCompleted = [];
      metrics = { ...createEmptyCanopyMetrics(), evictedTiles: n };
      coverageStatsDirty = true;
    },
    dispose() {
      tiles.clear();
      tileRing.clear();
      staleSince.clear();
      rebuildQueue.length = 0;
      activeBuild = null;
      remoteInflight.clear();
      remoteCompleted = [];
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
