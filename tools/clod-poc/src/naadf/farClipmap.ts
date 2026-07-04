import type { FarSummarySample, FarSummaryTile, SummaryTileKey } from "./types.js";
import type { NaadfPocConfig } from "./config.js";
import { coarserRingIndex, ringForDistance } from "./config.js";
import type { TerrainSource } from "./terrainSource.js";
import { sampleMacroFallback } from "./terrainSource.js";
import { floorDiv, summaryTileKeyToString, summaryTileOrigin, worldToSummaryTileKey } from "./keys.js";

const DEADLINE_CHECK_INTERVAL_CELLS = 8;

export type FarSummaryTileBuildState = {
  key: SummaryTileKey;
  ringIndex: number;
  config: NaadfPocConfig;
  source: TerrainSource;
  revision: number;
  originX: number;
  originZ: number;
  cellM: number;
  resolution: number;
  count: number;
  cursor: number;
  minHeight: Float32Array;
  maxHeight: Float32Array;
  avgHeight: Float32Array;
  dominantMaterial: Uint16Array;
  canopyCoverage: Float32Array;
  waterCoverage: Float32Array;
};

export function farTileKeyString(key: SummaryTileKey): string {
  return summaryTileKeyToString(key);
}

export function createFarSummaryTileBuild(
  key: SummaryTileKey,
  ringIndex: number,
  config: NaadfPocConfig,
  source: TerrainSource,
  revision: number,
): FarSummaryTileBuildState {
  const ring = config.farClipmap.rings[ringIndex]!;
  const tileCells = config.farClipmap.tileCells;
  const origin = summaryTileOrigin(key, ring.cellM, tileCells);
  const count = tileCells * tileCells;
  return {
    key,
    ringIndex,
    config,
    source,
    revision,
    originX: origin.x,
    originZ: origin.z,
    cellM: ring.cellM,
    resolution: tileCells,
    count,
    cursor: 0,
    minHeight: new Float32Array(count),
    maxHeight: new Float32Array(count),
    avgHeight: new Float32Array(count),
    dominantMaterial: new Uint16Array(count),
    canopyCoverage: new Float32Array(count),
    waterCoverage: new Float32Array(count),
  };
}

export function stepFarSummaryTileBuild(build: FarSummaryTileBuildState, deadlineMs: number): boolean {
  let checkedCells = 0;
  while (build.cursor < build.count) {
    sampleFarSummaryCell(build, build.cursor);
    build.cursor++;
    checkedCells++;
    if (checkedCells >= DEADLINE_CHECK_INTERVAL_CELLS) {
      checkedCells = 0;
      if (performance.now() >= deadlineMs) return false;
    }
  }
  return true;
}

export function finishFarSummaryTileBuild(build: FarSummaryTileBuildState): FarSummaryTile {
  return {
    key: build.key,
    originX: build.originX,
    originZ: build.originZ,
    cellM: build.cellM,
    resolution: build.resolution,
    minHeight: build.minHeight,
    maxHeight: build.maxHeight,
    avgHeight: build.avgHeight,
    dominantMaterial: build.dominantMaterial,
    canopyCoverage: build.canopyCoverage,
    waterCoverage: build.waterCoverage,
    revision: build.revision,
    state: "ready",
  };
}

export function buildFarSummaryTile(
  key: SummaryTileKey,
  ringIndex: number,
  config: NaadfPocConfig,
  source: TerrainSource,
  revision: number,
): FarSummaryTile {
  const build = createFarSummaryTileBuild(key, ringIndex, config, source, revision);
  stepFarSummaryTileBuild(build, Number.POSITIVE_INFINITY);
  return finishFarSummaryTileBuild(build);
}

export type FarClipmapStore = Map<string, FarSummaryTile>;

