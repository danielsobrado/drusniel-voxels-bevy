import { hashCombine, hashString, mix32, WorldSeed } from "../core/seed.js";
import {
  defaultBorderCoastOceanConfig,
  type BorderCoastOceanConfig,
} from "../config/borderCoastOceanConfig.js";
import { shapeCoastTerrain } from "../terrain/coastTerrain.js";
import { buildCoastMaterialWeights } from "../terrain/coastMaterials.js";
import type { Phase1TerrainConfig } from "./phase1_config.js";
import { buildFlowAccumulation } from "./erosion.js";

export interface Phase1Heightfield {
  size: number;
  worldSizeM: number;
  heights: Float32Array;
  slope: Float32Array;
  flow: Float32Array;
  biome: Uint8Array;
  materialWeights: Float32Array;
  minHeight: number;
  maxHeight: number;
  signature: number;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function hash01(ix: number, iz: number, seed: number): number {
  return mix32(hashCombine(hashCombine(ix >>> 0, iz >>> 0), seed)) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash01(ix, iz, seed);
  const b = hash01(ix + 1, iz, seed);
  const c = hash01(ix, iz + 1, seed);
  const d = hash01(ix + 1, iz + 1, seed);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return ab + (cd - ab) * fz;
}

function fbm(x: number, z: number, seed: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, z * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

function classifyBiome(height: number, slope: number, flow: number, config: Phase1TerrainConfig): number {
  if (height <= config.world.seaLevelM + 3 || flow > 0.72) return 0;
  if (height > config.material.heightBands[3]?.minM && slope < config.material.snowSlopeFade) return 3;
  if (slope > config.material.slopeRockStart || height > config.material.heightBands[2]?.minM) return 2;
  if (height > config.material.heightBands[1]?.minM) return 1;
  return 0;
}

export function generatePhase1Heightfield(
  seedValue: number,
  config: Phase1TerrainConfig,
  gridSize: number,
  coastConfig: BorderCoastOceanConfig = defaultBorderCoastOceanConfig,
): Phase1Heightfield {
  const size = Math.max(2, Math.floor(gridSize));
  const seed = new WorldSeed(seedValue >>> 0);
  const macroSeed = seed.sub("phase1.macro");
  const ridgeSeed = seed.sub("phase1.ridges");
  const karstSeed = seed.sub("phase1.karst");
  const baseHeights = new Float32Array(size * size);
  const heights = new Float32Array(size * size);
  const slope = new Float32Array(size * size);
  const biome = new Uint8Array(size * size);
  const materialWeights = new Float32Array(size * size * 4);
  const worldSizeM = config.world.sizeM;
  const cellM = worldSizeM / (size - 1);
  const coastBounds = coastConfig.world.bounds;
  const coastWidthM = coastBounds.max_x - coastBounds.min_x;
  const coastDepthM = coastBounds.max_z - coastBounds.min_z;
  const valleyAngle = config.macro.valleyAxisAngleDeg * Math.PI / 180;
  const valleyX = Math.cos(valleyAngle);
  const valleyZ = Math.sin(valleyAngle);
  let minHeight = Infinity;
  let maxHeight = -Infinity;

  for (let z = 0; z < size; z++) {
    const nz = z / (size - 1);
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1);
      const dx = nx - config.macro.massifCenter[0];
      const dz = nz - config.macro.massifCenter[1];
      const massif = Math.max(0, 1 - Math.hypot(dx * 1.15, dz * 1.05));
      const valleyDist = Math.abs((nx - 0.5) * valleyZ - (nz - 0.5) * valleyX);
      const valley = Math.max(0, 1 - valleyDist * 5.8);
      const ridgeNoise = Math.abs(fbm(nx * 7.0, nz * 7.0, ridgeSeed, 4) * 2 - 1);
      const karst = Math.pow(1 - Math.abs(fbm(nx * 18, nz * 18, karstSeed, 3) * 2 - 1), 3);
      const lowFreq = fbm(nx * 3.2, nz * 3.2, macroSeed, 4);
      const lakeBasin = Math.max(0, 1 - Math.hypot(nx - 0.32, nz - 0.68) * 4.5);
      let h01 =
        0.08 +
        massif * 0.86 +
        (ridgeNoise - 0.38) * config.macro.ridgeWeight * 0.34 +
        (lowFreq - 0.5) * 0.25 -
        valley * 0.22 -
        karst * config.macro.karstWeight * 0.18 -
        lakeBasin * config.macro.lakeWeight;
      h01 = Math.max(0, Math.min(1, h01));
      const baseHeight = h01 * config.world.heightScaleM;
      const coastX = coastBounds.min_x + nx * coastWidthM;
      const coastZ = coastBounds.min_z + nz * coastDepthM;
      const coastSample = shapeCoastTerrain(
        { x: coastX, z: coastZ },
        baseHeight,
        coastConfig,
        seedValue,
      );
      const h = coastSample.height;
      const i = z * size + x;
      baseHeights[i] = baseHeight;
      heights[i] = h;
      minHeight = Math.min(minHeight, h);
      maxHeight = Math.max(maxHeight, h);
    }
  }

