import { isGrassShaderMode } from "../grass/grass_config.js";
import { MAX_TERRAIN_TEXTURES } from "../terrain/terrain_textures.js";
import type { ProjectSessionState } from "./voxel_project_archive_types.js";

const MAX_DISTANCE_M = 1_000_000;
const MAX_GRASS_BLADES = 5_000_000;
const MAX_TREE_INSTANCES = 1_000_000;
const MAX_SEED = Number.MAX_SAFE_INTEGER;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("project.json is missing session state");
  }
  return value as Record<string, unknown>;
}

function bool(raw: Record<string, unknown>, key: keyof ProjectSessionState): boolean {
  const value = raw[key];
  if (typeof value !== "boolean") throw new Error(`project.json state.${key} must be a boolean`);
  return value;
}

function finite(
  raw: Record<string, unknown>,
  key: keyof ProjectSessionState,
  min: number,
  max: number,
): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`project.json state.${key} must be finite in [${min}, ${max}]`);
  }
  return value;
}

function integer(
  raw: Record<string, unknown>,
  key: keyof ProjectSessionState,
  min: number,
  max: number,
): number {
  const value = finite(raw, key, min, max);
  if (!Number.isSafeInteger(value)) throw new Error(`project.json state.${key} must be a safe integer`);
  return value;
}

function enumValue<T extends string>(
  raw: Record<string, unknown>,
  key: keyof ProjectSessionState,
  allowed: readonly T[],
): T {
  const value = raw[key];
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`project.json state.${key} is invalid`);
  }
  return value as T;
}

function optionalBool(raw: Record<string, unknown>, key: keyof ProjectSessionState): boolean | undefined {
  if (raw[key] === undefined) return undefined;
  return bool(raw, key);
}

function optionalFinite(
  raw: Record<string, unknown>,
  key: keyof ProjectSessionState,
  min: number,
  max: number,
): number | undefined {
  if (raw[key] === undefined) return undefined;
  return finite(raw, key, min, max);
}

function optionalInteger(
  raw: Record<string, unknown>,
  key: keyof ProjectSessionState,
  min: number,
  max: number,
): number | undefined {
  if (raw[key] === undefined) return undefined;
  return integer(raw, key, min, max);
}

