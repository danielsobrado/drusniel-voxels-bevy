// Deterministic stone scatter over the PoC heightfield. Pure function of (grid cell, seed):
// the same seed yields a byte-identical instance list, which the page guard relies on — stones
// are an overlay and never feed `source_mesh.ts` / `weld.ts`. Terrain-aware weighting mirrors
// the LAAS rules adapted to the fields the PoC terrain exposes (height, normal, material bands).

import { terrainWeights, surfaceHeight, surfaceNormal, WATER_LEVEL } from "../terrain/terrain.js";
import type { PageFootprint } from "../types.js";
import { ROCK_PRESETS, type RockPreset } from "./rock_builder.js";
import { hash2, hashU32 } from "./stone_hash.js";
import {
  CLASS_BASE_WEIGHTS,
  STONE_CLASSES,
  type StoneClass,
  type StoneSettings,
  type StoneTerrainClassWeights,
} from "./stone_config.js";

const TWO_PI = Math.PI * 2;

/** Salt for the per-cell acceptance roll (added to settings.seedSalt). Shared with the debug sampler. */
export const ACCEPT_SALT = 307;

// Decorrelated salt offsets per decision stream (added to settings.seedSalt).
const SALT = {
  jitterX: 101,
  jitterZ: 211,
  accept: ACCEPT_SALT,
  clump: 419,
  classRoll: 523,
  presetRoll: 631,
  variantRoll: 743,
  radius: 859,
  priority: 977,
} as const;

export interface StoneInstance {
  x: number;
  y: number;
  z: number;
  scale: number;
  yaw: number;
  leanX: number;
  leanZ: number;
  classId: StoneClass;
  preset: RockPreset;
  variant: number;
}

