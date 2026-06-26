import type {
  RayTraceResult,
  SunVisibilityResult,
  TerrainQueryResult,
} from "./types.js";
import type { NaadfWorldState } from "./summaryStreamer.js";
import { worldToChunkKey, worldToLocalCell } from "./keys.js";
import { lookupValidatedChunkIndex } from "./residentLookup.js";
import { sampleMipNodeAtWorld } from "./mipBuilder.js";
import { sampleFarSummary } from "./farClipmap.js";
import { estimateSafeSkipDistance, nodeRequiresRefine, sunNodeBlocksRay } from "./aadf.js";
import { ringForDistance } from "./config.js";
import { mipLevelForDistance, aadfSkipOccurred, recordMissingSample } from "./queryHelpers.js";
import type { ResidentChunkEntry } from "./types.js";

const QUERYABLE_STATES: ReadonlySet<ResidentChunkEntry["state"]> = new Set([
  "ready",
  "stale",
  "building",
]);

function activeBrick(entry: ResidentChunkEntry) {
  if (!QUERYABLE_STATES.has(entry.state)) return null;
  return entry.brick;
}

function activeMipChain(entry: ResidentChunkEntry) {
  if (!QUERYABLE_STATES.has(entry.state)) return null;
  return entry.mipChain;
}

export function queryTerrainHeight(params: {
  state: NaadfWorldState;
  worldX: number;
  worldZ: number;
  purpose: "render" | "shadow" | "canopy" | "material" | "debug";
}): TerrainQueryResult {
  const { state, worldX, worldZ, purpose } = params;
  const chunkSize = state.config.world.chunkSizeCells;
  const key = worldToChunkKey(worldX, worldZ, chunkSize);
  const lookup = lookupValidatedChunkIndex(state.nearTable, state.hashFallback, state.residents, key);
  const dist = Math.hypot(worldX - state.cameraX, worldZ - state.cameraZ);

  if (lookup.source === "near_table") state.metrics.nearTableHits++;
  if (lookup.source === "hash_fallback") state.metrics.hashFallbackHits++;

  if (lookup.index >= 0) {
    const entry = state.residents[lookup.index];
    const brick = entry ? activeBrick(entry) : null;
    if (brick) {
      const local = worldToLocalCell(worldX, worldZ, key, chunkSize);
      const idx = local.localZ * chunkSize + local.localX;
      if (idx >= 0 && idx < brick.heights.length) {
        const h = brick.heights[idx]!;
        const mat = brick.materials[idx]!;
        const canopy = brick.canopyCoverage[idx]!;
        const water = brick.waterCoverage[idx]!;
        if (!Number.isFinite(h)) {
          recordMissingSample(state, purpose, true);
          return unknownResult();
        }
        if (purpose === "canopy") {
          state.metrics.canopySamples++;
          return finiteResult(h, mat, canopy, water, lookup.source === "near_table" ? "near_table" : "hash_fallback");
        }
        if (purpose === "render") state.metrics.farShellSamples++;
        return finiteResult(h, mat, canopy, water, lookup.source === "near_table" ? "near_table" : "hash_fallback");
      }
    }
  }

  if (state.forceMissingStress) {
    recordMissingSample(state, purpose, true);
    return unknownResult();
  }

  const ring = ringForDistance(dist, state.config);
  if (ring && dist >= ring.startM) {
    const far = sampleFarSummary({
      worldX,
      worldZ,
      purpose: purpose === "canopy" ? "canopy" : purpose === "material" ? "material" : "height",
      cameraX: state.cameraX,
      cameraZ: state.cameraZ,
      store: state.farTiles,
      config: state.config,
      source: state.source,
      forceMissingStress: state.forceMissingStress,
    });
    if (!far.unknown) {
      state.metrics.farClipmapHits++;
      if (purpose === "render") state.metrics.farShellSamples++;
      if (purpose === "canopy") state.metrics.canopySamples++;
      return {
        height: far.height,
        material: far.material,
        canopyCoverage: far.canopyCoverage,
        waterCoverage: far.waterCoverage,
        normalX: far.normalX,
        normalY: far.normalY,
        normalZ: far.normalZ,
        unknown: false,
        source: "far_clipmap",
        nearTableHit: false,
        hashFallbackHit: false,
        farClipmapHit: true,
        missingSample: false,
      };
    }
  }

  const macro = state.source.sample(worldX, worldZ);
  if (Number.isFinite(macro.height)) {
    if (purpose === "render") state.metrics.farShellSamples++;
    recordMissingSample(state, purpose, false);
    return {
      height: macro.height,
      material: macro.material,
      canopyCoverage: macro.canopyCoverage,
      waterCoverage: macro.waterCoverage,
      normalX: macro.normalX,
      normalY: macro.normalY,
      normalZ: macro.normalZ,
      unknown: false,
      source: "macro",
      nearTableHit: lookup.source === "near_table",
      hashFallbackHit: lookup.source === "hash_fallback",
      farClipmapHit: false,
      missingSample: true,
    };
  }

  recordMissingSample(state, purpose, true);
  return unknownResult();
}

