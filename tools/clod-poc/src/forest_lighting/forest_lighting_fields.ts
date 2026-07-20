import * as THREE from "three";
import type { ForestLightingSettings } from "./forest_lighting_config.js";

export interface ForestLightingCell {
  canopyDensity: number;
  canopyHeightM: number;
  broadleafCoverage: number;
  coniferCoverage: number;
  competition: number;
  grassSuppression: number;
  ambientOcclusion: number;
  shadowProxy: number;
  fogDensity: number;
  sunShaftMask: number;
  forestEdge: number;
}

export interface ForestLightingField {
  resolution: number;
  worldCells: number;
  canopyHeightScaleM: number;
  canopyDensity: Float32Array;
  canopyHeightM: Float32Array;
  broadleafCoverage: Float32Array;
  coniferCoverage: Float32Array;
  competition: Float32Array;
  grassSuppression: Float32Array;
  understoryDensity: Float32Array;
  ambientOcclusion: Float32Array;
  shadowProxy: Float32Array;
  fogDensity: Float32Array;
  sunShaftMask: Float32Array;
  forestEdge: Float32Array;
}

export interface ForestLightingTreeProxy {
  x: number;
  z: number;
  height: number;
  scale: number;
  crownRadius: number;
  species: string;
}

export interface ForestLightingUnderstoryProxy {
  x: number;
  z: number;
  classId: string;
  scale: number;
  densityWeight: number;
}

export function createForestLightingField(
  worldCells: number,
  settings: ForestLightingSettings,
): ForestLightingField {
  const resolution = settings.field.resolution;
  const length = resolution * resolution;
  return {
    resolution,
    worldCells,
    canopyHeightScaleM: Math.max(1, settings.atmosphere.forestFogHeightM),
    canopyDensity: new Float32Array(length),
    canopyHeightM: new Float32Array(length),
    broadleafCoverage: new Float32Array(length),
    coniferCoverage: new Float32Array(length),
    competition: new Float32Array(length),
    grassSuppression: new Float32Array(length),
    understoryDensity: new Float32Array(length),
    ambientOcclusion: new Float32Array(length),
    shadowProxy: new Float32Array(length),
    fogDensity: new Float32Array(length),
    sunShaftMask: new Float32Array(length),
    forestEdge: new Float32Array(length),
  };
}

export function clearForestLightingField(field: ForestLightingField): void {
  field.canopyDensity.fill(0);
  field.canopyHeightM.fill(0);
  field.broadleafCoverage.fill(0);
  field.coniferCoverage.fill(0);
  field.competition.fill(0);
  field.grassSuppression.fill(0);
  field.understoryDensity.fill(0);
  field.ambientOcclusion.fill(0);
  field.shadowProxy.fill(0);
  field.fogDensity.fill(0);
  field.sunShaftMask.fill(0);
  field.forestEdge.fill(0);
}

export function splatCanopyInfluence(
  field: ForestLightingField,
  tree: ForestLightingTreeProxy,
  settings: ForestLightingSettings,
): void {
  if (!settings.canopy.enabled || tree.scale < settings.canopy.minTreeScale || tree.crownRadius <= 0) return;
  const radiusM = Math.max(
    settings.field.canopyInfluenceRadiusM,
    tree.crownRadius * settings.canopy.crownRadiusWeight,
  );
  const cellSize = cellSizeM(field);
  const radiusCells = Math.max(1, radiusM / cellSize);
  const centerX = worldToCell(tree.x, field);
  const centerZ = worldToCell(tree.z, field);
  const minX = Math.max(0, Math.floor(centerX - radiusCells));
  const maxX = Math.min(field.resolution - 1, Math.ceil(centerX + radiusCells));
  const minZ = Math.max(0, Math.floor(centerZ - radiusCells));
  const maxZ = Math.min(field.resolution - 1, Math.ceil(centerZ + radiusCells));
  const heightFactor = clamp01(tree.height / field.canopyHeightScaleM);
  const scaleFactor = clamp01((tree.scale - settings.canopy.minTreeScale) / Math.max(0.001, 1.4 - settings.canopy.minTreeScale));
  const densityStrength = settings.canopy.densityStrength * (0.35 + scaleFactor * 0.45 + heightFactor * settings.canopy.heightWeight * 0.2);
  const falloffPower = settings.field.densityFalloffPower;
  const speciesClass = canopySpeciesClass(tree.species);

  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x + 0.5 - centerX;
      const dz = z + 0.5 - centerZ;
      const d = Math.hypot(dx, dz) / radiusCells;
      if (d > 1) continue;
      const influence = Math.pow(1 - d, falloffPower) * densityStrength;
      const normalizedInfluence = clamp01(influence / Math.max(0.001, densityStrength));
      const index = cellIndex(field, x, z);
      field.canopyDensity[index] = clamp01(field.canopyDensity[index] + influence);
      field.canopyHeightM[index] = Math.max(field.canopyHeightM[index], tree.height * normalizedInfluence);
      if (speciesClass === "broadleaf") {
        field.broadleafCoverage[index] = clamp01(field.broadleafCoverage[index] + influence);
      } else if (speciesClass === "conifer") {
        field.coniferCoverage[index] = clamp01(field.coniferCoverage[index] + influence);
      }
    }
  }
}

