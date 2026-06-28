import { domainWarpedFbm2, hashPositionSeeded, smooth01, smoothstepRange } from "../terrain/procedural_noise.js";

export interface IslandShapeConfig {
  enabled: boolean;
  seaLevel: number;
  seed: number;
  spacingM: number;
  radiusM: number;
  blendM: number;
  warpStrengthM: number;
  beachWidthM: number;
  cliffWidthM: number;
  worldRadiusM: number;
  oceanRim: boolean;
  oceanRimDropM: number;
}

export const DEFAULT_ISLAND_SHAPE_CONFIG: IslandShapeConfig = {
  enabled: false,
  seaLevel: 18,
  seed: 0,
  spacingM: 1500,
  radiusM: 560,
  blendM: 260,
  warpStrengthM: 190,
  beachWidthM: 28,
  cliffWidthM: 48,
  worldRadiusM: 8192,
  oceanRim: false,
  oceanRimDropM: 42,
};

export interface IslandMaskSample {
  mask: number;
  shoreDistanceM: number;
  nearestCenterX: number;
  nearestCenterZ: number;
  cliffWeight: number;
}

export function resolveIslandShapeConfig(input?: Partial<IslandShapeConfig>): IslandShapeConfig {
  const merged = { ...DEFAULT_ISLAND_SHAPE_CONFIG, ...(input ?? {}) };
  return {
    ...merged,
    seaLevel: Number.isFinite(merged.seaLevel) ? merged.seaLevel : DEFAULT_ISLAND_SHAPE_CONFIG.seaLevel,
    seed: Number.isFinite(merged.seed) ? Math.floor(merged.seed) : DEFAULT_ISLAND_SHAPE_CONFIG.seed,
    spacingM: Math.max(64, merged.spacingM),
    radiusM: Math.max(16, merged.radiusM),
    blendM: Math.max(1, merged.blendM),
    warpStrengthM: Math.max(0, merged.warpStrengthM),
    beachWidthM: Math.max(1, merged.beachWidthM),
    cliffWidthM: Math.max(1, merged.cliffWidthM),
    worldRadiusM: Math.max(1, merged.worldRadiusM),
    oceanRimDropM: Math.max(1, merged.oceanRimDropM),
  };
}

function islandCenter(cellX: number, cellZ: number, cfg: IslandShapeConfig): [number, number, number] {
  const ox = hashPositionSeeded(Math.imul(cellX, 43), Math.imul(cellZ, 59), cfg.seed + 1709) - 0.5;
  const oz = hashPositionSeeded(Math.imul(cellX, 71), Math.imul(cellZ, 37), cfg.seed + 2203) - 0.5;
  const radiusT = hashPositionSeeded(Math.imul(cellX, 97), Math.imul(cellZ, 83), cfg.seed + 3251);
  return [
    (cellX + 0.5 + ox * 0.58) * cfg.spacingM,
    (cellZ + 0.5 + oz * 0.58) * cfg.spacingM,
    cfg.radiusM * (0.78 + radiusT * 0.44),
  ];
}

export function sampleIslandMask(x: number, z: number, input?: Partial<IslandShapeConfig>): IslandMaskSample {
  const cfg = resolveIslandShapeConfig(input);
  if (!cfg.enabled) {
    return { mask: 1, shoreDistanceM: cfg.radiusM, nearestCenterX: 0, nearestCenterZ: 0, cliffWeight: 0 };
  }

  const warpX = (domainWarpedFbm2(x + 913, z - 311, {
    scale: 0.0007,
    octaves: 3,
    persistence: 0.52,
    lacunarity: 2.0,
    warpScale: 0.00021,
    warpStrength: cfg.warpStrengthM * 1.2,
    seed: cfg.seed + 4441,
  }) * 2 - 1) * cfg.warpStrengthM;
  const warpZ = (domainWarpedFbm2(x - 577, z + 1217, {
    scale: 0.0007,
    octaves: 3,
    persistence: 0.52,
    lacunarity: 2.0,
    warpScale: 0.00021,
    warpStrength: cfg.warpStrengthM * 1.2,
    seed: cfg.seed + 5059,
  }) * 2 - 1) * cfg.warpStrengthM;

  const sx = x + warpX;
  const sz = z + warpZ;
  const cellX = Math.floor(sx / cfg.spacingM);
  const cellZ = Math.floor(sz / cfg.spacingM);
  let bestMask = 0;
  let bestShore = Number.NEGATIVE_INFINITY;
  let nearestCenterX = 0;
  let nearestCenterZ = 0;

  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      const [cx, cz, radius] = islandCenter(cellX + dx, cellZ + dz, cfg);
      const d = Math.hypot(sx - cx, sz - cz);
      const shore = radius - d;
      const outer = radius + cfg.blendM;
      const mask = smooth01(1 - Math.min(1, Math.max(0, (d - radius) / Math.max(1, cfg.blendM))));
      const insideBoost = d <= radius ? 1 : mask;
      const islandMask = d >= outer ? 0 : insideBoost;
      if (islandMask > bestMask || shore > bestShore) {
        bestMask = islandMask;
        bestShore = shore;
        nearestCenterX = cx;
        nearestCenterZ = cz;
      }
    }
  }

  const cliffNoise = domainWarpedFbm2(x + 193, z - 877, {
    scale: 0.006,
    octaves: 3,
    persistence: 0.5,
    lacunarity: 2.1,
    warpScale: 0.0016,
    warpStrength: 46,
    seed: cfg.seed + 6427,
  });
  const cliffWeight = smoothstepRange(0.58, 0.84, cliffNoise);
  return {
    mask: Math.max(0, Math.min(1, bestMask)),
    shoreDistanceM: bestShore,
    nearestCenterX,
    nearestCenterZ,
    cliffWeight,
  };
}

export function applyIslandShape(
  x: number,
  z: number,
  inlandHeight: number,
  input?: Partial<IslandShapeConfig>,
): number {
  const cfg = resolveIslandShapeConfig(input);
  if (!cfg.enabled && !cfg.oceanRim) return inlandHeight;

  let height = inlandHeight;
  if (cfg.enabled) {
    const sample = sampleIslandMask(x, z, cfg);
    const oceanFloor = cfg.seaLevel - 18;
    const cliffTarget = Math.max(inlandHeight, cfg.seaLevel + 7 + sample.cliffWeight * 18);
    const beachTarget = cfg.seaLevel + smooth01(Math.max(0, sample.shoreDistanceM) / cfg.beachWidthM) * 3.5;
    const coastT = smooth01(Math.max(0, sample.shoreDistanceM) / (cfg.beachWidthM + cfg.cliffWidthM));
    const coastHeight = beachTarget + (cliffTarget - beachTarget) * sample.cliffWeight * coastT;
    const islandHeight = sample.shoreDistanceM < cfg.beachWidthM + cfg.cliffWidthM
      ? Math.min(inlandHeight, coastHeight)
      : inlandHeight;
    height = oceanFloor + (islandHeight - oceanFloor) * sample.mask;
  }

  if (cfg.oceanRim) {
    const d = Math.hypot(x, z);
    const rimT = smoothstepRange(cfg.worldRadiusM * 0.9, cfg.worldRadiusM, d);
    if (rimT > 0) {
      const rimHeight = cfg.seaLevel - 2 - cfg.oceanRimDropM * rimT;
      height = Math.min(height, rimHeight);
    }
  }

  return height;
}