export function sampleFarSummary(params: {
  worldX: number;
  worldZ: number;
  purpose: "height" | "sun" | "canopy" | "material";
  cameraX: number;
  cameraZ: number;
  store: FarClipmapStore;
  config: NaadfPocConfig;
  source: TerrainSource;
  forceMissingStress?: boolean;
}): FarSummarySample {
  const { worldX, worldZ, cameraX, cameraZ, store, config, source, forceMissingStress = false } = params;
  if (forceMissingStress) {
    return unknownSample(-1);
  }
  const dist = Math.hypot(worldX - cameraX, worldZ - cameraZ);
  const ring = ringForDistance(dist, config);

  if (!ring || !config.farClipmap.enabled) {
    return macroOrUnknown(worldX, worldZ, source, -1, true);
  }

  const ringIndex = config.farClipmap.rings.indexOf(ring);
  const tileCells = config.farClipmap.tileCells;
  const tileKey = worldToSummaryTileKey(worldX, worldZ, ringIndex, ring.cellM, tileCells);
  const sample = sampleTileAtKey(store, tileKey, ring.cellM, worldX, worldZ, ringIndex);
  if (sample && !sample.unknown) return sample;

  const coarser = coarserRingIndex(ringIndex, config);
  if (coarser !== null) {
    const coarseRing = config.farClipmap.rings[coarser]!;
    const coarseKey = worldToSummaryTileKey(worldX, worldZ, coarser, coarseRing.cellM, tileCells);
    const coarseSample = sampleTileAtKey(store, coarseKey, coarseRing.cellM, worldX, worldZ, coarser);
    if (coarseSample && !coarseSample.unknown) return coarseSample;
  }

  return macroOrUnknown(worldX, worldZ, source, ringIndex, false);
}

function sampleFarSummaryCell(build: FarSummaryTileBuildState, idx: number): void {
  const sx = idx % build.resolution;
  const sz = Math.floor(idx / build.resolution);
  const wx = build.originX + (sx + 0.5) * build.cellM;
  const wz = build.originZ + (sz + 0.5) * build.cellM;
  const s = build.source.sample(wx, wz);
  const h = Number.isFinite(s.height) ? s.height : 0;
  const offset = build.cellM * 0.25;
  const hL = build.source.sampleHeight(wx - offset, wz);
  const hR = build.source.sampleHeight(wx + offset, wz);
  const hD = build.source.sampleHeight(wx, wz - offset);
  const hU = build.source.sampleHeight(wx, wz + offset);

  build.minHeight[idx] = Math.min(h, hL, hR, hD, hU);
  build.maxHeight[idx] = Math.max(h, hL, hR, hD, hU);
  build.avgHeight[idx] = h;
  build.dominantMaterial[idx] = s.material;
  build.canopyCoverage[idx] = s.canopyCoverage;
  build.waterCoverage[idx] = s.waterCoverage;
}

function sampleTileAtKey(
  store: FarClipmapStore,
  key: SummaryTileKey,
  cellM: number,
  worldX: number,
  worldZ: number,
  ring: number,
): FarSummarySample | null {
  const tile = store.get(farTileKeyString(key));
  if (!tile || (tile.state !== "ready" && tile.state !== "stale")) return null;

  const localX = floorDiv(worldX - tile.originX, cellM);
  const localZ = floorDiv(worldZ - tile.originZ, cellM);
  if (localX < 0 || localZ < 0 || localX >= tile.resolution || localZ >= tile.resolution) {
    return null;
  }
  const idx = localZ * tile.resolution + localX;
  return {
    height: tile.avgHeight[idx]!,
    minHeight: tile.minHeight[idx]!,
    maxHeight: tile.maxHeight[idx]!,
    material: tile.dominantMaterial[idx]!,
    canopyCoverage: tile.canopyCoverage[idx]!,
    waterCoverage: tile.waterCoverage[idx]!,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    unknown: false,
    ring,
  };
}

function unknownSample(ring: number): FarSummarySample {
  return {
    height: 0,
    minHeight: 0,
    maxHeight: 0,
    material: 0,
    canopyCoverage: 0,
    waterCoverage: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    unknown: true,
    ring,
  };
}

function macroOrUnknown(
  worldX: number,
  worldZ: number,
  source: TerrainSource,
  ring: number,
  fullyUnknown: boolean,
): FarSummarySample {
  const macro = sampleMacroFallback(worldX, worldZ, source);
  return {
    height: macro.height,
    minHeight: macro.height,
    maxHeight: macro.height,
    material: macro.material,
    canopyCoverage: macro.canopyCoverage,
    waterCoverage: macro.waterCoverage,
    normalX: macro.normalX,
    normalY: macro.normalY,
    normalZ: macro.normalZ,
    unknown: fullyUnknown,
    ring,
  };
}
