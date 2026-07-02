import type { LakeBodyConfig, RiverBodyConfig } from "./waterConfig.js";
import { readRiverMaterialSettings } from "./riverMaterialRuntime.js";
import { FLOW_EPSILON, RIVER_GEOMETRY_CELL_FADE_START, RIVER_GEOMETRY_CELL_FADE_END, type TerrainHeightSampler, type ShoreSurfBandSettings, type ClipmapExclusionBandSettings, type LakeRuntime, type RiverRuntime } from "./water_field_types.js";

const RIVER_MATERIAL_SETTINGS = readRiverMaterialSettings();

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smooth01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function smoothMask(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  return smooth01((value - edge0) / (edge1 - edge0));
}

export { clamp01, smooth01, smoothMask };

export function cloneShoreSurfSettings(settings: ShoreSurfBandSettings): ShoreSurfBandSettings {
  return { ...settings };
}

export function cloneClipmapExclusionBandSettings(settings: ClipmapExclusionBandSettings): ClipmapExclusionBandSettings {
  return { ...settings };
}

export function buildLakeRuntime(lake: LakeBodyConfig, sampler: TerrainHeightSampler): LakeRuntime {
  const rx = Math.max(0.001, lake.radius[0]);
  const rz = Math.max(0.001, lake.radius[1]);
  const terrainSamples: number[] = [];
  const step = Math.max(2, Math.min(rx, rz) / 8);
  for (let dz = -rz; dz <= rz; dz += step) {
    for (let dx = -rx; dx <= rx; dx += step) {
      const nx = dx / rx;
      const nz = dz / rz;
      if (nx * nx + nz * nz <= 1) {
        terrainSamples.push(sampler.surfaceHeight(lake.center[0] + dx, lake.center[1] + dz));
      }
    }
  }
  if (terrainSamples.length === 0) terrainSamples.push(sampler.surfaceHeight(lake.center[0], lake.center[1]));
  terrainSamples.sort((a, b) => a - b);
  const p20Index = Math.min(terrainSamples.length - 1, Math.max(0, Math.floor((terrainSamples.length - 1) * 0.2)));
  return {
    center: [...lake.center] as [number, number],
    radius: [rx, rz],
    invRadius: [1 / rx, 1 / rz],
    levelOffset: lake.levelOffset,
    waterLevel: terrainSamples[p20Index] + lake.levelOffset,
  };
}

export function buildRiverRuntime(river: RiverBodyConfig, sampler: TerrainHeightSampler): RiverRuntime {
  const points = river.points.map((p) => [...p] as [number, number]);
  const segLengths: number[] = [];
  const levelPrefix: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i < points.length; i += 1) {
    const dx = points[i][0] - points[i - 1][0];
    const dz = points[i][1] - points[i - 1][1];
    const len = Math.hypot(dx, dz);
    segLengths.push(len);
    totalLength += len;
    levelPrefix.push(totalLength);
  }
  const levels = points.map((p) => sampler.surfaceHeight(p[0], p[1]) + river.levelOffset);
  if (river.downstreamDrop > 0 && levels.length > 1) {
    const startLevel = levels[0];
    const endLevel = Math.min(levels[levels.length - 1], startLevel - river.downstreamDrop);
    for (let i = 1; i < levels.length; i += 1) {
      const progress = levelPrefix[i] / Math.max(1e-3, totalLength);
      levels[i] = Math.min(levels[i], startLevel + (endLevel - startLevel) * progress);
    }
    levels[levels.length - 1] = Math.min(levels[levels.length - 1], levels[0] - river.downstreamDrop);
  }
  for (let i = 1; i < levels.length; i += 1) levels[i] = Math.min(levels[i], levels[i - 1] - 0.02);
  return {
    points, segLengths, levelPrefix, levels,
    totalLength: Math.max(1e-3, totalLength),
    halfWidth: Math.max(0.05, river.width * 0.5),
    levelOffset: river.levelOffset,
    downstreamDrop: river.downstreamDrop,
  };
}