export function splatUnderstoryInfluence(
  field: ForestLightingField,
  understory: ForestLightingUnderstoryProxy,
  settings: ForestLightingSettings,
): void {
  const radiusCells = Math.max(1, settings.field.understoryInfluenceRadiusM / cellSizeM(field));
  const centerX = worldToCell(understory.x, field);
  const centerZ = worldToCell(understory.z, field);
  const minX = Math.max(0, Math.floor(centerX - radiusCells));
  const maxX = Math.min(field.resolution - 1, Math.ceil(centerX + radiusCells));
  const minZ = Math.max(0, Math.floor(centerZ - radiusCells));
  const maxZ = Math.min(field.resolution - 1, Math.ceil(centerZ + radiusCells));
  const strength = clamp01(understory.scale * understory.densityWeight);

  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x + 0.5 - centerX, z + 0.5 - centerZ) / radiusCells;
      if (d > 1) continue;
      const index = cellIndex(field, x, z);
      field.understoryDensity[index] = clamp01(field.understoryDensity[index] + (1 - d) * strength);
    }
  }
}

/** Scratch state shared by the row-sliced finalize phases so a rebuild can be
 *  spread across frames. Create once per rebuild, then run blur rows, finalize
 *  rows, and the clamp pass in that order. */
export interface ForestLightingFinalizeContext {
  blurredCanopy: Float32Array;
  shadow: Float32Array;
  sunX: number;
  sunZ: number;
  projectionCells: number;
  shadowSoftnessCells: number;
}

export function createForestLightingFinalizeContext(
  field: ForestLightingField,
  sunDirection: THREE.Vector3,
  settings: ForestLightingSettings,
): ForestLightingFinalizeContext {
  const length = field.resolution * field.resolution;
  const sunXz = new THREE.Vector2(sunDirection.x, sunDirection.z);
  if (sunXz.lengthSq() <= 1e-8) sunXz.set(1, 0);
  else sunXz.normalize();
  return {
    blurredCanopy: new Float32Array(length),
    shadow: new Float32Array(length),
    sunX: sunXz.x,
    sunZ: sunXz.y,
    projectionCells: settings.shadowProxy.projectionDistanceM / cellSizeM(field),
    shadowSoftnessCells: Math.max(0.5, settings.shadowProxy.softnessM / cellSizeM(field)),
  };
}

export function blurForestLightingCanopyRows(
  field: ForestLightingField,
  context: ForestLightingFinalizeContext,
  settings: ForestLightingSettings,
  rowStart: number,
  rowEnd: number,
): void {
  const resolution = field.resolution;
  const radius = settings.field.blurRadiusCells;
  const source = field.canopyDensity;
  const target = context.blurredCanopy;
  if (radius <= 0) {
    target.set(source.subarray(rowStart * resolution, rowEnd * resolution), rowStart * resolution);
    return;
  }
  for (let z = rowStart; z < rowEnd; z++) {
    for (let x = 0; x < resolution; x++) {
      let sum = 0;
      let weightSum = 0;
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const d = Math.hypot(dx, dz);
          if (d > radius + 0.001) continue;
          const weight = 1 / (1 + d);
          sum += sampleArray(source, resolution, x + dx, z + dz) * weight;
          weightSum += weight;
        }
      }
      target[z * resolution + x] = weightSum > 0 ? sum / weightSum : source[z * resolution + x];
    }
  }
}

