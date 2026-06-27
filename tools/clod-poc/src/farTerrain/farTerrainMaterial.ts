import * as THREE from "three";
import { clamp, cos, dot, float, max, mix, normalGeometry, normalize, positionGeometry, positionWorld, pow, sin, smoothstep, step, texture, uniform, vec2, vec3, vertexColor } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { FarTerrainUniformData } from "./farTerrainUniforms.js";

import type { FarShellLighting } from "../gpu/far_terrain_shell.js";
import type { FarSummaryGpuAtlasRingView, FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";
import { classifyTerrainMaterial, materialColorForDebugId } from "../terrainMaterial/terrainMaterialBands.js";

const SUMMARY_EDGE_EPS = 0.0001;
const SUMMARY_HEIGHT_RANGE_SHADE_M = 36.0;
const SUMMARY_HEIGHT_RANGE_SHADE_STRENGTH = 0.28;

export interface FarTerrainVertexColors {
  baseColor: Float32Array;
  debugBand: Float32Array;
  macro: Float32Array;
  slope: Float32Array;
  materialWeights: Float32Array;
  normals?: Float32Array;
}

export interface FarTerrainSummaryRingUniformRefs {
  uOriginX: ReturnType<typeof uniform>;
  uOriginZ: ReturnType<typeof uniform>;
  uCellM: ReturnType<typeof uniform>;
  uStartM: ReturnType<typeof uniform>;
  uEndM: ReturnType<typeof uniform>;
  uRowOffsetCells: ReturnType<typeof uniform>;
  uWidthCells: ReturnType<typeof uniform>;
  uHeightCells: ReturnType<typeof uniform>;
  uValid: ReturnType<typeof uniform>;
}

export interface FarTerrainUniformRefs {
  uCenterX: ReturnType<typeof uniform>;
  uCenterZ: ReturnType<typeof uniform>;
  uHazeStart: ReturnType<typeof uniform>;
  uHazeEnd: ReturnType<typeof uniform>;
  uHazeStrength: ReturnType<typeof uniform>;
  uHazeEnabled: ReturnType<typeof uniform>;
  uHazeColor: ReturnType<typeof uniform>;
  uHemiStrength: ReturnType<typeof uniform>;
  uSunStrength: ReturnType<typeof uniform>;
  uAmbientFloor: ReturnType<typeof uniform>;
  uSunDir: ReturnType<typeof uniform>;
  uSunColor: ReturnType<typeof uniform>;
  uSkyColor: ReturnType<typeof uniform>;
  uGroundColor: ReturnType<typeof uniform>;
  uSummaryWidthCells?: ReturnType<typeof uniform>;
  uSummaryHeightCells?: ReturnType<typeof uniform>;
  uSummaryValid?: ReturnType<typeof uniform>;
  uSummaryRings?: FarTerrainSummaryRingUniformRefs[];
}

export interface FarTerrainMaterialOptions {
  gpuDisplacement?: boolean;
  heightBiasMeters?: number;
  summaryAtlas?: FarSummaryGpuAtlasView;
}

export function createFarTerrainMaterial(
  lighting: FarShellLighting,
  config: FarTerrainUniformData,
  centerX: number,
  centerZ: number,
  _farRadius: number,
  options: FarTerrainMaterialOptions = {},
): MeshBasicNodeMaterial {
  const uSunDir = uniform(lighting.sunDirection.clone());
  const uSunColor = uniform(vec3(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b));
  const uSkyColor = uniform(vec3(lighting.skyLight.r, lighting.skyLight.g, lighting.skyLight.b));
  const uGroundColor = uniform(vec3(lighting.groundLight.r, lighting.groundLight.g, lighting.groundLight.b));

  const uCenterX = uniform(centerX);
  const uCenterZ = uniform(centerZ);
  const uHazeStart = uniform(config.hazeStartM);
  const uHazeEnd = uniform(config.hazeEndM);
  const uHazeStrength = uniform(config.hazeStrength);
  const uHazeEnabled = uniform(config.hazeEnabled);
  const uHazeColor = uniform(new THREE.Vector3(config.hazeColor[0], config.hazeColor[1], config.hazeColor[2]));
  const uHemiStrength = uniform(config.hemiStrength);
  const uSunStrength = uniform(config.sunStrength);
  const uAmbientFloor = uniform(config.ambientFloor);

  const dp = vec2(positionWorld.x.sub(uCenterX), positionWorld.z.sub(uCenterZ));
  const distXZ = dp.length();
  const hazeT = smoothstep(uHazeStart, uHazeEnd, distXZ);
  const hazeFactor = hazeT.mul(uHazeStrength).mul(uHazeEnabled);

  let surfaceNormal = normalize(normalGeometry) as unknown as ReturnType<typeof vec3>;
  let surfaceColor = vertexColor() as unknown as ReturnType<typeof vec3>;
  let uSummaryWidthCells: ReturnType<typeof uniform> | undefined;
  let uSummaryHeightCells: ReturnType<typeof uniform> | undefined;
  let uSummaryValid: ReturnType<typeof uniform> | undefined;
  let uSummaryRings: FarTerrainSummaryRingUniformRefs[] | undefined;

  const material = new MeshBasicNodeMaterial();
  material.vertexColors = true;
  material.side = THREE.DoubleSide;

  if (options.gpuDisplacement) {
    const local = positionGeometry;
    const worldX = local.x.add(uCenterX);
    const worldZ = local.z.add(uCenterZ);
    const continent = sin(worldX.mul(0.0017).add(worldZ.mul(0.0011))).mul(18.0);
    const hills = sin(worldX.mul(0.009).add(worldZ.mul(0.006))).mul(7.0)
      .add(cos(worldX.mul(0.013).sub(worldZ.mul(0.011))).mul(5.0));
    const detail = sin(worldX.mul(0.041).add(worldZ.mul(0.033))).mul(1.4);
    let terrainHeight = float(46.0).add(continent).add(hills).add(detail);
    const summaryAtlas = options.summaryAtlas;

    if (summaryAtlas) {
      uSummaryWidthCells = uniform(summaryAtlas.widthCells);
      uSummaryHeightCells = uniform(summaryAtlas.heightCells);
      uSummaryValid = uniform(summaryAtlas.valid);
      uSummaryRings = summaryAtlas.rings.map((ring) => createRingUniformRefs(ring));

      for (const ringRefs of uSummaryRings) {
        const atlasUCells = worldX.sub(ringRefs.uOriginX).div(ringRefs.uCellM);
        const atlasVCells = worldZ.sub(ringRefs.uOriginZ).div(ringRefs.uCellM);
        const atlasUCell = clamp(atlasUCells, float(0.0), ringRefs.uWidthCells.sub(float(1.0)));
        const atlasVCell = clamp(atlasVCells, float(0.0), ringRefs.uHeightCells.sub(float(1.0)));
        const atlasU = atlasUCell.add(float(0.5)).div(ringRefs.uWidthCells);
        const atlasV = ringRefs.uRowOffsetCells.add(atlasVCell).add(float(0.5)).div(uSummaryHeightCells);
        const atlasUv = vec2(atlasU, atlasV);
        const heightSample = texture(summaryAtlas.texture, atlasUv);
        const materialSample = texture(summaryAtlas.materialTexture, atlasUv);
        const normalSample = texture(summaryAtlas.normalTexture, atlasUv);
        const inside = step(float(0.0), atlasUCells)
          .mul(step(atlasUCells, ringRefs.uWidthCells.sub(float(SUMMARY_EDGE_EPS))))
          .mul(step(float(0.0), atlasVCells))
          .mul(step(atlasVCells, ringRefs.uHeightCells.sub(float(SUMMARY_EDGE_EPS))));
        const inDistanceBand = step(ringRefs.uStartM, distXZ).mul(step(distXZ, ringRefs.uEndM.sub(float(SUMMARY_EDGE_EPS))));
        const atlasWeight = heightSample.a.mul(inside).mul(inDistanceBand).mul(ringRefs.uValid).mul(uSummaryValid);
        const heightRange = clamp(heightSample.b.sub(heightSample.g).div(float(SUMMARY_HEIGHT_RANGE_SHADE_M)), float(0.0), float(1.0));
        const rangeShade = float(1.0).sub(heightRange.mul(float(SUMMARY_HEIGHT_RANGE_SHADE_STRENGTH)).mul(atlasWeight));
        const atlasSurfaceColor = materialSample.rgb.mul(rangeShade);
        const atlasNormal = normalize(normalSample.rgb.mul(float(2.0)).sub(vec3(1.0, 1.0, 1.0)));
        terrainHeight = mix(terrainHeight, heightSample.r, atlasWeight);
        surfaceColor = mix(surfaceColor, atlasSurfaceColor, atlasWeight) as unknown as ReturnType<typeof vec3>;
        surfaceNormal = normalize(mix(surfaceNormal, atlasNormal, atlasWeight)) as unknown as ReturnType<typeof vec3>;
      }
    }

    terrainHeight = terrainHeight.add(float(options.heightBiasMeters ?? 0));
    material.positionNode = vec3(local.x, terrainHeight, local.z);
  }

  const sun = max(dot(surfaceNormal, uSunDir), float(0));
  const sky = clamp(surfaceNormal.y.mul(0.5).add(0.5), float(0), float(1));
  const hemi = mix(uGroundColor, uSkyColor, sky).mul(uHemiStrength);
  const ambientFloor = vec3(uAmbientFloor, uAmbientFloor, uAmbientFloor);
  const light = ambientFloor.add(hemi).add(uSunColor.mul(pow(sun, float(1.35))).mul(uSunStrength));
  const colorNode = surfaceColor as unknown as { mul: (x: unknown) => unknown };
  const lit = (colorNode.mul(light) as unknown as ReturnType<typeof vec3>);
  material.colorNode = mix(lit, uHazeColor, hazeFactor);

  const refs: FarTerrainUniformRefs = {
    uCenterX, uCenterZ,
    uHazeStart, uHazeEnd, uHazeStrength, uHazeEnabled, uHazeColor,
    uHemiStrength, uSunStrength, uAmbientFloor,
    uSunDir, uSunColor, uSkyColor, uGroundColor,
    uSummaryWidthCells, uSummaryHeightCells, uSummaryValid, uSummaryRings,
  };
  material.userData.farTerrainUniforms = refs;

  return material;
}

function createRingUniformRefs(ring: FarSummaryGpuAtlasRingView): FarTerrainSummaryRingUniformRefs {
  return {
    uOriginX: uniform(ring.originX),
    uOriginZ: uniform(ring.originZ),
    uCellM: uniform(ring.cellM),
    uStartM: uniform(ring.startM),
    uEndM: uniform(ring.endM),
    uRowOffsetCells: uniform(ring.rowOffsetCells),
    uWidthCells: uniform(ring.widthCells),
    uHeightCells: uniform(ring.heightCells),
    uValid: uniform(ring.valid),
  };
}

export function computeFarTerrainVertexColors(
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number,
  config: FarTerrainUniformData,
  worldOffsetX?: number,
  worldOffsetZ?: number,
): FarTerrainVertexColors {
  const baseColor = new Float32Array(vertexCount * 3);
  const debugBand = new Float32Array(vertexCount * 3);
  const macro = new Float32Array(vertexCount * 1);
  const slope = new Float32Array(vertexCount * 1);
  const materialWeights = new Float32Array(vertexCount * 5);

  const matConfig = {
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

  for (let vi = 0; vi < vertexCount; vi++) {
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
      config: matConfig,
    });

    const bandColor = materialColorForDebugId(matResult.debugMaterialId);

    baseColor[vi * 3] = matResult.baseColor[0];
    baseColor[vi * 3 + 1] = matResult.baseColor[1];
    baseColor[vi * 3 + 2] = matResult.baseColor[2];

    debugBand[vi * 3] = bandColor[0];
    debugBand[vi * 3 + 1] = bandColor[1];
    debugBand[vi * 3 + 2] = bandColor[2];

    macro[vi] = matResult.macroVariation;
    slope[vi] = vertSlope;

    materialWeights[vi * 5] = matResult.weights.sand;
    materialWeights[vi * 5 + 1] = matResult.weights.grass;
    materialWeights[vi * 5 + 2] = matResult.weights.dirt;
    materialWeights[vi * 5 + 3] = matResult.weights.rock;
    materialWeights[vi * 5 + 4] = matResult.weights.snow;
  }

  return { baseColor, debugBand, macro, slope, materialWeights, normals };
}