export function pointSegmentInfo(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax;
  const dz = bz - az;
  const segLenSq = dx * dx + dz * dz;
  const rawT = segLenSq > FLOW_EPSILON ? ((px - ax) * dx + (pz - az) * dz) / segLenSq : 0;
  const t = clamp01(rawT);
  const closestX = ax + dx * t;
  const closestZ = az + dz * t;
  return { dist: Math.hypot(px - closestX, pz - closestZ), t, closestX, closestZ };
}

export function cascadeMask(flowSpeed: number, drop: number): number {
  const speedMask = smooth01(flowSpeed / 0.75);
  const dropMask = smoothMask(RIVER_MATERIAL_SETTINGS.cascadeDropStart, RIVER_MATERIAL_SETTINGS.cascadeDropEnd, drop);
  return speedMask * dropMask;
}

export function cascadeWhitewaterDrop(drop: number, flowSpeed: number): number {
  const cascade = cascadeMask(flowSpeed, drop);
  if (cascade <= 0) return drop;
  return drop * (1 + cascade * RIVER_MATERIAL_SETTINGS.cascadeWhitewaterBoost)
    + cascade * RIVER_MATERIAL_SETTINGS.cascadeDropEnd * 0.35;
}

export function flowSurfaceOffset(
  x: number, z: number, cellSize: number,
  dirX: number, dirZ: number, flowSpeed: number, drop: number,
  bodyMask: number, riverMask: number, depthHint: number,
): number {
  if (cellSize <= 0 || depthHint <= 0 || flowSpeed <= FLOW_EPSILON || riverMask <= 0.02) return 0;
  const detailFade = 1 - smoothMask(RIVER_GEOMETRY_CELL_FADE_START, RIVER_GEOMETRY_CELL_FADE_END, cellSize);
  if (detailFade <= 0) return 0;
  const river = clamp01(riverMask);
  const center = smoothMask(0.42, 0.96, clamp01(bodyMask));
  const bank = (1 - center) * river;
  const speed = smooth01(flowSpeed / 1.15);
  const rapid = Math.max(speed, smooth01(drop / 1.6));
  const cascade = cascadeMask(flowSpeed, drop);
  const along = x * dirX + z * dirZ;
  const side = x * -dirZ + z * dirX;
  const channelWave = Math.sin(along * 0.36 + Math.sin(side * 0.075) * 0.8);
  const sideWave = Math.cos(side * 0.42 + along * 0.035);
  const cascadeLip = smooth01(Math.sin(along * 0.72 + Math.sin(side * 0.11) * 0.9) * 0.5 + 0.5);
  const cascadeSheet = -RIVER_MATERIAL_SETTINGS.cascadeStepStrength * cascade * center * cascadeLip;
  const cascadeRough = (channelWave * 0.65 + sideWave * 0.35) * RIVER_MATERIAL_SETTINGS.cascadeRoughnessStrength * cascade * center;
  const centerTrough = -RIVER_MATERIAL_SETTINGS.geometryThalwegDip * center * smooth01(depthHint / 2.8);
  const bankLift = RIVER_MATERIAL_SETTINGS.geometryBankLift * bank * (1 + rapid * 0.35);
  const riffle = channelWave * RIVER_MATERIAL_SETTINGS.geometryRiffleStrength * rapid
    + sideWave * RIVER_MATERIAL_SETTINGS.geometrySideRiffleStrength * rapid * center;
  const raw = (centerTrough + bankLift + riffle + cascadeSheet + cascadeRough) * river * detailFade;
  const maxDown = Math.max(0, depthHint - 0.035);
  return Math.max(-maxDown, Math.min(RIVER_MATERIAL_SETTINGS.geometryMaxOffset, raw));
}

export function shapeRiverSurfaceY(
  x: number, z: number, baseWaterY: number, terrainY: number, cellSize: number,
  dirX: number, dirZ: number, flowSpeed: number, drop: number,
  bodyMask: number, riverMask: number, depthHint: number,
): number {
  const offset = flowSurfaceOffset(x, z, cellSize, dirX, dirZ, flowSpeed, drop, bodyMask, riverMask, depthHint);
  if (offset === 0) return baseWaterY;
  return Math.max(terrainY + 0.035, baseWaterY + offset);
}
