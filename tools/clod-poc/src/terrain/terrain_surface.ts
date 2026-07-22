import { applyBorderCoastShape } from "./border_coast.js";
import type { BorderCoastOceanConfig } from "./border_coast_config.js";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "./border_coast_config.js";
import { domainWarpedFbm2, fbm2, ridgedFbm2, smooth01, smoothstepRange } from "./procedural_noise.js";
import { applyIslandShape, resolveIslandShapeConfig, type IslandShapeConfig } from "../world_source/island_shape.js";
import { sampleHeightmapHeight } from "./heightmap_source.js";

export const WATER_LEVEL = 18;
export const DEFAULT_TERRAIN_SEED = 0;

const TERRAIN_CONFIG = {
  height: { min: 14, max: 118 },
  continent: { scale: 0.001, amplitude: 40, octaves: 2, persistence: 0.5, lacunarity: 2.0, warpStrength: 220 },
  mountains: {
    scale: 0.008,
    amplitude: 120,
    octaves: 7,
    persistence: 0.48,
    lacunarity: 2.3,
    ridgePower: 1.8,
    massifScale: 0.0035,
    massifAmplitude: 38,
    massifThreshold: 0.38,
    massifPower: 1.65,
    warpStrength: 52,
  },
  hills: { scale: 0.025, amplitude: 25, octaves: 4, persistence: 0.5, lacunarity: 2.0, warpStrength: 19 },
  detail: { scale: 0.1, amplitude: 3, octaves: 3, persistence: 0.5, lacunarity: 2.0, warpStrength: 4 },
};

export interface WorldBounds {
  cellsX: number;
  cellsZ: number;
  finite?: boolean;
}

export interface TerrainFieldConfig {
  seed: number;
  seaLevel: number;
  islandShape: IslandShapeConfig;
}

export type TerrainFieldConfigInput = Partial<Omit<TerrainFieldConfig, "islandShape">> & {
  islandShape?: Partial<IslandShapeConfig>;
};

export const DEFAULT_TERRAIN_FIELD_CONFIG: TerrainFieldConfig = {
  seed: DEFAULT_TERRAIN_SEED,
  seaLevel: WATER_LEVEL,
  islandShape: resolveIslandShapeConfig(),
};

let terrainFieldConfig: TerrainFieldConfig = DEFAULT_TERRAIN_FIELD_CONFIG;

export function resolveTerrainFieldConfig(input?: TerrainFieldConfigInput): TerrainFieldConfig {
  const seed = Number.isFinite(input?.seed) ? Math.floor(input!.seed!) : DEFAULT_TERRAIN_FIELD_CONFIG.seed;
  const seaLevel = Number.isFinite(input?.seaLevel) ? input!.seaLevel! : DEFAULT_TERRAIN_FIELD_CONFIG.seaLevel;
  return {
    seed,
    seaLevel,
    islandShape: resolveIslandShapeConfig({
      ...input?.islandShape,
      seed: input?.islandShape?.seed ?? seed,
      seaLevel,
    }),
  };
}

export function setTerrainFieldConfig(config?: TerrainFieldConfigInput | null): void {
  terrainFieldConfig = config ? resolveTerrainFieldConfig(config) : DEFAULT_TERRAIN_FIELD_CONFIG;
}

export function getTerrainFieldConfig(): TerrainFieldConfig {
  return terrainFieldConfig;
}

function hashPositionSeeded(x: number, z: number, seed = DEFAULT_TERRAIN_SEED): number {
  let n = (
    Math.imul(x | 0, 374761393) +
    Math.imul(z | 0, 668265263) +
    Math.imul(seed | 0, 1376312589)
  ) | 0;
  n = Math.imul(n ^ (n >> 13), 1274126177);
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return smooth01(t);
}

function fbmConfigurable(
  x: number,
  z: number,
  scale: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  seed = DEFAULT_TERRAIN_SEED,
): number {
  return fbm2(x, z, { scale, octaves, persistence, lacunarity, seed });
}