function cpuSmoothstep(edge0: number, edge1: number, v: number): number {
  const range = edge1 - edge0;
  const denom = Math.abs(range) < 1e-8 ? 1e-8 : range;
  const t = Math.min(1, Math.max(0, (v - edge0) / denom));
  return t * t * (3 - 2 * t);
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
  const isFullDebug = config.materialQuality === "full_debug" || config.materialQualityIndex <= 0;
  const isSlopeTint = config.materialQuality === "slope_tint_debug" || config.materialQualityIndex === 1;
  const isSingleProj = config.materialQuality === "single_projection_far" || config.materialQualityIndex === 2;
  const isAtlasDebug = config.materialQuality === "atlas_only_debug" || config.materialQualityIndex >= 4;
  const cx = centerX ?? 0;
  const cz = centerZ ?? 0;
  const colors = new Float32Array(count * 3);
  for (let vi = 0; vi < count; vi++) {
    if (config.debugShowMaterialBands > 0 || isFullDebug || isAtlasDebug) {
      colors[vi * 3] = vertexColors.debugBand[vi * 3];
      colors[vi * 3 + 1] = vertexColors.debugBand[vi * 3 + 1];
      colors[vi * 3 + 2] = vertexColors.debugBand[vi * 3 + 2];
    } else if (config.debugShowSlope > 0 || isSlopeTint) {
      const s = vertexColors.slope[vi];
      colors[vi * 3] = 0.3 + s * 0.3;
      colors[vi * 3 + 1] = 0.4 - s * 0.2;
      colors[vi * 3 + 2] = 0.2 + s * 0.1;
    } else if (config.debugShowMacroNoise > 0) {
      const m = vertexColors.macro[vi];
      colors[vi * 3] = m;
      colors[vi * 3 + 1] = 0;
      colors[vi * 3 + 2] = 0;
    } else if (config.debugShowFarNormals > 0) {
      if (normals) {
        const nx = normals[vi * 3];
        const ny = normals[vi * 3 + 1];
        const nz = normals[vi * 3 + 2];
        colors[vi * 3] = 0.5 + 0.5 * nx;
        colors[vi * 3 + 1] = 0.5 + 0.5 * ny;
        colors[vi * 3 + 2] = 0.5 + 0.5 * nz;
      } else {
        colors[vi * 3] = 0.5;
        colors[vi * 3 + 1] = 0.5;
        colors[vi * 3 + 2] = 0.75;
      }
    } else if (config.debugShowHazeFactor > 0 && vertexPositions) {
      const x = vertexPositions[vi * 3];
      const z = vertexPositions[vi * 3 + 2];
      const dist = Math.hypot(x - cx, z - cz);
      const raw = cpuSmoothstep(config.hazeStartM, config.hazeEndM, dist);
      const haze = raw * config.hazeStrength * config.hazeEnabled;
      colors[vi * 3] = Math.min(1, Math.max(0, haze * 0.1));
      colors[vi * 3 + 1] = Math.min(1, Math.max(0, haze * 0.55));
      colors[vi * 3 + 2] = Math.min(1, Math.max(0, 0.05 + haze * 0.95));
    } else if (isSingleProj) {
      colors[vi * 3] = vertexColors.baseColor[vi * 3];
      colors[vi * 3 + 1] = vertexColors.baseColor[vi * 3 + 1];
      colors[vi * 3 + 2] = vertexColors.baseColor[vi * 3 + 2];
    } else {
      let r = vertexColors.baseColor[vi * 3];
      let g = vertexColors.baseColor[vi * 3 + 1];
      let b = vertexColors.baseColor[vi * 3 + 2];
      const m = vertexColors.macro[vi];
      r *= 1 + (m - 0.5) * 0.18;
      g *= 1 + (m - 0.5) * 0.18;
      b *= 1 + (m - 0.5) * 0.18;
      colors[vi * 3] = Math.min(1, Math.max(0, r));
      colors[vi * 3 + 1] = Math.min(1, Math.max(0, g));
      colors[vi * 3 + 2] = Math.min(1, Math.max(0, b));
    }
  }

  return colors;
}