export function validateProjectSessionState(value: unknown): ProjectSessionState {
  const raw = record(value);
  const grassShaderMode = raw.grassShaderMode;
  if (!isGrassShaderMode(grassShaderMode)) throw new Error("project.json state.grassShaderMode is invalid");

  const grassMinHeight = finite(raw, "grassMinHeight", -MAX_DISTANCE_M, MAX_DISTANCE_M);
  const grassMaxHeight = finite(raw, "grassMaxHeight", -MAX_DISTANCE_M, MAX_DISTANCE_M);
  if (grassMaxHeight < grassMinHeight) throw new Error("project.json grass height range is inverted");

  const result: ProjectSessionState = {
    thresholdPx: finite(raw, "thresholdPx", 0.000001, 10_000),
    enforce21: bool(raw, "enforce21"),
    freeze: bool(raw, "freeze"),
    wireframe: bool(raw, "wireframe"),
    showBounds: bool(raw, "showBounds"),
    showSeamPoints: bool(raw, "showSeamPoints"),
    showCrossLodBorders: bool(raw, "showCrossLodBorders"),
    colorByLod: bool(raw, "colorByLod"),
    normalColor: bool(raw, "normalColor"),
    normalDivergence: bool(raw, "normalDivergence"),
    divergenceGain: finite(raw, "divergenceGain", 0, 10_000),
    frontSideOnly: bool(raw, "frontSideOnly"),
    recomputedNormals: bool(raw, "recomputedNormals"),
    forceMaxLevel: enumValue(raw, "forceMaxLevel", ["auto", "0", "1", "2", "3"] as const),

    textureScale: finite(raw, "textureScale", 0.000001, 10_000),
    triplanar: bool(raw, "triplanar"),
    albedo: bool(raw, "albedo"),
    normalMap: bool(raw, "normalMap"),
    normalIntensity: finite(raw, "normalIntensity", 0, 100),
    roughness: finite(raw, "roughness", 0, 1),
    metalness: finite(raw, "metalness", 0, 1),
    textureBlendMode: enumValue(raw, "textureBlendMode", ["hard bands", "blend bands"] as const),
    textureBlendWidth: finite(raw, "textureBlendWidth", 0, 10_000),
    terrainBrightness: finite(raw, "terrainBrightness", -100, 100),
    terrainContrast: finite(raw, "terrainContrast", 0, 100),
    terrainSaturation: finite(raw, "terrainSaturation", 0, 100),
    terrainWarmth: finite(raw, "terrainWarmth", -100, 100),

    sunAzimuthDeg: finite(raw, "sunAzimuthDeg", -360_000, 360_000),
    sunElevationDeg: finite(raw, "sunElevationDeg", -360, 360),
    sunIntensity: finite(raw, "sunIntensity", 0, 10_000),
    skyIntensity: finite(raw, "skyIntensity", 0, 10_000),
    groundIntensity: finite(raw, "groundIntensity", 0, 10_000),
    exposure: finite(raw, "exposure", 0, 100),
    horizonSoftness: finite(raw, "horizonSoftness", 0, 100),
    sunDiskIntensity: finite(raw, "sunDiskIntensity", 0, 10_000),
    sunGlowIntensity: finite(raw, "sunGlowIntensity", 0, 10_000),
    hazeIntensity: finite(raw, "hazeIntensity", 0, 100),
    postProcessEnabled: bool(raw, "postProcessEnabled"),
    postProcessOpacity: finite(raw, "postProcessOpacity", 0, 1),
    postProcessExposure: finite(raw, "postProcessExposure", 0, 100),
    postProcessContrast: finite(raw, "postProcessContrast", 0, 100),
    postProcessSaturation: finite(raw, "postProcessSaturation", 0, 100),
    postProcessVignette: finite(raw, "postProcessVignette", 0, 10),
    postProcessDebugMode: enumValue(raw, "postProcessDebugMode", ["output", "copy", "off"] as const),

    bubble: bool(raw, "bubble"),
    bubbleRadius: finite(raw, "bubbleRadius", 0, MAX_DISTANCE_M),
    tintBubble: bool(raw, "tintBubble"),

    digEnabled: bool(raw, "digEnabled"),
    digRadius: finite(raw, "digRadius", 0.001, 1024),
    brushOp: enumValue(raw, "brushOp", ["remove", "add"] as const),
    brushShape: enumValue(raw, "brushShape", ["sphere", "cube", "cylinder"] as const),
    brushMaterial: integer(raw, "brushMaterial", 0, MAX_TERRAIN_TEXTURES - 1),
    brushHeight: finite(raw, "brushHeight", 0.001, 4096),
    brushStrength: finite(raw, "brushStrength", 0, 100),
    brushFalloff: finite(raw, "brushFalloff", 0, 100),
    brushFlowMs: finite(raw, "brushFlowMs", 1, 60_000),

    grassEnabled: bool(raw, "grassEnabled"),
    grassShaderMode,
    grassAlphaToCoverage: bool(raw, "grassAlphaToCoverage"),
    grassDistance: finite(raw, "grassDistance", 0, MAX_DISTANCE_M),
    grassBladeSpacing: finite(raw, "grassBladeSpacing", 0.001, 100_000),
    grassBladeHeight: finite(raw, "grassBladeHeight", 0, 10_000),
    grassBladeHeightVariation: finite(raw, "grassBladeHeightVariation", 0, 10_000),
    grassBladeWidth: finite(raw, "grassBladeWidth", 0.000001, 10_000),
    grassWindStrength: finite(raw, "grassWindStrength", 0, 10_000),
    grassWindSpeed: finite(raw, "grassWindSpeed", 0, 10_000),
    grassSlopeMinY: finite(raw, "grassSlopeMinY", -1, 1),
    grassMinHeight,
    grassMaxHeight,
    grassMaxBlades: integer(raw, "grassMaxBlades", 0, MAX_GRASS_BLADES),
    grassSeed: integer(raw, "grassSeed", -MAX_SEED, MAX_SEED),
  };

  const treesEnabled = optionalBool(raw, "treesEnabled");
  const treeDistance = optionalFinite(raw, "treeDistance", 0, MAX_DISTANCE_M);
  const treeMaxInstances = optionalInteger(raw, "treeMaxInstances", 0, MAX_TREE_INSTANCES);
  const treeDebugColorByLod = optionalBool(raw, "treeDebugColorByLod");
  const treeWindEnabled = optionalBool(raw, "treeWindEnabled");
  const treeWindStrength = optionalFinite(raw, "treeWindStrength", 0, 10_000);
  const treeWindSpeed = optionalFinite(raw, "treeWindSpeed", 0, 10_000);
  const treeGustStrength = optionalFinite(raw, "treeGustStrength", 0, 10_000);
  const treeTrunkSwayStrength = optionalFinite(raw, "treeTrunkSwayStrength", 0, 10_000);
  const treeLeafFlutterStrength = optionalFinite(raw, "treeLeafFlutterStrength", 0, 10_000);

  if (treesEnabled !== undefined) result.treesEnabled = treesEnabled;
  if (treeDistance !== undefined) result.treeDistance = treeDistance;
  if (treeMaxInstances !== undefined) result.treeMaxInstances = treeMaxInstances;
  if (treeDebugColorByLod !== undefined) result.treeDebugColorByLod = treeDebugColorByLod;
  if (treeWindEnabled !== undefined) result.treeWindEnabled = treeWindEnabled;
  if (treeWindStrength !== undefined) result.treeWindStrength = treeWindStrength;
  if (treeWindSpeed !== undefined) result.treeWindSpeed = treeWindSpeed;
  if (treeGustStrength !== undefined) result.treeGustStrength = treeGustStrength;
  if (treeTrunkSwayStrength !== undefined) result.treeTrunkSwayStrength = treeTrunkSwayStrength;
  if (treeLeafFlutterStrength !== undefined) result.treeLeafFlutterStrength = treeLeafFlutterStrength;
  return result;
}
