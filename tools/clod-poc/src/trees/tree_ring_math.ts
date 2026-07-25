import { terrainWeights, WATER_LEVEL } from "../terrain/terrain.js";
import { DEFAULT_TREE_SETTINGS, type TreeLod, type TreeSettings } from "./tree_config.js";
import { treeLodCrossfadeHalfBandM } from "./tree_lod_transition.js";
import { treeLodDistances } from "./tree_lod.js";
import { treeMaterialDensityVector } from "./tree_material_bias.js";
import { clamp, clamp01, smoothstep } from "./tree_noise.js";
import { treePcg2d01 } from "../vegetation/gpu_authority/pcg2d.js";

export interface TreeRingAcceptParams {
  seed: number;
  minHeightM: number;
  maxHeightM: number;
  slopeMinY: number;
  minGroundWeight: number;
  lowlandHeightM: number;
  highlandHeightM: number;
  heightFadeM: number;
  slopeFadeStartY: number;
  slopeFadeEndY: number;
  materialWeightPower: number;
  baseDensity: number;
  parentCellM: number;
  clumpStrength: number;
  clumpThreshold: number;
  waterClearanceM: number;
  rockReject: number;
  snowReject: number;
  materialDensity: [number, number, number, number];
}

export interface TreeRingLodParams {
  near: number;
  mid: number;
  far: number;
  radius: number;
  band: number;
}

export interface TreeRingLodState {
  active: Record<TreeLod, boolean>;
  fade: Record<TreeLod, number>;
}

export function treePcg2d(cellX: number, cellZ: number, salt: number): [number, number] {
  return treePcg2d01(cellX, cellZ, salt);
}

export function treeWorldCell(
  slotX: number,
  slotZ: number,
  grid: number,
  cellSize: number,
  cameraX: number,
  cameraZ: number,
): [number, number] {
  const safeGrid = Math.max(1, Math.floor(grid));
  const safeCell = Math.max(0.001, cellSize);
  const camCellX = cameraX / safeCell;
  const camCellZ = cameraZ / safeCell;
  return [
    Math.round((camCellX - slotX) / safeGrid) * safeGrid + slotX,
    Math.round((camCellZ - slotZ) / safeGrid) * safeGrid + slotZ,
  ];
}

export function treeWorldCellFromSlot(
  slot: number,
  grid: number,
  cellSize: number,
  cameraX: number,
  cameraZ: number,
): [number, number] {
  const safeGrid = Math.max(1, Math.floor(grid));
  const safeSlot = Math.max(0, Math.floor(slot));
  return treeWorldCell(safeSlot % safeGrid, Math.floor(safeSlot / safeGrid), safeGrid, cellSize, cameraX, cameraZ);
}

export function treeRingAcceptParams(settings: TreeSettings = DEFAULT_TREE_SETTINGS): TreeRingAcceptParams {
  const terrain = settings.ecology.terrain;
  const clustering = settings.ecology.clustering;
  return {
    seed: settings.seed,
    minHeightM: settings.placement.minHeightM,
    maxHeightM: settings.placement.maxHeightM,
    slopeMinY: settings.placement.slopeMinY,
    minGroundWeight: settings.placement.minGroundWeight,
    lowlandHeightM: terrain.lowlandHeightM,
    highlandHeightM: terrain.highlandHeightM,
    heightFadeM: terrain.heightFadeM,
    slopeFadeStartY: terrain.slopeFadeStartY,
    slopeFadeEndY: terrain.slopeFadeEndY,
    materialWeightPower: terrain.materialWeightPower,
    baseDensity: settings.ecology.density.baseDensity,
    parentCellM: clustering.clusterScaleM,
    clumpStrength: clustering.clusterStrength,
    clumpThreshold: clustering.clusterThreshold,
    waterClearanceM: 0.35,
    rockReject: 0.9,
    snowReject: 0.55,
    materialDensity: treeMaterialDensityVector(settings),
  };
}

