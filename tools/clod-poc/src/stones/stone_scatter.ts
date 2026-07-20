// Deterministic CPU stone oracle/fallback. Stones remain an overlay and never modify CLOD pages.

import type { PageFootprint } from "../types.js";
import { ROCK_PRESETS, type RockPreset } from "./rock_builder.js";
import { StoneEnvironmentSampler } from "./stone_environment_sampler.js";
import type { StoneEnvironmentSource } from "./stone_environment_sampler.js";
import { hash2, hashU32 } from "./stone_hash.js";
import {
  CLASS_BASE_WEIGHTS,
  STONE_CLASSES,
  type StoneClass,
  type StoneSettings,
  type StoneTerrainClassWeights,
} from "./stone_config.js";

export type { StoneEnvironmentSource } from "./stone_environment_sampler.js";

const TWO_PI = Math.PI * 2;

/** Salt for the per-cell acceptance roll. Shared with the debug sampler. */
export const ACCEPT_SALT = 307;

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
  normalX: number;
  normalY: number;
  normalZ: number;
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

export interface RankedStoneInstance {
  priority: number;
  instance: StoneInstance;
}

interface StoneFeatureField {
  excludesScatter(x: number, z: number): boolean;
}

/** Sample the terrain-derived placement fields at a world position. */
export function sampleStoneSite(
  x: number,
  z: number,
  settings: StoneSettings,
  source: StoneEnvironmentSource = new StoneEnvironmentSampler({ sampleHintM: settings.cellSizeM }),
): StoneSiteSample {
  const environment = source.sampleSite(x, z, settings);
  if (!environment) return invalidStoneSite();

  const normalY = environment.normalY;
  const repose = clamp01(
    (normalY - settings.slopeRepose)
      / Math.max(1e-3, settings.slopeReposeStart - settings.slopeRepose),
  );
  const scree = clamp01(
    (settings.slopeReposeStart - normalY)
      / Math.max(1e-3, settings.slopeReposeStart - settings.slopeRepose),
  ) * repose;

  // The CPU oracle avoids requesting river metrics because that would add two drop probes per site.
  const streambed = environment.standingWater
    ? 0
    : smoothstep(settings.streambedSandStart, settings.streambedSandEnd, environment.sand);

  const horizontalNormal = Math.hypot(environment.normalX, environment.normalZ);
  const ux = horizontalNormal > 1e-4 ? -environment.normalX / horizontalNormal : 0;
  const uz = horizontalNormal > 1e-4 ? -environment.normalZ / horizontalNormal : 0;
  const near = settings.cliffProbeNearM;
  const far = settings.cliffProbeFarM;
  const hNear = source.sampleHeight(x + ux * near, z + uz * near);
  const hFar = source.sampleHeight(x + ux * far, z + uz * far);
  if (hNear === null || hFar === null) return invalidStoneSite();

  const riseNear = (hNear - environment.height) / Math.max(1e-3, near);
  const riseFar = (hFar - hNear) / Math.max(1e-3, far - near);
  const cliffAbove = smoothstep(
    settings.cliffRiseStart,
    settings.cliffRiseEnd,
    Math.max(riseNear, riseFar),
  );

  return {
    height: environment.height,
    normalX: environment.normalX,
    normalY,
    normalZ: environment.normalZ,
    grass: environment.grass,
    rockExposure: environment.rock,
    snow: environment.snow,
    sand: environment.sand,
    scree,
    streambed,
    cliffAbove,
    repose,
    standingWater: environment.standingWater,
  };
}

export function stoneTerrainBias(
  site: StoneSiteSample,
  settings: StoneSettings,
): StoneTerrainClassWeights {
  const material = blendTerrainWeights([
    [settings.terrain.grass, site.grass],
    [settings.terrain.rock, site.rockExposure],
    [settings.terrain.sand, site.sand],
    [settings.terrain.snow, site.snow],
  ]);
  const terrain = settings.terrain;
  const blend = Math.max(0.001, terrain.heightBlendM);
  const lowWeight = 1 - smoothstep(
    terrain.lowHeightM - blend,
    terrain.lowHeightM + blend,
    site.height,
  );
  const highWeight = smoothstep(
    terrain.highHeightM - blend,
    terrain.highHeightM + blend,
    site.height,
  );
  const midWeight = Math.max(0, 1 - lowWeight - highWeight);
  const height = blendTerrainWeights([
    [terrain.low, lowWeight],
    [terrain.mid, midWeight],
    [terrain.high, highWeight],
  ]);
  return {
    density: material.density * height.density,
    large: material.large * height.large,
    medium: material.medium * height.medium,
    small: material.small * height.small,
  };
}