export function finalizeForestLightingRows(
  field: ForestLightingField,
  context: ForestLightingFinalizeContext,
  settings: ForestLightingSettings,
  rowStart: number,
  rowEnd: number,
): void {
  const resolution = field.resolution;
  const blurredCanopy = context.blurredCanopy;
  const shadow = context.shadow;

  for (let z = rowStart; z < rowEnd; z++) {
    for (let x = 0; x < resolution; x++) {
      const index = cellIndex(field, x, z);
      const canopy = clamp01(field.canopyDensity[index]);
      const blurred = clamp01(blurredCanopy[index]);
      const understory = clamp01(field.understoryDensity[index]);
      const gradientX = sampleArray(blurredCanopy, resolution, x + 1, z) - sampleArray(blurredCanopy, resolution, x - 1, z);
      const gradientZ = sampleArray(blurredCanopy, resolution, x, z + 1) - sampleArray(blurredCanopy, resolution, x, z - 1);
      const edge = clamp01(Math.hypot(gradientX, gradientZ) * (3.0 + settings.canopy.edgeSoftness * 4.0));
      field.forestEdge[index] = edge;
      field.competition[index] = clamp01(Math.max(blurred, understory));
      field.grassSuppression[index] = clamp01(field.competition[index] * settings.canopy.densityStrength);

      const ao = settings.ambientOcclusion.enabled
        ? clamp(
          blurred * settings.ambientOcclusion.strength +
            canopy * settings.ambientOcclusion.terrainContactStrength +
            understory * settings.ambientOcclusion.understoryStrength,
          settings.ambientOcclusion.minOcclusion,
          settings.ambientOcclusion.maxOcclusion,
        )
        : 0;
      field.ambientOcclusion[index] = clamp01(ao);

      const fog = settings.atmosphere.enabled
        ? blurred * settings.atmosphere.forestFogStrength + edge * settings.atmosphere.edgeFogBoost
        : 0;
      field.fogDensity[index] = clamp01(fog);

      const sunFacingEdge = clamp01((gradientX * context.sunX + gradientZ * context.sunZ) * 3 + 0.5);
      const gap = clamp01(1 - blurred);
      field.sunShaftMask[index] = settings.atmosphere.enabled && edge > settings.atmosphere.sunShaftsThreshold
        ? clamp01(edge * sunFacingEdge * gap * settings.atmosphere.sunShaftsStrength)
        : 0;

      if (settings.shadowProxy.enabled && canopy > 0) {
        splatProjectedShadow(
          shadow,
          resolution,
          x - context.sunX * context.projectionCells * settings.shadowProxy.sunDirectionWeight,
          z - context.sunZ * context.projectionCells * settings.shadowProxy.sunDirectionWeight,
          context.shadowSoftnessCells,
          canopy * settings.shadowProxy.strength,
        );
      }
    }
  }
}

export function finalizeForestLightingClampPass(
  field: ForestLightingField,
  context: ForestLightingFinalizeContext,
  settings: ForestLightingSettings,
): void {
  const length = field.resolution * field.resolution;
  for (let i = 0; i < length; i++) {
    field.canopyDensity[i] = clamp01(field.canopyDensity[i]);
    field.canopyHeightM[i] = Math.max(0, Number.isFinite(field.canopyHeightM[i]) ? field.canopyHeightM[i] : 0);
    field.broadleafCoverage[i] = clamp01(field.broadleafCoverage[i]);
    field.coniferCoverage[i] = clamp01(field.coniferCoverage[i]);
    field.competition[i] = clamp01(field.competition[i]);
    field.grassSuppression[i] = clamp01(field.grassSuppression[i]);
    field.shadowProxy[i] = settings.shadowProxy.enabled ? clamp(context.shadow[i], 0, settings.shadowProxy.maxShadow) : 0;
    field.fogDensity[i] = clamp01(field.fogDensity[i]);
    field.sunShaftMask[i] = clamp01(field.sunShaftMask[i]);
    field.forestEdge[i] = clamp01(field.forestEdge[i]);
  }
}

export function finalizeForestLightingField(
  field: ForestLightingField,
  sunDirection: THREE.Vector3,
  settings: ForestLightingSettings,
): void {
  const context = createForestLightingFinalizeContext(field, sunDirection, settings);
  blurForestLightingCanopyRows(field, context, settings, 0, field.resolution);
  finalizeForestLightingRows(field, context, settings, 0, field.resolution);
  finalizeForestLightingClampPass(field, context, settings);
}

function splatProjectedShadow(
  target: Float32Array,
  resolution: number,
  centerX: number,
  centerZ: number,
  radiusCells: number,
  strength: number,
): void {
  const minX = Math.max(0, Math.floor(centerX - radiusCells));
  const maxX = Math.min(resolution - 1, Math.ceil(centerX + radiusCells));
  const minZ = Math.max(0, Math.floor(centerZ - radiusCells));
  const maxZ = Math.min(resolution - 1, Math.ceil(centerZ + radiusCells));
  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x + 0.5 - centerX, z + 0.5 - centerZ) / radiusCells;
      if (d > 1) continue;
      const index = z * resolution + x;
      target[index] = clamp01(target[index] + strength * Math.pow(1 - d, 2));
    }
  }
}

function canopySpeciesClass(species: string): "broadleaf" | "conifer" | "other" {
  if (species === "oak" || species === "birch" || species === "willow") return "broadleaf";
  if (species === "pine" || species === "spruce") return "conifer";
  return "other";
}

function sampleArray(source: Float32Array, resolution: number, x: number, z: number): number {
  const cx = Math.max(0, Math.min(resolution - 1, x));
  const cz = Math.max(0, Math.min(resolution - 1, z));
  return source[cz * resolution + cx] ?? 0;
}

function cellSizeM(field: ForestLightingField): number {
  return field.worldCells / Math.max(1, field.resolution);
}

function worldToCell(value: number, field: ForestLightingField): number {
  return clamp(value / Math.max(0.001, field.worldCells), 0, 0.999999) * field.resolution;
}

function cellIndex(field: ForestLightingField, x: number, z: number): number {
  return z * field.resolution + x;
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