export function treeAcceptMask(
  height: number,
  normalY: number,
  worldX: number,
  worldZ: number,
  params: TreeRingAcceptParams = treeRingAcceptParams(),
): number {
  if (!Number.isFinite(height) || !Number.isFinite(normalY)) return 0;
  if (height < params.minHeightM || height > params.maxHeightM) return 0;
  if (height < WATER_LEVEL + params.waterClearanceM || normalY < params.slopeMinY) return 0;

  const [grassWeight, rockWeight, sandWeight, snowWeight] = terrainWeights(height, normalY);
  if (rockWeight >= params.rockReject || snowWeight >= params.snowReject) return 0;
  const materialDensity = grassWeight * params.materialDensity[0]
    + rockWeight * params.materialDensity[1]
    + sandWeight * params.materialDensity[2]
    + snowWeight * params.materialDensity[3];

  const groundWeight = clamp01((grassWeight + rockWeight * 0.25) * materialDensity);
  const materialMask = Math.pow(
    smoothstep(params.minGroundWeight, Math.min(1, params.minGroundWeight + 0.28), groundWeight),
    Math.max(0.001, params.materialWeightPower),
  );
  const lowerHeight = smoothstep(params.lowlandHeightM - params.heightFadeM, params.lowlandHeightM, height);
  const upperHeight = 1 - smoothstep(params.highlandHeightM, params.highlandHeightM + params.heightFadeM, height);
  const slopeMask = smoothstep(params.slopeFadeStartY, params.slopeFadeEndY, normalY);
  const clumpMask = treeParentClumpMask(worldX, worldZ, params);
  return clamp01(params.baseDensity * lowerHeight * upperHeight * slopeMask * materialMask * clumpMask);
}

export function treeParentClumpMask(worldX: number, worldZ: number, params: TreeRingAcceptParams): number {
  const parentCellM = Math.max(0.001, params.parentCellM);
  const parentX = Math.floor(worldX / parentCellM);
  const parentZ = Math.floor(worldZ / parentCellM);
  const parent = treePcg2d(parentX, parentZ, params.seed + 13001)[0];
  const clump = smoothstep(params.clumpThreshold, 1, parent);
  const clusteredDensity = clamp(0.12 + clump * 1.35, 0, 1.25);
  return clamp(1 - params.clumpStrength + clusteredDensity * params.clumpStrength, 0, 1.25);
}

export function treeRingLodParams(settings: TreeSettings = DEFAULT_TREE_SETTINGS): TreeRingLodParams {
  // near/mid/far/radius come from the single LOD-threshold source (tree_lod.ts) so the GPU
  // ring cannot select a different LOD than the CPU path for the same distance.
  const distances = treeLodDistances(settings);
  const crossfadeActive = settings.lod.crossfadeEnabled && settings.lod.ditherEnabled;
  return {
    near: distances.near,
    mid: distances.mid,
    far: distances.far,
    radius: distances.impostor,
    band: crossfadeActive ? treeLodCrossfadeHalfBandM(settings) : 0,
  };
}

export function treeLodRing(distance: number, params: TreeRingLodParams): TreeRingLodState {
  const dist = Math.max(0, Number.isFinite(distance) ? distance : 0);
  const near = Math.max(0, params.near);
  const mid = Math.max(near, params.mid);
  const far = Math.max(mid, params.far);
  const radius = Math.max(far, params.radius);
  const band = Math.max(0, params.band);
  const active: Record<TreeLod, boolean> = {
    near: false,
    mid: false,
    far: false,
    impostor: false,
  };
  const fade: Record<TreeLod, number> = {
    near: 0,
    mid: 0,
    far: 0,
    impostor: 0,
  };

  if (band <= 0) {
    const lod = dist <= near ? "near" : dist <= mid ? "mid" : dist <= far ? "far" : "impostor";
    active[lod] = dist <= radius;
    fade[lod] = active[lod] ? 1 : 0;
    return { active, fade };
  }

  active.near = dist < near + band;
  active.mid = dist >= near - band && dist < mid + band;
  active.far = dist >= mid - band && dist < far + band;
  active.impostor = dist >= far - band && dist <= radius + band;

  fade.near = active.near ? 1 : 0;
  fade.mid = active.mid ? 1 : 0;
  fade.far = active.far ? 1 : 0;
  fade.impostor = active.impostor ? 1 : 0;
  applyBoundaryFade(dist, near, band, "near", "mid", fade);
  applyBoundaryFade(dist, mid, band, "mid", "far", fade);
  applyBoundaryFade(dist, far, band, "far", "impostor", fade);

  for (const lod of Object.keys(fade) as TreeLod[]) {
    if (!active[lod]) fade[lod] = 0;
  }
  return { active, fade };
}

function applyBoundaryFade(
  distance: number,
  threshold: number,
  band: number,
  lower: TreeLod,
  upper: TreeLod,
  fade: Record<TreeLod, number>,
): void {
  if (distance < threshold - band || distance > threshold + band) return;
  const t = clamp01((distance - (threshold - band)) / (band * 2));
  fade[lower] = Math.min(fade[lower], 1 - t);
  fade[upper] = Math.min(fade[upper], t);
}