/** Combined acceptance weight. Values above one mean certain acceptance. */
export function stoneWeight(
  site: StoneSiteSample,
  settings: StoneSettings,
  x: number,
  z: number,
): number {
  if (site.standingWater || site.repose <= 0) return 0;
  const clumpCell = Math.max(1, settings.cellSizeM * settings.patchClumpCellMult);
  const patchClump = settings.patchClumpMin
    + hash2(
      Math.floor(x / clumpCell),
      Math.floor(z / clumpCell),
      settings.seedSalt + SALT.clump,
    );
  const base = site.rockExposure * settings.rockExposureWeight
    + site.scree * settings.screeWeight
    + site.streambed * settings.streamWeight
    + site.cliffAbove * settings.cliffAboveWeight
    + settings.baseSoilWeight;
  return settings.density
    * base
    * patchClump
    * site.repose
    * stoneTerrainBias(site, settings).density
    * (1 - site.snow * settings.snowFade);
}

export function stoneClassWeights(
  site: StoneSiteSample,
  settings: StoneSettings,
): Record<StoneClass, number> {
  const largeBias = 1
    + site.scree
    + site.cliffAbove
    + site.streambed * settings.streamLargeBias * 6;
  const terrain = stoneTerrainBias(site, settings);
  return {
    large: CLASS_BASE_WEIGHTS.large * largeBias * terrain.large,
    medium: CLASS_BASE_WEIGHTS.medium * terrain.medium,
    small: CLASS_BASE_WEIGHTS.small * terrain.small,
  };
}

export function stoneClassWeightTotal(weights: Record<StoneClass, number>): number {
  return Math.max(0, weights.large)
    + Math.max(0, weights.medium)
    + Math.max(0, weights.small);
}

export function selectStoneClass(
  site: StoneSiteSample,
  settings: StoneSettings,
  roll: number,
): StoneClass {
  return selectStoneClassFromWeights(stoneClassWeights(site, settings), roll) ?? "small";
}

/**
 * Scatter ranked stone candidates over a page footprint. Callers can merge footprints,
 * sort by priority, then apply one global budget.
 */
export function generateRankedStoneInstances(
  footprint: PageFootprint,
  settings: StoneSettings,
  featureField?: StoneFeatureField,
  source: StoneEnvironmentSource = new StoneEnvironmentSampler({ sampleHintM: settings.cellSizeM }),
): RankedStoneInstance[] {
  const ranked: RankedStoneInstance[] = [];
  const spacing = Math.max(0.1, settings.cellSizeM);
  const columns = Math.max(0, Math.floor((footprint.maxX - footprint.minX) / spacing));
  const rows = Math.max(0, Math.floor((footprint.maxZ - footprint.minZ) / spacing));
  if (settings.density <= 0) return ranked;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const gridX = Math.floor(footprint.minX / spacing) + column;
      const gridZ = Math.floor(footprint.minZ / spacing) + row;
      const jx = (hash2(gridX, gridZ, settings.seedSalt + SALT.jitterX) * 2 - 1)
        * spacing
        * 0.34;
      const jz = (hash2(gridX, gridZ, settings.seedSalt + SALT.jitterZ) * 2 - 1)
        * spacing
        * 0.34;
      const x = Math.min(
        footprint.maxX - 1e-3,
        Math.max(footprint.minX + 1e-3, footprint.minX + (column + 0.5) * spacing + jx),
      );
      const z = Math.min(
        footprint.maxZ - 1e-3,
        Math.max(footprint.minZ + 1e-3, footprint.minZ + (row + 0.5) * spacing + jz),
      );
      if (featureField?.excludesScatter(x, z)) continue;

      const site = sampleStoneSite(x, z, settings, source);
      const weight = stoneWeight(site, settings, x, z);
      if (weight <= 0) continue;
      if (hash2(gridX, gridZ, settings.seedSalt + SALT.accept) >= weight) continue;

      const classWeights = stoneClassWeights(site, settings);
      const cls = selectStoneClassFromWeights(
        classWeights,
        hash2(gridX, gridZ, settings.seedSalt + SALT.classRoll),
      );
      if (!cls) continue;
      const classConfig = settings.classes[cls];
      const preset = selectPreset(
        cls,
        site,
        settings,
        hash2(gridX, gridZ, settings.seedSalt + SALT.presetRoll),
      );
      const variant = hashU32(gridX, gridZ, settings.seedSalt + SALT.variantRoll)
        % Math.max(1, classConfig.variants);
      const targetRadius = classConfig.radiusMin
        + (classConfig.radiusMax - classConfig.radiusMin)
          * hash2(gridX, gridZ, settings.seedSalt + SALT.radius);
      const scale = targetRadius / ROCK_PRESETS[preset].radius;
      const slopeAmount = 1 - site.normalY;
      const sinkDepth = classConfig.sink
        * targetRadius
        * (1 + slopeAmount * settings.sinkSlopeMultiplier);
      const yaw = hash2(gridX, gridZ, settings.seedSalt + SALT.classRoll + 13) * TWO_PI;

      ranked.push({
        priority: hash2(gridX, gridZ, settings.seedSalt + SALT.priority),
        instance: {
          x,
          y: site.height - sinkDepth,
          z,
          scale,
          yaw,
          leanX: site.normalZ * settings.normalLean * slopeAmount,
          leanZ: -site.normalX * settings.normalLean * slopeAmount,
          classId: cls,
          preset,
          variant,
        },
      });
    }
  }

  ranked.sort((a, b) => a.priority - b.priority);
  return ranked;
}

