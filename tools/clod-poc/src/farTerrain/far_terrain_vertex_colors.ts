import type { FarTerrainVertexColors } from "./far_terrain_material_types.js";
import type { FarTerrainUniformData } from "./farTerrainUniforms.js";
import { classifyTerrainMaterial, materialColorForDebugId } from "../terrainMaterial/terrainMaterialBands.js";
import { sampleActiveErosionMaterialChannels } from "../world/erosion/integration.js";

function cpuSmoothstep(edge0: number, edge1: number, v: number): number {
  const range = edge1 - edge0;
  const denom = Math.abs(range) < 1e-8 ? 1e-8 : range;
  const t = Math.min(1, Math.max(0, (v - edge0) / denom));
  return t * t * (3 - 2 * t);
}

function materialConfig(config: FarTerrainUniformData) {
  return {
    waterline_m: config.waterlineM,
    sand_max_height_m: config.sandMaxHeightM,
    grass_max_slope: config.grassMaxSlope,
    dirt_max_slope: config.dirtMaxSlope,
    rock_min_slope: config.rockMinSlope,
    snow_min_height_m: config.snowMinHeightM,
    snow_min_slope: config.snowMinSlope,
    macro_variation: {
      enabled: config.macroEnabled > 0,
      world_scale_1: config.macroScale1,
      world_scale_2: config.macroScale2,
      strength: config.macroStrength,
      slope_strength: config.macroSlopeStrength,
      height_strength: config.macroHeightStrength,
    },
  };
}

export function createFarTerrainVertexColorScratch(vertexCount: number, normals: Float32Array): FarTerrainVertexColors {
  return {
    baseColor: new Float32Array(vertexCount * 3),
    debugBand: new Float32Array(vertexCount * 3),
    macro: new Float32Array(vertexCount),
    slope: new Float32Array(vertexCount),
    materialWeights: new Float32Array(vertexCount * 5),
    normals,
  };
}

export function computeFarTerrainVertexColorsRange(
  target: FarTerrainVertexColors,
  positions: Float32Array,
  normals: Float32Array,
  startVi: number,
  endVi: number,
  config: FarTerrainUniformData,
  worldOffsetX?: number,
  worldOffsetZ?: number,
): void {
  const matConfig = materialConfig(config);
  for (let vi = startVi; vi < endVi; vi++) {
    const x = positions[vi * 3] + (worldOffsetX ?? 0);
    const z = positions[vi * 3 + 2] + (worldOffsetZ ?? 0);
    const y = positions[vi * 3 + 1];
    const nx = normals[vi * 3];
    const ny = normals[vi * 3 + 1];
    const nz = normals[vi * 3 + 2];
    const vertSlope = Math.min(1, Math.hypot(nx, nz) / Math.max(Math.abs(ny), 0.001));

    const matResult = classifyTerrainMaterial({
      worldX: x,
      worldZ: z,
      height: y,
      slope: vertSlope,
      waterLevel: config.waterlineM,
      erosion: sampleActiveErosionMaterialChannels(x, z),
      config: matConfig,
    });

    const bandColor = materialColorForDebugId(matResult.debugMaterialId);

    target.baseColor[vi * 3] = matResult.baseColor[0];
    target.baseColor[vi * 3 + 1] = matResult.baseColor[1];
    target.baseColor[vi * 3 + 2] = matResult.baseColor[2];

    target.debugBand[vi * 3] = bandColor[0];
    target.debugBand[vi * 3 + 1] = bandColor[1];
    target.debugBand[vi * 3 + 2] = bandColor[2];

    target.macro[vi] = matResult.macroVariation;
    target.slope[vi] = vertSlope;

    target.materialWeights[vi * 5] = matResult.weights.sand;
    target.materialWeights[vi * 5 + 1] = matResult.weights.grass;
    target.materialWeights[vi * 5 + 2] = matResult.weights.dirt;
    target.materialWeights[vi * 5 + 3] = matResult.weights.rock;
    target.materialWeights[vi * 5 + 4] = matResult.weights.snow;
  }
}

export function computeFarTerrainVertexColors(
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number,
  config: FarTerrainUniformData,
  worldOffsetX?: number,
  worldOffsetZ?: number,
): FarTerrainVertexColors {
  const colors = createFarTerrainVertexColorScratch(vertexCount, normals);
  computeFarTerrainVertexColorsRange(colors, positions, normals, 0, vertexCount, config, worldOffsetX, worldOffsetZ);
  return colors;
}