export function createFarSummaryAtlasPreviewTexture(view: FarSummaryGpuAtlasView): THREE.DataTexture {
  return view.texture;
}

export function updateFarTerrainMaterial(
  material: MeshBasicNodeMaterial,
  config: Partial<FarTerrainUniformData>,
): void {
  const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs | undefined;
  if (!refs) return;

  if (config.hazeStartM !== undefined) refs.uHazeStart.value = config.hazeStartM;
  if (config.hazeEndM !== undefined) refs.uHazeEnd.value = config.hazeEndM;
  if (config.hazeStrength !== undefined) refs.uHazeStrength.value = config.hazeStrength;
  if (config.hazeEnabled !== undefined) refs.uHazeEnabled.value = config.hazeEnabled;
  if (config.hazeColor) {
    refs.uHazeColor.value = new THREE.Vector3(config.hazeColor[0], config.hazeColor[1], config.hazeColor[2]);
  }
  if (config.hemiStrength !== undefined) refs.uHemiStrength.value = config.hemiStrength;
  if (config.sunStrength !== undefined) refs.uSunStrength.value = config.sunStrength;
  if (config.ambientFloor !== undefined) refs.uAmbientFloor.value = config.ambientFloor;
}

export function updateFarTerrainMaterialCenter(
  material: MeshBasicNodeMaterial,
  centerX: number,
  centerZ: number,
): void {
  const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs | undefined;
  if (!refs) return;
  refs.uCenterX.value = centerX;
  refs.uCenterZ.value = centerZ;
}

