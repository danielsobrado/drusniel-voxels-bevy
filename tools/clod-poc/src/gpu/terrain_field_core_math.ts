import { DEFAULT_TERRAIN_FIELD_CONFIG, type TerrainFieldConfig } from "../terrain/terrain.js";
import { applyIslandShape } from "../world_source/island_shape.js";
import { sampleHeightmapHeight } from "../terrain/heightmap_source.js";
import type { ResolvedDigEdit } from "./terrain_field_core_types.js";
import { DIG_INFLUENCE_MARGIN, brushSdfCore, brushWeight } from "./terrain_field_core_dig.js";

const DEFAULT_TERRAIN_SEED = 0;
const BEDROCK_Y = 1;

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
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

function smoothstepRange(edge0: number, edge1: number, value: number): number {
  const denominator = edge1 - edge0;
  if (Math.abs(denominator) <= Number.EPSILON) return value >= edge1 ? 1 : 0;
  return smooth((value - edge0) / denominator);
}

function valueNoise2(x: number, z: number, seed = DEFAULT_TERRAIN_SEED): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const zf = smooth(z - zi);
  const a = hashPositionSeeded(xi, zi, seed);
  const b = hashPositionSeeded(xi + 1, zi, seed);
  const c = hashPositionSeeded(xi, zi + 1, seed);
  const d = hashPositionSeeded(xi + 1, zi + 1, seed);
  return a + (b - a) * xf + (c - a) * zf + (a - b - c + d) * xf * zf;
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
  let value = 0;
  let amplitude = 1;
  let frequency = Math.max(1e-8, scale);
  let maxValue = 0;
  const oct = Math.max(1, Math.floor(octaves));
  for (let i = 0; i < oct; i++) {
    value += amplitude * valueNoise2(
      x * frequency + i * 37.17,
      z * frequency - i * 19.31,
      seed + i * 101,
    );
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return maxValue > 0 ? value / maxValue : 0;
}

