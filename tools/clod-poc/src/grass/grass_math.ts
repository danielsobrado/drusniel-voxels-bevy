import * as THREE from "three";
import { terrainWeights, surfaceHeight, surfaceNormal, WATER_LEVEL } from "../terrain.js";
import {
  DEFAULT_GRASS_SETTINGS,
  GRASS_WATER_CLEARANCE,
  type GrassCandidateSample,
  type GrassSettings,
  type GrassTerrainSite,
} from "./grass_config.js";

export function hash2(x: number, z: number, seed: number): number {
  let value = seed | 0;
  value ^= Math.imul(x | 0, 0x27d4eb2d);
  value ^= Math.imul(z | 0, 0x165667b1);
  value = Math.imul(value ^ (value >>> 15), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function randomSigned(x: number, z: number, seed: number): number {
  return hash2(x, z, seed) * 2 - 1;
}

export function pcg2d(cellX: number, cellZ: number, salt: number): [number, number] {
  const m = 1664525;
  const c = 1013904223;
  const a0 = (Math.trunc(cellX) + 40000 + (salt & 0x3fff)) >>> 0;
  const b0 = (Math.trunc(cellZ) + 40000 + ((salt >>> 14) & 0x3fff)) >>> 0;
  const a1 = (Math.imul(a0, m) + c) >>> 0;
  const b1 = (Math.imul(b0, m) + c) >>> 0;
  const a2 = (a1 + Math.imul(b1, m)) >>> 0;
  const b2 = (b1 + Math.imul(a2, m)) >>> 0;
  const a3 = (a2 ^ (a2 >>> 16)) >>> 0;
  const b3 = (b2 ^ (b2 >>> 16)) >>> 0;
  const a4 = (a3 + Math.imul(b3, m)) >>> 0;
  const b4 = (b3 + Math.imul(a4, m)) >>> 0;
  const a5 = (a4 ^ (a4 >>> 16)) >>> 0;
  const b5 = (b4 ^ (b4 >>> 16)) >>> 0;
  const inv = 1 / 16777216;
  return [(a5 & 0xffffff) * inv, (b5 & 0xffffff) * inv];
}

export function grassWorldCell(
  slotX: number,
  slotZ: number,
  grid: number,
  cellSize: number,
  cameraX: number,
  cameraZ: number,
): [number, number] {
  const camCellX = cameraX / cellSize;
  const camCellZ = cameraZ / cellSize;
  return [
    Math.round((camCellX - slotX) / grid) * grid + slotX,
    Math.round((camCellZ - slotZ) / grid) * grid + slotZ,
  ];
}

export function acceptsGrassCandidate(settings: GrassSettings, sample: GrassCandidateSample): boolean {
  return sample.normalY >= settings.slopeMinY
    && sample.height >= settings.minHeight
    && sample.height <= settings.maxHeight
    && (sample.waterDepth ?? 0) <= 0
    && (sample.rockWeight ?? 0) < 0.82
    && (sample.snowWeight ?? 0) < 0.55
    && sample.grassWeight > settings.placement.minGrassWeight
    && sample.threshold < sample.grassWeight;
}

export function computeGrassDensityScale(distance: number, settings: GrassSettings): number {
  const d = Math.max(0, distance);
  const base = Math.min(1, Math.pow(58 / (d + 42), 1.15));
  const far = Math.pow(Math.min(1, 120 / Math.max(d, 120)), 1.6);
  const raw = base * far;
  return THREE.MathUtils.clamp(raw, settings.lod.farDensityRatio, 1);
}

export function grassThin(distance: number, settings: GrassSettings = DEFAULT_GRASS_SETTINGS): number {
  return computeGrassDensityScale(distance, settings);
}

export function grassRingBands(settings: GrassSettings): { near: number; mid: number; far: number; radius: number } {
  const ringDist = settings.ring.ringDistance;
  return {
    radius: Math.max(0, Math.min(ringDist, settings.ring.maxRadius)),
    near: Math.min(ringDist * settings.lod.nearFraction, settings.ring.nearMeters),
    mid: Math.min(ringDist * settings.lod.midFraction, settings.ring.midMeters),
    far: Math.min(ringDist * settings.ring.farDistanceFraction, settings.ring.farMeters),
  };
}

export function grassFadeDistance(settings: GrassSettings): number {
  return settings.shaderMode === "webgpu-ring-v1"
    ? Math.min(settings.ring.ringDistance, settings.ring.maxRadius)
    : settings.distance;
}

export function grassMaskForHeightNormal(
  height: number,
  normalY: number,
  settings: Pick<GrassSettings, "slopeMinY" | "minHeight" | "maxHeight" | "ring"> = DEFAULT_GRASS_SETTINGS,
  distanceFromCamera = Number.POSITIVE_INFINITY,
): number {
  if (height < settings.minHeight || height > settings.maxHeight) return 0;
  const [grassWeight, rockWeight, , snowWeight] = terrainWeights(height, normalY);
  if (height < WATER_LEVEL + GRASS_WATER_CLEARANCE || rockWeight >= 0.82 || snowWeight >= 0.55) return 0;
  const aboveWaterMask = THREE.MathUtils.smoothstep(height, WATER_LEVEL + GRASS_WATER_CLEARANCE, WATER_LEVEL + 3.5);
  const slopeMask = THREE.MathUtils.smoothstep(
    normalY,
    Math.max(0, settings.slopeMinY - 0.04),
    Math.min(1, settings.slopeMinY + 0.16),
  );
  const rockReject = THREE.MathUtils.smoothstep(rockWeight, 0.48, 0.84);
  const snowReject = THREE.MathUtils.smoothstep(snowWeight, 0.08, 0.55);
  const bankHeight = (1 - THREE.MathUtils.smoothstep(height, WATER_LEVEL + 1.0, WATER_LEVEL + 8.0))
    * THREE.MathUtils.smoothstep(height, WATER_LEVEL + GRASS_WATER_CLEARANCE, WATER_LEVEL + 2.5);
  const wetBank = bankHeight * THREE.MathUtils.smoothstep(normalY, 0.42, 0.82);
  const wetBankThinning = 1 - wetBank * 0.58;
  const viableMask = aboveWaterMask * slopeMask * (1 - rockReject) * (1 - snowReject);
  const scruff = (1 - THREE.MathUtils.smoothstep(
    distanceFromCamera,
    settings.ring.scruffMeters * 0.45,
    settings.ring.scruffMeters,
  ))
    * viableMask
    * settings.ring.scruffMinDensity;
  return THREE.MathUtils.clamp(
    Math.max(grassWeight * viableMask * wetBankThinning, scruff),
    0,
    1,
  );
}

export function sampleGrassTerrainSite(
  x: number,
  z: number,
  settings: Pick<GrassSettings, "slopeMinY" | "ring"> = DEFAULT_GRASS_SETTINGS,
  distanceFromCamera = Number.POSITIVE_INFINITY,
): GrassTerrainSite {
  const height = surfaceHeight(x, z);
  const normal = surfaceNormal(x, z);
  const normalY = normal[1];
  const weights = terrainWeights(height, normalY);
  const [grassWeight, rockWeight, sandWeight, snowWeight] = weights;
  const waterDepth = Math.max(0, WATER_LEVEL + GRASS_WATER_CLEARANCE - height);
  const aboveWaterMask = THREE.MathUtils.smoothstep(height, WATER_LEVEL + GRASS_WATER_CLEARANCE, WATER_LEVEL + 3.5);
  const slopeMask = THREE.MathUtils.smoothstep(
    normalY,
    Math.max(0, settings.slopeMinY - 0.04),
    Math.min(1, settings.slopeMinY + 0.16),
  );
  const rockReject = THREE.MathUtils.smoothstep(rockWeight, 0.48, 0.84);
  const snowReject = THREE.MathUtils.smoothstep(snowWeight, 0.08, 0.55);
  const bankHeight = (1 - THREE.MathUtils.smoothstep(height, WATER_LEVEL + 1.0, WATER_LEVEL + 8.0))
    * THREE.MathUtils.smoothstep(height, WATER_LEVEL + GRASS_WATER_CLEARANCE, WATER_LEVEL + 2.5);
  const wetBank = bankHeight * THREE.MathUtils.smoothstep(normalY, 0.42, 0.82);
  const wetBankThinning = 1 - wetBank * 0.58;
  const viableMask = aboveWaterMask * slopeMask * (1 - rockReject) * (1 - snowReject);
  const scruff = (1 - THREE.MathUtils.smoothstep(
    distanceFromCamera,
    settings.ring.scruffMeters * 0.45,
    settings.ring.scruffMeters,
  ))
    * viableMask
    * settings.ring.scruffMinDensity;
  const grassMask = THREE.MathUtils.clamp(
    Math.max(grassWeight * viableMask * wetBankThinning, scruff),
    0,
    1,
  );
  return {
    height,
    normalY,
    terrainNormal: safeTerrainNormal(normal),
    materialWeights: weights,
    grassMask,
    grassWeight,
    rockWeight,
    sandWeight,
    snowWeight,
    wetBank,
    waterDepth,
    slopeMask,
  };
}

export function safeTerrainNormal(normal: readonly number[] | null | undefined): [number, number, number] {
  const x = normal?.[0] ?? 0;
  const y = normal?.[1] ?? 1;
  const z = normal?.[2] ?? 0;
  const len = Math.hypot(x, y, z);
  if (!Number.isFinite(len) || len < 1e-5) return [0, 1, 0];
  return [x / len, y / len, z / len];
}