function finiteResult(
  h: number,
  mat: number,
  canopy: number,
  water: number,
  source: "near_table" | "hash_fallback",
): TerrainQueryResult {
  // PoC approximation: bricks do not store pre-computed normals.
  // Return flat-up (0,1,0). Consumers that need true normals (shadow proxy,
  // far shell mesh) should fall through to far_clipmap or macro sources.
  return {
    height: h,
    material: mat,
    canopyCoverage: canopy,
    waterCoverage: water,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    unknown: false,
    source,
    nearTableHit: source === "near_table",
    hashFallbackHit: source === "hash_fallback",
    farClipmapHit: false,
    missingSample: false,
  };
}

function unknownResult(): TerrainQueryResult {
  return {
    height: 0,
    material: 0,
    canopyCoverage: 0,
    waterCoverage: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    unknown: true,
    source: "unknown",
    nearTableHit: false,
    hashFallbackHit: false,
    farClipmapHit: false,
    missingSample: true,
  };
}

export function tracePrimaryDebugRay(params: {
  state: NaadfWorldState;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
  maxDistanceM: number;
}): RayTraceResult {
  const { state, maxDistanceM } = params;
  let { originX, originY, originZ, dirX, dirY, dirZ } = params;

  const len = Math.hypot(dirX, dirY, dirZ);
  if (len < 1e-10) return emptyRayResult();
  dirX /= len;
  dirY /= len;
  dirZ /= len;

  const maxSteps = state.config.query.maxStepsPrimary;
  const eps = state.config.query.epsilonM;
  const cellSize = state.config.world.voxelSizeM;
  let traveled = 0;
  let steps = 0;
  let aadfSkips = 0;
  let nearTableHits = 0;
  let hashFallbackHits = 0;
  let farClipmapHits = 0;
  let missingSamples = 0;

  while (traveled < maxDistanceM && steps < maxSteps) {
    steps++;
    const q = queryTerrainHeight({
      state,
      worldX: originX,
      worldZ: originZ,
      purpose: "debug",
    });
    if (q.nearTableHit) nearTableHits++;
    if (q.hashFallbackHit) hashFallbackHits++;
    if (q.farClipmapHit) farClipmapHits++;
    if (q.unknown || q.missingSample) missingSamples++;

    if (originY <= q.height) {
      state.metrics.primarySteps.add(steps);
      state.metrics.aadfSkips += aadfSkips;
      return {
        hit: true,
        unknown: q.unknown,
        hitX: originX,
        hitY: q.height,
        hitZ: originZ,
        material: q.material,
        steps,
        aadfSkips,
        nearTableHits,
        hashFallbackHits,
        farClipmapHits,
        missingSamples,
      };
    }

    const chunkSize = state.config.world.chunkSizeCells;
    const key = worldToChunkKey(originX, originZ, chunkSize);
    const lookup = lookupValidatedChunkIndex(state.nearTable, state.hashFallback, state.residents, key);
    let skip = cellSize;

    const dist = Math.hypot(originX - state.cameraX, originZ - state.cameraZ);
    const mipLevel = mipLevelForDistance(
      dist,
      chunkSize,
      cellSize,
      state.config.query.primaryLodBias,
    );

    if (lookup.index >= 0) {
      const entry = state.residents[lookup.index];
      const mipChain = entry ? activeMipChain(entry) : null;
      if (mipChain) {
        const local = worldToLocalCell(originX, originZ, key, chunkSize);
        const node = sampleMipNodeAtWorld(mipChain, local.localX, local.localZ, mipLevel, chunkSize);
        if (node) {
          const boundary = cellSize;
          skip = estimateSafeSkipDistance({
            node,
            rayDirX: dirX,
            rayDirY: dirY,
            rayDirZ: dirZ,
            cellSizeM: cellSize,
            nextCellBoundaryDistanceM: boundary,
            epsilonM: eps,
            config: state.config,
          });
          if (aadfSkipOccurred(skip, boundary)) aadfSkips++;
        }
      }
    } else if (dist >= (state.config.farClipmap.rings[0]?.startM ?? Infinity)) {
      const far = sampleFarSummary({
        worldX: originX,
        worldZ: originZ,
        purpose: "height",
        cameraX: state.cameraX,
        cameraZ: state.cameraZ,
        store: state.farTiles,
        config: state.config,
        source: state.source,
        forceMissingStress: state.forceMissingStress,
      });
      if (!far.unknown) {
        farClipmapHits++;
        skip = Math.max(eps, Math.min(cellSize * 4, far.maxHeight - originY + cellSize));
      }
    }

    traveled += skip;
    originX += dirX * skip;
    originY += dirY * skip;
    originZ += dirZ * skip;
  }

  state.metrics.primarySteps.add(steps);
  state.metrics.aadfSkips += aadfSkips;
  return {
    hit: false,
    unknown: missingSamples > 0,
    hitX: originX,
    hitY: originY,
    hitZ: originZ,
    material: 0,
    steps,
    aadfSkips,
    nearTableHits,
    hashFallbackHits,
    farClipmapHits,
    missingSamples,
  };
}