/** Scatter stones and truncate the stable priority order to the requested budget. */
export function generateStoneInstances(
  footprint: PageFootprint,
  settings: StoneSettings,
  maxInstances = settings.maxInstances,
  featureField?: StoneFeatureField,
  source: StoneEnvironmentSource = new StoneEnvironmentSampler({ sampleHintM: settings.cellSizeM }),
): StoneInstance[] {
  const limit = Math.max(0, Math.floor(maxInstances));
  if (limit === 0 || settings.density <= 0) return [];
  return generateRankedStoneInstances(footprint, settings, featureField, source)
    .slice(0, limit)
    .map((entry) => entry.instance);
}

/** Class-share breakdown of an instance list. */
export function classShares(instances: readonly StoneInstance[]): Record<StoneClass, number> {
  const counts: Record<StoneClass, number> = { large: 0, medium: 0, small: 0 };
  for (const instance of instances) counts[instance.classId] += 1;
  const total = instances.length || 1;
  return {
    large: counts.large / total,
    medium: counts.medium / total,
    small: counts.small / total,
  };
}

function selectStoneClassFromWeights(
  weights: Record<StoneClass, number>,
  roll: number,
): StoneClass | null {
  const total = stoneClassWeightTotal(weights);
  if (total <= 0) return null;
  let accumulated = 0;
  const target = clamp01(roll) * total;
  for (const stoneClass of STONE_CLASSES) {
    accumulated += Math.max(0, weights[stoneClass]);
    if (target < accumulated) return stoneClass;
  }
  return "small";
}

function selectPreset(
  stoneClass: StoneClass,
  site: StoneSiteSample,
  settings: StoneSettings,
  roll: number,
): RockPreset {
  const presets = settings.classes[stoneClass].presets;
  if (presets.length === 0) return "cobble";
  if (presets.length === 1) return presets[0]!;
  if (site.streambed > 0.4 && presets.includes("boulder")) return "boulder";
  if ((site.scree > 0.3 || site.cliffAbove > 0.3) && presets.includes("talus")) return "talus";
  return presets[Math.floor(roll * presets.length) % presets.length]!;
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
  const inverse = 1 / sum;
  return {
    density: density * inverse,
    large: large * inverse,
    medium: medium * inverse,
    small: small * inverse,
  };
}

function invalidStoneSite(): StoneSiteSample {
  return {
    height: 0,
    normalX: 0,
    normalY: 1,
    normalZ: 0,
    grass: 0,
    rockExposure: 0,
    snow: 0,
    sand: 0,
    scree: 0,
    streambed: 0,
    cliffAbove: 0,
    repose: 0,
    standingWater: true,
  };
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
