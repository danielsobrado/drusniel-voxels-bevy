import type { FarSummarySample, FarSummaryTile, SummaryTileKey } from "./types.js";
import type { NaadfPocConfig } from "./config.js";
import { coarserRingIndex, ringForDistance } from "./config.js";
import type { TerrainSource } from "./terrainSource.js";
import { sampleMacroFallback } from "./terrainSource.js";
import { floorDiv, summaryTileKeyToString, summaryTileOrigin, worldToSummaryTileKey } from "./keys.js";

export function farTileKeyString(key: SummaryTileKey): string {
  return summaryTileKeyToString(key);
}

export function buildFarSummaryTile(
  key: SummaryTileKey,
  ringIndex: number,
  config: NaadfPocConfig,
  source: TerrainSource,
  revision: number,
): FarSummaryTile {
  const ring = config.farClipmap.rings[ringIndex]!;
  const tileCells = config.farClipmap.tileCells;
  const origin = summaryTileOrigin(key, ring.cellM, tileCells);
  const resolution = tileCells;
  const count = resolution * resolution;
  const minHeight = new Float32Array(count);
  const maxHeight = new Float32Array(count);
  const avgHeight = new Float32Array(count);
  const dominantMaterial = new Uint16Array(count);
  const canopyCoverage = new Float32Array(count);
  const waterCoverage = new Float32Array(count);

  for (let sz = 0; sz < resolution; sz++) {
    for (let sx = 0; sx < resolution; sx++) {
      const wx = origin.x + (sx + 0.5) * ring.cellM;
      const wz = origin.z + (sz + 0.5) * ring.cellM;
      const idx = sz * resolution + sx;
      const s = source.sample(wx, wz);
      const h = Number.isFinite(s.height) ? s.height : 0;
      const hMin = Math.min(
        h,
        source.sampleHeight(wx - ring.cellM * 0.25, wz),
        source.sampleHeight(wx + ring.cellM * 0.25, wz),
        source.sampleHeight(wx, wz - ring.cellM * 0.25),
        source.sampleHeight(wx, wz + ring.cellM * 0.25),
      );
      const hMax = Math.max(
        h,
        source.sampleHeight(wx - ring.cellM * 0.25, wz),
        source.sampleHeight(wx + ring.cellM * 0.25, wz),
        source.sampleHeight(wx, wz - ring.cellM * 0.25),
        source.sampleHeight(wx, wz + ring.cellM * 0.25),
      );
      minHeight[idx] = hMin;
      maxHeight[idx] = hMax;
      avgHeight[idx] = h;
      dominantMaterial[idx] = s.material;
      canopyCoverage[idx] = s.canopyCoverage;
      waterCoverage[idx] = s.waterCoverage;
    }
  }

  return {
    key,
    originX: origin.x,
    originZ: origin.z,
    cellM: ring.cellM,
    resolution,
    minHeight,
    maxHeight,
    avgHeight,
    dominantMaterial,
    canopyCoverage,
    waterCoverage,
    revision,
    state: "ready",
  };
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