  for (let z = 0; z < size; z++) {
    const z0 = Math.max(0, z - 1);
    const z1 = Math.min(size - 1, z + 1);
    for (let x = 0; x < size; x++) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(size - 1, x + 1);
      const dx = (heights[z * size + x1] - heights[z * size + x0]) / Math.max(cellM, (x1 - x0) * cellM);
      const dz = (heights[z1 * size + x] - heights[z0 * size + x]) / Math.max(cellM, (z1 - z0) * cellM);
      slope[z * size + x] = Math.min(1, Math.hypot(dx, dz));
    }
  }

  const flow = config.erosion.enabled ? buildFlowAccumulation(heights, size) : new Float32Array(size * size);
  let signature = hashCombine(seed.seed, hashString(`phase1:${size}`));
  const stride = Math.max(1, Math.floor((size * size) / 16384));
  for (let i = 0; i < heights.length; i++) {
    const inlandBiome = classifyBiome(heights[i], slope[i], flow[i], config);
    const x = i % size;
    const z = Math.floor(i / size);
    const nx = x / (size - 1);
    const nz = z / (size - 1);
    const coastSample = shapeCoastTerrain(
      {
        x: coastBounds.min_x + nx * coastWidthM,
        z: coastBounds.min_z + nz * coastDepthM,
      },
      baseHeights[i],
      coastConfig,
      seedValue,
    );
    const inlandWeights = [0, 0, 0, 0];
    inlandWeights[inlandBiome] = 1;
    const coastalWeights = buildCoastMaterialWeights({
      coast: coastSample,
      materials: coastConfig.materials,
      palette: { materialIds: config.material.heightBands.map((band) => band.id) },
      inlandWeights,
    });
    const weightOffset = i * 4;
    for (let slot = 0; slot < 4; slot += 1) {
      materialWeights[weightOffset + slot] = coastalWeights.weights[slot] ?? 0;
    }
    biome[i] = coastalWeights.dominantSlot;
    if (i % stride === 0) {
      signature = hashCombine(signature, Math.round(heights[i] * 100) >>> 0);
      signature = hashCombine(signature, Math.round(slope[i] * 10000) >>> 0);
      signature = hashCombine(signature, biome[i]);
      for (let slot = 0; slot < 4; slot += 1) {
        signature = hashCombine(
          signature,
          Math.round(materialWeights[i * 4 + slot] * 10000) >>> 0,
        );
      }
    }
  }

  return {
    size,
    worldSizeM,
    heights,
    slope,
    flow,
    biome,
    materialWeights,
    minHeight,
    maxHeight,
    signature: signature >>> 0,
  };
}