function ridgedFbmConfigurable(
  x: number,
  z: number,
  scale: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  power: number,
  seed = DEFAULT_TERRAIN_SEED,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = Math.max(1e-8, scale);
  let maxValue = 0;
  const oct = Math.max(1, Math.floor(octaves));
  for (let i = 0; i < oct; i++) {
    const n = valueNoise2(
      x * frequency + i * 83.9,
      z * frequency - i * 47.3,
      seed + i * 131,
    );
    const ridge = Math.pow(1 - Math.abs(n * 2 - 1), power);
    value += amplitude * ridge;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return maxValue > 0 ? value / maxValue : 0;
}

function ridgedNoise(x: number, z: number, seed: number): number {
  const cfg = TERRAIN_CONFIG.mountains;
  return ridgedFbmConfigurable(
    x, z, cfg.scale, cfg.octaves, cfg.persistence, cfg.lacunarity, cfg.ridgePower, seed + 37,
  ) * cfg.amplitude;
}

function domainWarpedFbmConfigurable(
  x: number,
  z: number,
  scale: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  warpStrength: number,
  seed = DEFAULT_TERRAIN_SEED,
): number {
  const warpScale = scale * 0.31;
  const warpOctaves = Math.max(1, Math.min(3, octaves));
  const wx = fbmConfigurable(x + 137.5, z - 91.25, warpScale, warpOctaves, 0.5, 2.0, seed + 811) * 2 - 1;
  const wz = fbmConfigurable(x - 233.75, z + 57.5, warpScale, warpOctaves, 0.5, 2.0, seed + 1451) * 2 - 1;
  return fbmConfigurable(x + wx * warpStrength, z + wz * warpStrength, scale, octaves, persistence, lacunarity, seed);
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

export const _fieldConfig = { value: DEFAULT_TERRAIN_FIELD_CONFIG as TerrainFieldConfig };

export function surfaceHeightCore(x: number, z: number, config: TerrainFieldConfig = _fieldConfig.value): number {
  // An installed heightmap fully replaces the analytic shape (finite-world authority). Shared
  // with baseSurfaceHeight() via heightmap_source.ts so both fields return the identical value.
  const heightmapHeight = sampleHeightmapHeight(x, z);
  if (heightmapHeight !== null) return heightmapHeight;

  const cfg = TERRAIN_CONFIG;
  const field = config;
  const seed = field.seed;
  const minNormalTerrainSurfaceY = field.seaLevel - 4;
  const baseTerrainElevation = minNormalTerrainSurfaceY;
  const continentNoise = domainWarpedFbmConfigurable(
    x, z, cfg.continent.scale, cfg.continent.octaves, cfg.continent.persistence,
    cfg.continent.lacunarity, cfg.continent.warpStrength, seed + 101,
  );
  const continent = continentNoise * cfg.continent.amplitude * 0.55;

  const mountainSignal = domainWarpedFbmConfigurable(
    x, z, cfg.mountains.scale * 0.25, 2, 0.5, 2.0,
    cfg.mountains.warpStrength, seed + 211,
  );
  const massifSignal = domainWarpedFbmConfigurable(
    x + 4096, z - 2048, cfg.mountains.massifScale, 3, 0.52, 2.0,
    cfg.mountains.warpStrength * 1.6, seed + 307,
  );
  const massifMask = Math.max(
    Math.pow(smoothstepRange(cfg.mountains.massifThreshold, 1.0, massifSignal), Math.max(0.25, cfg.mountains.massifPower)),
    massifCellMask(x, z, seed),
  );
  const mountainRegionBase = Math.pow(Math.min(1, Math.max(0, mountainSignal)), 1.35);
  const mountainRegion = Math.min(1, Math.max(0, mountainRegionBase * 0.55 + massifMask * 0.8));
  const mountains = ridgedNoise(x, z, seed) * mountainRegion * (1 + massifMask * 0.55);
  const mountainUplift = cfg.mountains.amplitude * 0.18 * mountainRegion + cfg.mountains.massifAmplitude * massifMask;

  const valleySignal = domainWarpedFbmConfigurable(
    x + 1375, z - 911, cfg.continent.scale * 2.2, 3, 0.55, 2.0, 120, seed + 409,
  );
  const valleyMask = smoothstepRange(0.22, 0.08, valleySignal);
  const valleyCarve = valleyMask * 14 * (1 - mountainRegion * 0.75);

  const hillNoise = domainWarpedFbmConfigurable(
    x, z, cfg.hills.scale, cfg.hills.octaves, cfg.hills.persistence,
    cfg.hills.lacunarity, cfg.hills.warpStrength, seed + 503,
  );
  const hills = hillNoise * cfg.hills.amplitude * 0.45;

  const detailFbm = fbmConfigurable(
    x, z, cfg.detail.scale, cfg.detail.octaves, cfg.detail.persistence, cfg.detail.lacunarity, seed + 607,
  );
  const detailWarp = domainWarpedFbmConfigurable(
    x, z, cfg.detail.scale * 0.8, 2, 0.5, 2.0, cfg.detail.warpStrength, seed + 701,
  );
  const detailNoise = detailFbm * 0.65 + detailWarp * 0.35;
  const detail = detailNoise * cfg.detail.amplitude;

  const minSurface = Math.max(cfg.height.min, minNormalTerrainSurfaceY);
  const height = baseTerrainElevation + continent + mountains + mountainUplift + hills + detail - valleyCarve;
  const capped = Math.min(cfg.height.max - 0.5, Math.max(minSurface, softenHeightCap(height, minSurface, cfg.height.max)));
  return applyIslandShape(x, z, capped, field.islandShape);
}

export const MATERIAL_PAINT_BAND = 0.75;

export function paintMaterialAtCore(x: number, y: number, z: number, edits: readonly ResolvedDigEdit[]): number {
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    if (e.opAdd !== 1) continue;
    const reachXZ = e.r + DIG_INFLUENCE_MARGIN, reachY = e.h + DIG_INFLUENCE_MARGIN;
    const dx = x - e.x, dy = y - e.y, dz = z - e.z;
    if (Math.abs(dx) > reachXZ || Math.abs(dy) > reachY || Math.abs(dz) > reachXZ) continue;
    if (brushSdfCore(e.shape, dx, dy, dz, e.r, e.h) <= MATERIAL_PAINT_BAND) {
      return e.material + 1;
    }
  }
  return 0;
}

export function densityCore(x: number, y: number, z: number, edits: readonly ResolvedDigEdit[]): number {
  let d = surfaceHeightCore(x, z) - y;
  if (edits.length > 0 && y > BEDROCK_Y) {
    for (const e of edits) {
      const reachXZ = e.r + DIG_INFLUENCE_MARGIN, reachY = e.h + DIG_INFLUENCE_MARGIN;
      const dx = x - e.x, dy = y - e.y, dz = z - e.z;
      if (Math.abs(dx) > reachXZ || Math.abs(dy) > reachY || Math.abs(dz) > reachXZ) continue;
      const sdf = brushSdfCore(e.shape, dx, dy, dz, e.r, e.h);
      const full = e.opAdd === 1 ? Math.max(d, -sdf) : Math.min(d, sdf);
      d += (full - d) * brushWeight(sdf, e.falloff, e.r, e.strength);
    }
  }
  return d;
}

export function densityGradientCore(
  x: number,
  y: number,
  z: number,
  edits: readonly ResolvedDigEdit[],
): [number, number, number] {
  const e = 0.5;
  const gx = densityCore(x + e, y, z, edits) - densityCore(x - e, y, z, edits);
  const gy = densityCore(x, y + e, z, edits) - densityCore(x, y - e, z, edits);
  const gz = densityCore(x, y, z + e, edits) - densityCore(x, y, z - e, edits);
  const nx = -gx, ny = -gy, nz = -gz;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}
