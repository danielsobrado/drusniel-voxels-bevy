import type { CanopyTreeDistributionConfig } from "./canopy_types_internal.js";
import type { CanopySummaryCell } from "./canopy_types.js";
import type { TerrainSample } from "./canopy_terrain_sampler.js";
import { clamp01, fbm2, hash01, smoothstep } from "./canopy_hash.js";

export interface SpeciesWeights {
  pine: number;
  broadleaf: number;
  deadwood: number;
}

export interface TreeCandidate {
  x: number;
  z: number;
  groundHeight: number;
  canopyHeight: number;
  crownRadius: number;
  coverage: number;
  species: SpeciesWeights;
  crownRoughness: number;
}

export interface TreeDistribution {
  sampleForestPotential(x: number, z: number): number;
  sampleMoisture(x: number, z: number): number;
  sampleSpeciesWeights(x: number, z: number, slope: number, moisture: number): SpeciesWeights;
  sampleTreeCandidate(x: number, z: number, terrain: TerrainSample): TreeCandidate | null;
  accumulateCanopyCell(
    cellOriginX: number,
    cellOriginZ: number,
    cellSizeM: number,
    terrainSampler: { sample(x: number, z: number): TerrainSample },
  ): CanopySummaryCell;
}

const STRATIFIED_OFFSETS = [0.25, 0.75];