function domainFbmConfigurable(
  x: number,
  z: number,
  scale: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  warpStrength: number,
  seed: number,
): number {
  return domainWarpedFbm2(x, z, {
    scale,
    octaves,
    persistence,
    lacunarity,
    warpScale: scale * 0.31,
    warpStrength,
    seed,
  });
}

function ridgedNoise(x: number, z: number, seed: number): number {
  const cfg = TERRAIN_CONFIG.mountains;
  return ridgedFbm2(x, z, {
    scale: cfg.scale,
    octaves: cfg.octaves,
    persistence: cfg.persistence,
    lacunarity: cfg.lacunarity,
    seed: seed + 37,
  }, cfg.ridgePower) * cfg.amplitude;
}

function massifCellMask(x: number, z: number, seed: number): number {
  const cfg = TERRAIN_CONFIG.mountains;
  const spacing = Math.min(384, Math.max(128, 1 / Math.max(0.001, cfg.massifScale)));
  const cellX = Math.floor(x / spacing);
  const cellZ = Math.floor(z / spacing);
  let strongest = 0;

  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = cellX + dx;
      const cz = cellZ + dz;
      const offsetX = hashPositionSeeded(Math.imul(cx, 43), Math.imul(cz, 59), seed) - 0.5;
      const offsetZ = hashPositionSeeded(Math.imul(cx, 71), Math.imul(cz, 37), seed) - 0.5;
      const heightT = 0.55 + hashPositionSeeded(Math.imul(cx, 97), Math.imul(cz, 83), seed) * 0.45;
      const radiusT = hashPositionSeeded(Math.imul(cx, 113), Math.imul(cz, 131), seed);
      const centerX = (cx + 0.5 + offsetX * 0.55) * spacing;
      const centerZ = (cz + 0.5 + offsetZ * 0.55) * spacing;
      const radius = spacing * (0.42 + radiusT * 0.22);
      const dist = Math.hypot(x - centerX, z - centerZ);
      const falloff = Math.min(1, Math.max(0, 1 - dist / Math.max(1, radius)));
      const mask = Math.pow(smooth(falloff), Math.max(0.25, cfg.massifPower));
      strongest = Math.max(strongest, mask * heightT);
    }
  }
  return strongest;
}

function softenHeightCap(height: number, minHeight: number, maxHeight: number): number {
  const ceilingStart = Math.max(maxHeight - 18, minHeight);
  const ceiling = maxHeight - 0.5;
  if (height <= ceilingStart || ceiling <= ceilingStart) return height;

  const range = ceiling - ceilingStart;
  const excess = height - ceilingStart;
  return ceilingStart + (range * excess) / (excess + range);
}

export type TerrainSurfaceOverride = (x: number, z: number) => number;

let terrainSurfaceOverride: TerrainSurfaceOverride | null = null;

interface BorderCoastRuntime {
  config: BorderCoastOceanConfig;
  worldCellsX: number;
  worldCellsZ: number;
}

let borderCoastRuntime: BorderCoastRuntime | null = null;

export function setTerrainSurfaceOverride(override: TerrainSurfaceOverride | null): void {
  terrainSurfaceOverride = override;
}

export function setBorderCoastRuntime(
  config: BorderCoastOceanConfig | null,
  worldCellsX = 0,
  worldCellsZ = worldCellsX,
): void {
  // Border coast is a FINITE-world feature: applyBorderCoastShape() collapses
  // every coordinate outside [0, worldCells]² to the ocean/beach waterline.
  // Infinite island fields (islandShape.enabled) generate their own coasts and
  // ocean procedurally across an unbounded domain, so the finite rectangular
  // border coast must never be active in that mode — otherwise terrain far from
  // the (small) startup world flattens to a sea-level sheet.
  if (
    !config || !config.enabled || worldCellsX <= 0 || worldCellsZ <= 0 ||
    terrainFieldConfig.islandShape.enabled
  ) {
    borderCoastRuntime = null;
    return;
  }
  borderCoastRuntime = { config, worldCellsX, worldCellsZ };
}

export function getBorderCoastRuntime(): BorderCoastRuntime | null {
  return borderCoastRuntime;
}

