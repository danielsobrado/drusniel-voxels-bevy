import * as THREE from "three";
import { clamp, dot, float, max, mix, normalGeometry, normalize, positionWorld, pow, smoothstep, uniform, vec2, vec3 } from "three/tsl";
import { vertexColor } from "three/tsl";
import { MeshBasicNodeMaterial } from "three/webgpu";
import type { FarTerrainUniformData } from "./farTerrainUniforms.js";
import type { FarShellLighting } from "../gpu/far_terrain_shell.js";
import { classifyTerrainMaterial, materialColorForDebugId } from "../terrainMaterial/terrainMaterialBands.js";

export interface FarTerrainVertexColors {
  baseColor: Float32Array;
  debugBand: Float32Array;
  macro: Float32Array;
  slope: Float32Array;
  materialWeights: Float32Array;
}

export function createFarTerrainMaterial(
  lighting: FarShellLighting,
  config: FarTerrainUniformData,
  centerX: number,
  centerZ: number,
  _farRadius: number,
): MeshBasicNodeMaterial {
  const uSunDir = uniform(lighting.sunDirection.clone());
  const uSunColor = uniform(vec3(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b));
  const uSkyColor = uniform(vec3(lighting.skyLight.r, lighting.skyLight.g, lighting.skyLight.b));
  const uGroundColor = uniform(vec3(lighting.groundLight.r, lighting.groundLight.g, lighting.groundLight.b));
  const uHazeColor = uniform(new THREE.Vector3(config.hazeColor[0], config.hazeColor[1], config.hazeColor[2]));

  const uHazeStart = uniform(config.hazeStartM);
  const uHazeEnd = uniform(config.hazeEndM);
  const uHazeStrength = uniform(config.hazeStrength);

  const nrm = normalize(normalGeometry);
  const sun = max(dot(nrm, uSunDir), float(0));
  const sky = clamp(nrm.y.mul(0.5).add(0.5), float(0), float(1));
  const hemi = mix(uGroundColor, uSkyColor, sky);
  const light = hemi.add(uSunColor.mul(pow(sun, float(1.35))));

  const dp = vec2(positionWorld.x.sub(centerX), positionWorld.z.sub(centerZ));
  const distXZ = dp.length();
  const hazeT = smoothstep(uHazeStart, uHazeEnd, distXZ);
  const hazeFactor = hazeT.mul(uHazeStrength);

  const vColor = vertexColor();
  const colorNode = vColor as unknown as { mul: (x: unknown) => unknown };
  const lit = (colorNode.mul(light) as unknown as ReturnType<typeof vec3>);
  const final = mix(lit, uHazeColor, hazeFactor);

  const material = new MeshBasicNodeMaterial();
  material.colorNode = final;
  material.side = THREE.DoubleSide;

  return material;
}

export function computeFarTerrainVertexColors(
  _sampleHeight: (x: number, z: number) => number,
  positions: Float32Array,
  normals: Float32Array,
  vertexCount: number,
  config: FarTerrainUniformData,
  _worldSize: number,
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