export function createTreeDistribution(
  config: CanopyTreeDistributionConfig,
  seed: number,
): TreeDistribution {
  const slopeReject = (slope: number): number => {
    if (slope <= config.slopeRejectStart) return 1;
    if (slope >= config.slopeRejectEnd) return 0;
    return 1 - smoothstep(config.slopeRejectStart, config.slopeRejectEnd, slope);
  };

  const sampleForestPotential = (x: number, z: number): number => {
    const region = fbm2(x, z, seed, 4);
    const detail = fbm2(x * 2.7 + 91, z * 2.7 - 33, seed + 7, 2);
    return clamp01((region * 0.75 + detail * 0.25) * config.densityScale);
  };

  const sampleMoisture = (x: number, z: number): number =>
    clamp01(fbm2(x + 500, z - 200, seed + 31, 3));

  const sampleSpeciesWeights = (x: number, z: number, slope: number, moisture: number): SpeciesWeights => {
    const elevation = fbm2(x, z, seed + 99, 2);
    let pine = clamp01(slope * 1.2 + elevation * 0.35 + (1 - moisture) * 0.2);
    let broadleaf = clamp01((1 - slope) * 0.6 + moisture * 0.7 + hash01(Math.floor(x), Math.floor(z), seed + 3) * 0.1);
    let deadwood = clamp01((1 - moisture) * 0.5 + slope * 0.35 + hash01(Math.floor(x * 0.5), Math.floor(z * 0.5), seed + 5) * 0.2);
    const sum = pine + broadleaf + deadwood;
    if (sum <= 1e-6) return { pine: 1 / 3, broadleaf: 1 / 3, deadwood: 1 / 3 };
    return { pine: pine / sum, broadleaf: broadleaf / sum, deadwood: deadwood / sum };
  };

  const sampleTreeCandidate = (x: number, z: number, terrain: TerrainSample): TreeCandidate | null => {
    if (config.waterReject && terrain.water) return null;
    const slopeFactor = slopeReject(terrain.slope);
    if (slopeFactor <= 0) return null;

    const moisture = sampleMoisture(x, z);
    const forest = sampleForestPotential(x, z) * slopeFactor;
    if (forest < config.forestThreshold * 0.5) return null;

    const wx = Math.floor(x);
    const wz = Math.floor(z);
    const presence = hash01(wx, wz, seed + 13);
    if (presence > forest) return null;

    const species = sampleSpeciesWeights(x, z, terrain.slope, moisture);
    const heightT = hash01(wx + 7, wz + 11, seed + 17);
    const treeHeight = config.minCanopyHeightM
      + (config.maxCanopyHeightM - config.minCanopyHeightM) * heightT;
    const radiusT = hash01(wx + 3, wz + 19, seed + 23);
    const crownRadius = config.crownRadiusMinM
      + (config.crownRadiusMaxM - config.crownRadiusMinM) * radiusT;
    const coverage = clamp01(forest * slopeFactor);
    const crownRoughness = clamp01(hash01(wx + 1, wz + 5, seed + 29) * 0.6 + terrain.slope * 0.4);

    return {
      x,
      z,
      groundHeight: terrain.height,
      canopyHeight: terrain.height + treeHeight,
      crownRadius,
      coverage,
      species,
      crownRoughness,
    };
  };

  const accumulateCanopyCell = (
    cellOriginX: number,
    cellOriginZ: number,
    cellSizeM: number,
    terrainSampler: { sample(x: number, z: number): TerrainSample },
  ): CanopySummaryCell => {
    let coverage = 0;
    let canopyHeight = 0;
    let groundHeight = 0;
    let crownRoughness = 0;
    let slope = 0;
    let moisture = 0;
    let speciesPine = 0;
    let speciesBroadleaf = 0;
    let speciesDeadwood = 0;
    let samples = 0;
    let waterBlocked = false;

    for (const ox of STRATIFIED_OFFSETS) {
      for (const oz of STRATIFIED_OFFSETS) {
        const x = cellOriginX + ox * cellSizeM;
        const z = cellOriginZ + oz * cellSizeM;
        const terrain = terrainSampler.sample(x, z);
        if (config.waterReject && terrain.water) {
          waterBlocked = true;
          continue;
        }
        const candidate = sampleTreeCandidate(x, z, terrain);
        samples++;
        groundHeight += terrain.height;
        slope += terrain.slope;
        moisture += sampleMoisture(x, z);
        if (!candidate) continue;
        const crownArea = Math.PI * candidate.crownRadius * candidate.crownRadius;
        const cellArea = cellSizeM * cellSizeM;
        const contrib = clamp01((crownArea / cellArea) * candidate.coverage);
        coverage += contrib;
        canopyHeight += candidate.canopyHeight * contrib;
        crownRoughness += candidate.crownRoughness * contrib;
        speciesPine += candidate.species.pine * contrib;
        speciesBroadleaf += candidate.species.broadleaf * contrib;
        speciesDeadwood += candidate.species.deadwood * contrib;
      }
    }

    if (waterBlocked && coverage <= 0) {
      const center = terrainSampler.sample(cellOriginX + cellSizeM * 0.5, cellOriginZ + cellSizeM * 0.5);
      return {
        groundHeight: center.height,
        canopyHeight: center.height,
        coverage: 0,
        crownRoughness: 0,
        slope: center.slope,
        moisture: sampleMoisture(cellOriginX, cellOriginZ),
        speciesPine: 0,
        speciesBroadleaf: 0,
        speciesDeadwood: 0,
      };
    }

    coverage = clamp01(coverage / (STRATIFIED_OFFSETS.length * STRATIFIED_OFFSETS.length));
    const inv = coverage > 1e-6 ? 1 / coverage : 0;
    const avgGround = samples > 0 ? groundHeight / samples : 0;
    const avgSlope = samples > 0 ? slope / samples : 0;
    const avgMoisture = samples > 0 ? moisture / samples : sampleMoisture(cellOriginX, cellOriginZ);

    return {
      groundHeight: avgGround,
      canopyHeight: coverage > 0 ? canopyHeight * inv : avgGround,
      coverage,
      crownRoughness: coverage > 0 ? crownRoughness * inv : 0,
      slope: avgSlope,
      moisture: avgMoisture,
      speciesPine: coverage > 0 ? speciesPine * inv : 0,
      speciesBroadleaf: coverage > 0 ? speciesBroadleaf * inv : 0,
      speciesDeadwood: coverage > 0 ? speciesDeadwood * inv : 0,
    };
  };

  return {
    sampleForestPotential,
    sampleMoisture,
    sampleSpeciesWeights,
    sampleTreeCandidate,
    accumulateCanopyCell,
  };
}

/** World-space cell origin for seam-stable addressing. */
export function worldCellOrigin(worldCellX: number, worldCellZ: number, cellSizeM: number): { x: number; z: number } {
  return { x: worldCellX * cellSizeM, z: worldCellZ * cellSizeM };
}

export function worldCellIndex(worldX: number, worldZ: number, cellSizeM: number): { cx: number; cz: number } {
  return {
    cx: Math.floor(worldX / cellSizeM),
    cz: Math.floor(worldZ / cellSizeM),
  };
}
