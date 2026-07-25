import { terrainWeights, WATER_LEVEL } from "../terrain/terrain.js";
import { DEFAULT_TREE_SETTINGS, type TreeLod, type TreeSettings } from "./tree_config.js";
import { treeLodCrossfadeHalfBandM } from "./tree_lod_transition.js";
import { treeLodDistances } from "./tree_lod.js";
import { treeMaterialDensityVector } from "./tree_material_bias.js";
import { clamp, clamp01, smoothstep } from "./tree_noise.js";
import { treePcg2d01 } from "../vegetation/gpu_authority/pcg2d.js";

// Mirrors TREE_GPU_RING_CELL (gpu/tree_ring_compute.ts), packed into WGSL `settings_a.x` and
// used there as the local-competition cell size. Duplicated rather than imported to avoid an
// import cycle; tree_accept_cpu_gpu_parity.test.ts asserts the two stay equal.
export const TREE_RING_COMPETITION_CELL_M = 3.4;

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
  const forestCover = treeForestCoverMask(worldX, worldZ, params);
  const shorelineMask = treeShorelineDensityMask(height, normalY, params);
  const competitionMask = treeLocalCompetitionMask(worldX, worldZ, params);
  return clamp01(
    params.baseDensity * lowerHeight * upperHeight * slopeMask * materialMask * clumpMask
      * forestCover * shorelineMask * competitionMask,
  );
}

// The three masks below mirror `tree_forest_cover_mask` / `tree_shoreline_density_mask` /
// `tree_local_competition_mask` in tree_ring.compute.wgsl. They are multiplied into the WGSL
// `tree_accept_mask` result, so omitting them here made the CPU oracle systematically
// over-accept relative to the GPU ring. Guarded by tree_accept_cpu_gpu_parity.test.ts.
export function treeForestCoverMask(worldX: number, worldZ: number, params: TreeRingAcceptParams): number {
  const broad = treePcg2d(Math.floor(worldX / 176), Math.floor(worldZ / 176), params.seed + 17011)[0];
  const mid = treePcg2d(Math.floor(worldX / 64), Math.floor(worldZ / 64), params.seed + 19031)[1];
  const clearing = smoothstep(0.62, 0.92, broad) * smoothstep(0.44, 0.86, mid);
  return clamp(1 - clearing * 0.78, 0.18, 1);
}

export function treeShorelineDensityMask(height: number, normalY: number, params: TreeRingAcceptParams): number {
  const waterMargin = height - WATER_LEVEL;
  const dryBank = smoothstep(params.waterClearanceM, params.waterClearanceM + 7, waterMargin);
  const lowlandMoisture = 1 - clamp01(waterMargin / 36);
  const bankHealth = smoothstep(params.slopeFadeStartY, params.slopeFadeEndY, normalY);
  const riparianBoost = 0.92 + (1.18 - 0.92) * (lowlandMoisture * bankHealth);
  return clamp(dryBank * riparianBoost, 0, 1.18);
}

export function treeLocalCompetitionMask(worldX: number, worldZ: number, params: TreeRingAcceptParams): number {
  // WGSL passes `floor(wpos / cell_size)` as the competition cell.
  const cellX = Math.floor(worldX / TREE_RING_COMPETITION_CELL_M);
  const cellZ = Math.floor(worldZ / TREE_RING_COMPETITION_CELL_M);
  const current = treeRingHash(cellX, cellZ, 7103, params) + treeParentClumpMask(worldX, worldZ, params) * 0.08;
  let strongerNeighbors = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const score = treeRingHash(cellX + dx, cellZ + dz, 7103, params)
        + treeRingHash(cellX + dx, cellZ + dz, 7201, params) * 0.08;
      if (score > current + 0.18) strongerNeighbors++;
    }
  }
  const pressure = clamp01(strongerNeighbors / 8);
  return 1.05 + (0.72 - 1.05) * pressure;
}

// Mirrors WGSL `tree_hash`: a sin/fract hash, distinct from the pcg2d family used for clumping.
function treeRingHash(cellX: number, cellZ: number, salt: number, params: TreeRingAcceptParams): number {
  const seed = params.seed;
  const x = cellX + seed + salt;
  const z = cellZ + seed * 0.37 + salt * 1.17;
  const value = Math.sin(x * 41.3 + z * 289.1) * 43758.5453;
  return value - Math.floor(value);
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