/** Per-site terrain readout, exposed for debug heatmaps and acceptance. */
export interface StoneSiteSample {
  height: number;
  normalY: number;
  grass: number;
  rockExposure: number;
  snow: number;
  sand: number;
  scree: number;
  streambed: number;
  cliffAbove: number;
  repose: number;
  standingWater: boolean;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Sample the terrain-derived placement fields at a world position. */
export function sampleStoneSite(x: number, z: number, settings: StoneSettings): StoneSiteSample {
  const height = surfaceHeight(x, z);
  const normal = surfaceNormal(x, z);
  const normalY = normal[1];
  const [grass, rock, sand, snow] = terrainWeights(height, normalY);

  const standingWater = height < WATER_LEVEL + settings.waterMarginM + settings.standingWaterCutoffM;
  const repose = clamp01(
    (normalY - settings.slopeRepose) / Math.max(1e-3, settings.slopeReposeStart - settings.slopeRepose),
  );
  // Steeper-but-stable ground accumulates scree (more stones as it tilts, until repose cuts it).
  const scree = clamp01(
    (settings.slopeReposeStart - normalY) /
      Math.max(1e-3, settings.slopeReposeStart - settings.slopeRepose),
  ) * repose;

  // Streambed proxy: PoC has no river field, so use the near-water sand band just above water.
  const streambed = standingWater
    ? 0
    : smoothstep(settings.streambedSandStart, settings.streambedSandEnd, sand);

  // Talus: probe uphill (steepest-ascent direction = -normal.xz) for a steep rise above the site.
  const up = Math.hypot(normal[0], normal[2]);
  const ux = up > 1e-4 ? -normal[0] / up : 0;
  const uz = up > 1e-4 ? -normal[2] / up : 0;
  const near = settings.cliffProbeNearM;
  const far = settings.cliffProbeFarM;
  const hNear = surfaceHeight(x + ux * near, z + uz * near);
  const hFar = surfaceHeight(x + ux * far, z + uz * far);
  const riseNear = (hNear - height) / Math.max(1e-3, near);
  const riseFar = (hFar - hNear) / Math.max(1e-3, far - near);
  const cliffAbove = smoothstep(settings.cliffRiseStart, settings.cliffRiseEnd, Math.max(riseNear, riseFar));

  return { height, normalY, grass, rockExposure: rock, snow, sand, scree, streambed, cliffAbove, repose, standingWater };
}

export function stoneTerrainBias(site: StoneSiteSample, settings: StoneSettings): StoneTerrainClassWeights {
  const material = blendTerrainWeights([
    [settings.terrain.grass, site.grass],
    [settings.terrain.rock, site.rockExposure],
    [settings.terrain.sand, site.sand],
    [settings.terrain.snow, site.snow],
  ]);
  const t = settings.terrain;
  const blend = Math.max(0.001, t.heightBlendM);
  const lowWeight = 1 - smoothstep(t.lowHeightM - blend, t.lowHeightM + blend, site.height);
  const highWeight = smoothstep(t.highHeightM - blend, t.highHeightM + blend, site.height);
  const midWeight = Math.max(0, 1 - lowWeight - highWeight);
  const height = blendTerrainWeights([
    [t.low, lowWeight],
    [t.mid, midWeight],
    [t.high, highWeight],
  ]);
  return {
    density: material.density * height.density,
    large: material.large * height.large,
    medium: material.medium * height.medium,
    small: material.small * height.small,
  };
}

/** Combined acceptance weight (≥0; >1 means certain). */
export function stoneWeight(site: StoneSiteSample, settings: StoneSettings, x: number, z: number): number {
  if (site.standingWater || site.repose <= 0) return 0;
  const clumpCell = Math.max(1, settings.cellSizeM * settings.patchClumpCellMult);
  const patchClump =
    settings.patchClumpMin +
    hash2(Math.floor(x / clumpCell), Math.floor(z / clumpCell), settings.seedSalt + SALT.clump);
  const base =
    site.rockExposure * settings.rockExposureWeight +
    site.scree * settings.screeWeight +
    site.streambed * settings.streamWeight +
    site.cliffAbove * settings.cliffAboveWeight +
    settings.baseSoilWeight;
  return settings.density * base * patchClump * site.repose * stoneTerrainBias(site, settings).density * (1 - site.snow * settings.snowFade);
}

export function stoneClassWeights(site: StoneSiteSample, settings: StoneSettings): Record<StoneClass, number> {
  // Large stones gain weight where scree, streambeds, and cliff-fans collect bigger blocks.
  const largeBias =
    1 + site.scree + site.cliffAbove + site.streambed * settings.streamLargeBias * 6;
  const terrain = stoneTerrainBias(site, settings);
  return {
    large: CLASS_BASE_WEIGHTS.large * largeBias * terrain.large,
    medium: CLASS_BASE_WEIGHTS.medium * terrain.medium,
    small: CLASS_BASE_WEIGHTS.small * terrain.small,
  };
}

export function stoneClassWeightTotal(weights: Record<StoneClass, number>): number {
  return Math.max(0, weights.large) + Math.max(0, weights.medium) + Math.max(0, weights.small);
}

export function selectStoneClass(site: StoneSiteSample, settings: StoneSettings, roll: number): StoneClass {
  return selectStoneClassFromWeights(stoneClassWeights(site, settings), roll) ?? "small";
}

function selectStoneClassFromWeights(weights: Record<StoneClass, number>, roll: number): StoneClass | null {
  const total = stoneClassWeightTotal(weights);
  if (total <= 0) return null;
  let acc = 0;
  const target = clamp01(roll) * total;
  for (const cls of STONE_CLASSES) {
    acc += Math.max(0, weights[cls]);
    if (target < acc) return cls;
  }
  return "small";
}

function selectPreset(cls: StoneClass, site: StoneSiteSample, settings: StoneSettings, roll: number): RockPreset {
  const presets = settings.classes[cls].presets;
  if (presets.length === 1) return presets[0];
  // Streambeds favour rounded boulders; dry scree/cliff fans favour faceted talus.
  if (site.streambed > 0.4 && presets.includes("boulder")) return "boulder";
  if ((site.scree > 0.3 || site.cliffAbove > 0.3) && presets.includes("talus")) return "talus";
  return presets[Math.floor(roll * presets.length) % presets.length];
}

export interface RankedStoneInstance {
  priority: number;
  instance: StoneInstance;
}

/**
 * Scatter ranked stone candidates over a page footprint. Deterministic in (footprint, settings);
 * callers can merge multiple footprints, sort by priority, then apply one global budget.
 */
export function generateRankedStoneInstances(
  footprint: PageFootprint,
  settings: StoneSettings,
): RankedStoneInstance[] {
  const ranked: RankedStoneInstance[] = [];
  const spacing = Math.max(0.1, settings.cellSizeM);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  if (settings.density <= 0) return [];

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const gridX = Math.floor(footprint.minX / spacing) + column;
      const gridZ = Math.floor(footprint.minZ / spacing) + row;
      const jx = (hash2(gridX, gridZ, settings.seedSalt + SALT.jitterX) * 2 - 1) * spacing * 0.34;
      const jz = (hash2(gridX, gridZ, settings.seedSalt + SALT.jitterZ) * 2 - 1) * spacing * 0.34;
      const x = Math.min(footprint.maxX - 1e-3, Math.max(footprint.minX + 1e-3, footprint.minX + (column + 0.5) * spacing + jx));
      const z = Math.min(footprint.maxZ - 1e-3, Math.max(footprint.minZ + 1e-3, footprint.minZ + (row + 0.5) * spacing + jz));

      const site = sampleStoneSite(x, z, settings);
      const weight = stoneWeight(site, settings, x, z);
      if (weight <= 0) continue;
      if (hash2(gridX, gridZ, settings.seedSalt + SALT.accept) >= weight) continue;

      const classWeights = stoneClassWeights(site, settings);
      const cls = selectStoneClassFromWeights(classWeights, hash2(gridX, gridZ, settings.seedSalt + SALT.classRoll));
      if (!cls) continue;
      const classCfg = settings.classes[cls];
      const preset = selectPreset(cls, site, settings, hash2(gridX, gridZ, settings.seedSalt + SALT.presetRoll));
      const variant = hashU32(gridX, gridZ, settings.seedSalt + SALT.variantRoll) % Math.max(1, classCfg.variants);

      const targetRadius =
        classCfg.radiusMin +
        (classCfg.radiusMax - classCfg.radiusMin) * hash2(gridX, gridZ, settings.seedSalt + SALT.radius);
      const scale = targetRadius / ROCK_PRESETS[preset].radius;

      // Bed deeper on slopes so stones rest in the ground rather than balancing on it.
      const slopeAmt = 1 - site.normalY;
      const sinkDepth = classCfg.sink * targetRadius * (1 + slopeAmt * settings.sinkSlopeMultiplier);
      const y = site.height - sinkDepth;

      const normal = surfaceNormal(x, z);
      const leanX = normal[2] * settings.normalLean * slopeAmt;
      const leanZ = -normal[0] * settings.normalLean * slopeAmt;
      const yaw = hash2(gridX, gridZ, settings.seedSalt + SALT.classRoll + 13) * TWO_PI;

      ranked.push({
        priority: hash2(gridX, gridZ, settings.seedSalt + SALT.priority),
        instance: { x, y, z, scale, yaw, leanX, leanZ, classId: cls, preset, variant },
      });
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  return ranked;
}

/**
 * Scatter stones over a page footprint. Deterministic in (footprint, settings); accepted
 * candidates are ranked by a stable priority hash and truncated to `maxInstances`, so a
 * smaller budget yields a stable subset of the larger one.
 */
export function generateStoneInstances(
  footprint: PageFootprint,
  settings: StoneSettings,
  maxInstances = settings.maxInstances,
): StoneInstance[] {
  const limit = Math.max(0, Math.floor(maxInstances));
  if (limit === 0 || settings.density <= 0) return [];
  const ranked = generateRankedStoneInstances(footprint, settings);
  return ranked.slice(0, limit).map((entry) => entry.instance);
}

/** Class-share breakdown of an instance list (for tests/debug). */
export function classShares(instances: readonly StoneInstance[]): Record<StoneClass, number> {
  const counts: Record<StoneClass, number> = { large: 0, medium: 0, small: 0 };
  for (const instance of instances) counts[instance.classId]++;
  const total = instances.length || 1;
  return { large: counts.large / total, medium: counts.medium / total, small: counts.small / total };
}

function blendTerrainWeights(
  weighted: readonly (readonly [StoneTerrainClassWeights, number])[],
): StoneTerrainClassWeights {
  let sum = 0;
  let density = 0;
  let large = 0;
  let medium = 0;
  let small = 0;
  for (const [entry, rawWeight] of weighted) {
    const weight = Math.max(0, rawWeight);
    sum += weight;
    density += entry.density * weight;
    large += entry.large * weight;
    medium += entry.medium * weight;
    small += entry.small * weight;
  }
  if (sum <= 0) return { density: 1, large: 1, medium: 1, small: 1 };
  const inv = 1 / sum;
  return {
    density: mix(1, density * inv, 1),
    large: mix(1, large * inv, 1),
    medium: mix(1, medium * inv, 1),
    small: mix(1, small * inv, 1),
  };
}