export function updateFarTerrainMaterialSummaryAtlas(
  material: MeshBasicNodeMaterial,
  view: FarSummaryGpuAtlasView,
): void {
  const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs | undefined;
  if (!refs) return;
  if (refs.uSummaryWidthCells) refs.uSummaryWidthCells.value = view.widthCells;
  if (refs.uSummaryHeightCells) refs.uSummaryHeightCells.value = view.heightCells;
  if (refs.uSummaryValid) refs.uSummaryValid.value = view.valid;
  if (!refs.uSummaryRings) return;

  for (let i = 0; i < refs.uSummaryRings.length; i++) {
    const ring = view.rings[i];
    const ringRefs = refs.uSummaryRings[i];
    if (!ring || !ringRefs) continue;
    ringRefs.uOriginX.value = ring.originX;
    ringRefs.uOriginZ.value = ring.originZ;
    ringRefs.uCellM.value = ring.cellM;
    ringRefs.uStartM.value = ring.startM;
    ringRefs.uEndM.value = ring.endM;
    ringRefs.uRowOffsetCells.value = ring.rowOffsetCells;
    ringRefs.uWidthCells.value = ring.widthCells;
    ringRefs.uHeightCells.value = ring.heightCells;
    ringRefs.uValid.value = ring.valid;
  }
}
