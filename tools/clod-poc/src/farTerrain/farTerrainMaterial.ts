import * as THREE from "three";
import { clamp, dot, float, max, mix, normalize, positionWorld, pow, smoothstep, uniform, vec2, vec3 } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { FarTerrainUniformData } from "./farTerrainUniforms.js";
import type { FarShellLighting } from "../gpu/far_terrain_shell.js";
import { classifyTerrainMaterial, materialColorForDebugId } from "../terrainMaterial/terrainMaterialBands.js";

type TslNode = any;

export interface FarTerrainVertexColors {
  baseColor: Float32Array;
  debugBand: Float32Array;
  macro: Float32Array;
  slope: Float32Array;
  materialWeights: Float32Array;
}

function v3c(c: THREE.Color): TslNode {
  return vec3(c.r, c.g, c.b);
}

export function createFarTerrainMaterial(
  lighting: FarShellLighting,
  config: FarTerrainUniformData,
  centerX: number,
  centerZ: number,
  _farRadius: number,
): MeshBasicNodeMaterial {
  const uSunDir = uniform(lighting.sunDirection.clone());
  const uSunColor = uniform(v3c(lighting.sunColor));
  const uSkyColor = uniform(v3c(lighting.skyLight));
  const uGroundColor = uniform(v3c(lighting.groundLight));
  const uHazeColor = uniform(new THREE.Vector3(config.hazeColor[0], config.hazeColor[1], config.hazeColor[2]));

  const uHazeStart = uniform(config.hazeStartM);
  const uHazeEnd = uniform(config.hazeEndM);
  const uHazeStrength = uniform(config.hazeStrength);
  const uHazeHeightFalloff = uniform(config.hazeHeightFalloff);
  const uShowMaterialBands = uniform(config.debugShowMaterialBands);
  const uShowSlope = uniform(config.debugShowSlope);
  const uShowMacroNoise = uniform(config.debugShowMacroNoise);
  const uShowFarNormals = uniform(config.debugShowFarNormals);
  const uShowHazeFactor = uniform(config.debugShowHazeFactor);

  const nrm = normalize(positionWorld);
  const sun = max(dot(nrm, uSunDir), float(0));
  const sky = clamp(nrm.y.mul(0.5).add(0.5), float(0), float(1));
  const hemi = mix(uGroundColor, uSkyColor, sky);
  const light = hemi.add(uSunColor.mul(pow(sun, float(1.35))));

  const dp = vec2(positionWorld.x.sub(centerX), positionWorld.z.sub(centerZ));
  const distXZ = dp.length();
  const hazeT = smoothstep(uHazeStart, uHazeEnd, distXZ);
  const hazeHeightFade = float(1).sub(hazeT.mul(0.5));
  const hazeFactor = hazeT.mul(hazeHeightFade).mul(uHazeStrength);

  const colorNode = vec3(0.5, 0.5, 0.5);
  const lit = colorNode.mul(light);
  const final = mix(lit, uHazeColor, hazeFactor);

  const material = new MeshBasicNodeMaterial();
  material.colorNode = final;
  material.side = THREE.DoubleSide;
  material.vertexColors = true;

  (material as unknown as Record<string, unknown>).__far_terrain_uniforms = {
    uSunDir,
    uSunColor,
    uSkyColor,
    uGroundColor,
    uHazeColor,
    uHazeStart,
    uHazeEnd,
    uHazeStrength,
    uHazeHeightFalloff,
    uShowMaterialBands,
    uShowSlope,
    uShowMacroNoise,
    uShowFarNormals,
    uShowHazeFactor,
  };

  return material;
}

export function computeFarTerrainVertexColors(
  _sampleHeight: (x: number, z: number) => number,
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number,
  config: FarTerrainUniformData,
  _worldSize: number,
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
    const x = positions[vi * 3];
    const z = positions[vi * 3 + 2];
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

  return { baseColor, debugBand, macro, slope, materialWeights };
}

export function createVertexColorBuffer(
  vertexColors: FarTerrainVertexColors,
  config: FarTerrainUniformData,
): Float32Array {
  const count = vertexColors.baseColor.length / 3;
  const colors = new Float32Array(count * 3);
  for (let vi = 0; vi < count; vi++) {
    if (config.debugShowMaterialBands > 0) {
      colors[vi * 3] = vertexColors.debugBand[vi * 3];
      colors[vi * 3 + 1] = vertexColors.debugBand[vi * 3 + 1];
      colors[vi * 3 + 2] = vertexColors.debugBand[vi * 3 + 2];
    } else if (config.debugShowSlope > 0) {
      colors[vi * 3] = vertexColors.slope[vi];
      colors[vi * 3 + 1] = 0;
      colors[vi * 3 + 2] = 0;
    } else if (config.debugShowMacroNoise > 0) {
      colors[vi * 3] = vertexColors.macro[vi];
      colors[vi * 3 + 1] = 0;
      colors[vi * 3 + 2] = 0;
    } else if (config.debugShowFarNormals > 0) {
      colors[vi * 3] = 0.5;
      colors[vi * 3 + 1] = 0.5;
      colors[vi * 3 + 2] = 0.5;
    } else if (config.debugShowHazeFactor > 0) {
      colors[vi * 3] = 0;
      colors[vi * 3 + 1] = 0;
      colors[vi * 3 + 2] = 0;
    } else {
      colors[vi * 3] = vertexColors.baseColor[vi * 3];
      colors[vi * 3 + 1] = vertexColors.baseColor[vi * 3 + 1];
      colors[vi * 3 + 2] = vertexColors.baseColor[vi * 3 + 2];
    }
  }
  return colors;
}

export function updateFarTerrainMaterial(
  material: MeshBasicNodeMaterial,
  config: Partial<FarTerrainUniformData>,
): void {
  const uniforms = (material as unknown as Record<string, unknown>).__far_terrain_uniforms as Record<string, { value: unknown }> | undefined;
  if (!uniforms) return;

  const floatMap: Record<string, keyof FarTerrainUniformData> = {
    uHazeStart: "hazeStartM",
    uHazeEnd: "hazeEndM",
    uHazeStrength: "hazeStrength",
    uHazeHeightFalloff: "hazeHeightFalloff",
  };

  for (const [uni, key] of Object.entries(floatMap)) {
    const val = config[key as keyof FarTerrainUniformData];
    if (val !== undefined && typeof val === "number" && uniforms[uni]) {
      uniforms[uni].value = val;
    }
  }

  const flagMap: Record<string, keyof FarTerrainUniformData> = {
    uShowMaterialBands: "debugShowMaterialBands",
    uShowSlope: "debugShowSlope",
    uShowMacroNoise: "debugShowMacroNoise",
    uShowFarNormals: "debugShowFarNormals",
    uShowHazeFactor: "debugShowHazeFactor",
  };

  for (const [uni, key] of Object.entries(flagMap)) {
    const val = config[key as keyof FarTerrainUniformData];
    if (val !== undefined && typeof val === "number" && uniforms[uni]) {
      uniforms[uni].value = val;
    }
  }

  if (config.hazeColor && uniforms.uHazeColor) {
    uniforms.uHazeColor.value = new THREE.Vector3(config.hazeColor[0], config.hazeColor[1], config.hazeColor[2]);
  }
}