export function traceSunVisibility(params: {
  state: NaadfWorldState;
  worldX: number;
  worldY: number;
  worldZ: number;
  sunDirX: number;
  sunDirY: number;
  sunDirZ: number;
  maxDistanceM: number;
}): SunVisibilityResult {
  const { state, worldX, worldY, worldZ, maxDistanceM } = params;
  let { sunDirX, sunDirY, sunDirZ } = params;

  const len = Math.hypot(sunDirX, sunDirY, sunDirZ);
  if (len < 1e-10) {
    return { visible: true, unknown: false, blocked: false, steps: 0, aadfSkips: 0, nearTableHits: 0, hashFallbackHits: 0, farClipmapHits: 0, missingSamples: 0 };
  }
  sunDirX /= len;
  sunDirY /= len;
  sunDirZ /= len;

  const maxSteps = state.config.query.maxStepsSun;
  const eps = state.config.query.epsilonM;
  const cellSize = state.config.world.voxelSizeM;
  let x = worldX;
  let y = worldY;
  let z = worldZ;
  let traveled = 0;
  let steps = 0;
  let aadfSkips = 0;
  let nearTableHits = 0;
  let hashFallbackHits = 0;
  let farClipmapHits = 0;
  let missingSamples = 0;

  while (traveled < maxDistanceM && steps < maxSteps) {
    steps++;

    const q = queryTerrainHeight({ state, worldX: x, worldZ: z, purpose: "shadow" });
    state.metrics.shadowProxySamples++;
    if (q.nearTableHit) nearTableHits++;
    if (q.hashFallbackHit) hashFallbackHits++;
    if (q.farClipmapHit) farClipmapHits++;

    if (q.unknown) {
      missingSamples++;
      if (state.config.query.unknownCountsAsBlockedForSun) {
        state.metrics.unknownSunSamples++;
        state.metrics.sunSteps.add(steps);
        state.metrics.aadfSkips += aadfSkips;
        return { visible: false, unknown: true, blocked: true, steps, aadfSkips, nearTableHits, hashFallbackHits, farClipmapHits, missingSamples };
      }
      x += sunDirX * eps;
      y += sunDirY * eps;
      z += sunDirZ * eps;
      traveled += eps;
      continue;
    }

    if (y <= q.height) {
      state.metrics.sunSteps.add(steps);
      state.metrics.aadfSkips += aadfSkips;
      return { visible: false, unknown: false, blocked: true, steps, aadfSkips, nearTableHits, hashFallbackHits, farClipmapHits, missingSamples };
    }

    const chunkSize = state.config.world.chunkSizeCells;
    const key = worldToChunkKey(x, z, chunkSize);
    const lookup = lookupValidatedChunkIndex(state.nearTable, state.hashFallback, state.residents, key);
    let skip = cellSize;

    const dist = Math.hypot(x - state.cameraX, z - state.cameraZ);
    const mipLevel = mipLevelForDistance(
      dist,
      chunkSize,
      cellSize,
      state.config.query.sunLodBias,
    );

    if (lookup.index >= 0) {
      const entry = state.residents[lookup.index];
      const mipChain = entry ? activeMipChain(entry) : null;
      if (mipChain) {
        const local = worldToLocalCell(x, z, key, chunkSize);
        const node = sampleMipNodeAtWorld(mipChain, local.localX, local.localZ, mipLevel, chunkSize);
        if (node) {
          const sunResult = sunNodeBlocksRay(node, y, state.config);
          if (sunResult === "blocked") {
            state.metrics.sunSteps.add(steps);
            state.metrics.aadfSkips += aadfSkips;
            return { visible: false, unknown: false, blocked: true, steps, aadfSkips, nearTableHits, hashFallbackHits, farClipmapHits, missingSamples };
          }
          if (sunResult === "visible" && !nodeRequiresRefine(node, state.config)) {
            skip = estimateSafeSkipDistance({
              node,
              rayDirX: sunDirX,
              rayDirY: sunDirY,
              rayDirZ: sunDirZ,
              cellSizeM: cellSize,
              nextCellBoundaryDistanceM: cellSize,
              epsilonM: eps,
              config: state.config,
            });
            if (aadfSkipOccurred(skip, cellSize)) aadfSkips++;
            x += sunDirX * skip;
            y += sunDirY * skip;
            z += sunDirZ * skip;
            traveled += skip;
            continue;
          }
        }
      }
    }

    x += sunDirX * eps;
    y += sunDirY * eps;
    z += sunDirZ * eps;
    traveled += eps;
  }

  state.metrics.sunSteps.add(steps);
  state.metrics.aadfSkips += aadfSkips;
  return { visible: true, unknown: missingSamples > 0, blocked: false, steps, aadfSkips, nearTableHits, hashFallbackHits, farClipmapHits, missingSamples };
}

function emptyRayResult(): RayTraceResult {
  return {
    hit: false,
    unknown: true,
    hitX: 0,
    hitY: 0,
    hitZ: 0,
    material: 0,
    steps: 0,
    aadfSkips: 0,
    nearTableHits: 0,
    hashFallbackHits: 0,
    farClipmapHits: 0,
    missingSamples: 1,
  };
}