export function baseSurfaceHeight(x: number, z: number): number {
  // An installed heightmap fully replaces the analytic shape (finite-world authority).
  const heightmapHeight = sampleHeightmapHeight(x, z);
  if (heightmapHeight !== null) return heightmapHeight;

  const cfg = TERRAIN_CONFIG;
  const field = terrainFieldConfig;
  const seed = field.seed;
  const minNormalTerrainSurfaceY = field.seaLevel - 4;
  const baseTerrainElevation = minNormalTerrainSurfaceY;
  const continentNoise = domainFbmConfigurable(
    x,
    z,
    cfg.continent.scale,
    cfg.continent.octaves,
    cfg.continent.persistence,
    cfg.continent.lacunarity,
    cfg.continent.warpStrength,
    seed + 101,
  );
  const continent = continentNoise * cfg.continent.amplitude * 0.55;

  const mountainSignal = domainFbmConfigurable(x, z, cfg.mountains.scale * 0.25, 2, 0.5, 2.0, cfg.mountains.warpStrength, seed + 211);
  const massifSignal = domainFbmConfigurable(
    x + 4096,
    z - 2048,
    cfg.mountains.massifScale,
    3,
    0.52,
    2.0,
    cfg.mountains.warpStrength * 1.6,
    seed + 307,
  );
  const massifMask = Math.max(
    Math.pow(smoothstepRange(cfg.mountains.massifThreshold, 1.0, massifSignal), Math.max(0.25, cfg.mountains.massifPower)),
    massifCellMask(x, z, seed),
  );
  const mountainRegionBase = Math.pow(Math.min(1, Math.max(0, mountainSignal)), 1.35);
  const mountainRegion = Math.min(1, Math.max(0, mountainRegionBase * 0.55 + massifMask * 0.8));
  const mountains = ridgedNoise(x, z, seed) * mountainRegion * (1 + massifMask * 0.55);
  const mountainUplift = cfg.mountains.amplitude * 0.18 * mountainRegion + cfg.mountains.massifAmplitude * massifMask;

  const valleySignal = domainFbmConfigurable(x + 1375, z - 911, cfg.continent.scale * 2.2, 3, 0.55, 2.0, 120, seed + 409);
  const valleyMask = smoothstepRange(0.22, 0.08, valleySignal);
  const valleyCarve = valleyMask * 14 * (1 - mountainRegion * 0.75);

  const hillNoise = domainFbmConfigurable(x, z, cfg.hills.scale, cfg.hills.octaves, cfg.hills.persistence, cfg.hills.lacunarity, cfg.hills.warpStrength, seed + 503);
  const hills = hillNoise * cfg.hills.amplitude * 0.45;

  const detailNoise = fbmConfigurable(x, z, cfg.detail.scale, cfg.detail.octaves, cfg.detail.persistence, cfg.detail.lacunarity, seed + 607) * 0.65
    + domainFbmConfigurable(x, z, cfg.detail.scale * 0.8, 2, 0.5, 2.0, cfg.detail.warpStrength, seed + 701) * 0.35;
  const detail = detailNoise * cfg.detail.amplitude;

  const minSurface = Math.max(cfg.height.min, minNormalTerrainSurfaceY);
  const height = baseTerrainElevation + continent + mountains + mountainUplift + hills + detail - valleyCarve;
  const capped = Math.min(cfg.height.max - 0.5, Math.max(minSurface, softenHeightCap(height, minSurface, cfg.height.max)));
  return applyIslandShape(x, z, capped, field.islandShape);
}

export function surfaceHeight(x: number, z: number): number {
  const inland = terrainSurfaceOverride ? terrainSurfaceOverride(x, z) : baseSurfaceHeight(x, z);
  if (!borderCoastRuntime) return inland;
  return applyBorderCoastShape(
    x,
    z,
    inland,
    borderCoastRuntime.config ?? DEFAULT_BORDER_COAST_OCEAN_CONFIG,
    { cellsX: borderCoastRuntime.worldCellsX, cellsZ: borderCoastRuntime.worldCellsZ },
  );
}