export function createVertexColorBufferRange(
  target: Float32Array,
  vertexColors: FarTerrainVertexColors,
  config: FarTerrainUniformData,
  startVi: number,
  endVi: number,
  normals?: Float32Array,
  centerX?: number,
  centerZ?: number,
  vertexPositions?: Float32Array,
): void {
  const isFullDebug = config.materialQuality === "full_debug" || config.materialQualityIndex <= 0;
  const isSlopeTint = config.materialQuality === "slope_tint_debug" || config.materialQualityIndex === 1;
  const isSingleProj = config.materialQuality === "single_projection_far" || config.materialQualityIndex === 2;
  const isAtlasDebug = config.materialQuality === "atlas_only_debug" || config.materialQualityIndex >= 4;
  const cx = centerX ?? 0;
  const cz = centerZ ?? 0;
  for (let vi = startVi; vi < endVi; vi++) {
    if (config.debugShowMaterialBands > 0 || isFullDebug || isAtlasDebug) {
      target[vi * 3] = vertexColors.debugBand[vi * 3];
      target[vi * 3 + 1] = vertexColors.debugBand[vi * 3 + 1];
      target[vi * 3 + 2] = vertexColors.debugBand[vi * 3 + 2];
    } else if (config.debugShowSlope > 0 || isSlopeTint) {
      const s = vertexColors.slope[vi];
      target[vi * 3] = 0.3 + s * 0.3;
      target[vi * 3 + 1] = 0.4 - s * 0.2;
      target[vi * 3 + 2] = 0.2 + s * 0.1;
    } else if (config.debugShowMacroNoise > 0) {
      const m = vertexColors.macro[vi];
      target[vi * 3] = m;
      target[vi * 3 + 1] = 0;
      target[vi * 3 + 2] = 0;
    } else if (config.debugShowFarNormals > 0) {
      if (normals) {
        const nx = normals[vi * 3];
        const ny = normals[vi * 3 + 1];
        const nz = normals[vi * 3 + 2];
        target[vi * 3] = 0.5 + 0.5 * nx;
        target[vi * 3 + 1] = 0.5 + 0.5 * ny;
        target[vi * 3 + 2] = 0.5 + 0.5 * nz;
      } else {
        target[vi * 3] = 0.5;
        target[vi * 3 + 1] = 0.5;
        target[vi * 3 + 2] = 0.75;
      }
    } else if (config.debugShowHazeFactor > 0 && vertexPositions) {
      const x = vertexPositions[vi * 3];
      const z = vertexPositions[vi * 3 + 2];
      const dist = Math.hypot(x - cx, z - cz);
      const raw = cpuSmoothstep(config.hazeStartM, config.hazeEndM, dist);
      const haze = raw * config.hazeStrength * config.hazeEnabled;
      target[vi * 3] = Math.min(1, Math.max(0, haze * 0.1));
      target[vi * 3 + 1] = Math.min(1, Math.max(0, haze * 0.55));
      target[vi * 3 + 2] = Math.min(1, Math.max(0, 0.05 + haze * 0.95));
    } else if (isSingleProj) {
      target[vi * 3] = vertexColors.baseColor[vi * 3];
      target[vi * 3 + 1] = vertexColors.baseColor[vi * 3 + 1];
      target[vi * 3 + 2] = vertexColors.baseColor[vi * 3 + 2];
    } else {
      let r = vertexColors.baseColor[vi * 3];
      let g = vertexColors.baseColor[vi * 3 + 1];
      let b = vertexColors.baseColor[vi * 3 + 2];
      const m = vertexColors.macro[vi];
      r *= 1 + (m - 0.5) * 0.18;
      g *= 1 + (m - 0.5) * 0.18;
      b *= 1 + (m - 0.5) * 0.18;
      target[vi * 3] = Math.min(1, Math.max(0, r));
      target[vi * 3 + 1] = Math.min(1, Math.max(0, g));
      target[vi * 3 + 2] = Math.min(1, Math.max(0, b));
    }
  }
}

export function createVertexColorBuffer(
  vertexColors: FarTerrainVertexColors,
  config: FarTerrainUniformData,
  normals?: Float32Array,
  centerX?: number,
  centerZ?: number,
  vertexPositions?: Float32Array,
): Float32Array {
  const count = vertexColors.baseColor.length / 3;
  const colors = new Float32Array(count * 3);
  createVertexColorBufferRange(colors, vertexColors, config, 0, count, normals, centerX, centerZ, vertexPositions);
  return colors;
}
