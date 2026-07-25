import * as THREE from "three";
import {
  cameraPosition,
  clamp,
  dot,
  float,
  floor,
  fract,
  max,
  sin,
  uniform,
  vec2,
} from "three/tsl";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import type { TreeLod, TreeSettings } from "./tree_config.js";
import { treeLodCrossfadeHalfBandM } from "./tree_lod_transition.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeRingInstanceBuffers } from "./tree_node_material.js";
import { TREE_RING_CELL_SIZE_M } from "./tree_ring_placement.js";
import { treeRingRecordField, treeRingRecords } from "./tree_ring_record_access.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export type TreeRingDitherRole = "primary" | "secondary";

export interface TreeRingCrossfadeState {
  fade: number;
  role: TreeRingDitherRole;
}

interface NodeMaterialLike extends THREE.Material {
  maskNode?: TslNode;
}

interface CrossfadeUniforms {
  enabled: TslNode;
  seed: TslNode;
  near: TslNode;
  mid: TslNode;
  far: TslNode;
  halfBand: TslNode;
  canopyStart: TslNode;
  canopyEnd: TslNode;
}

const LOD_ORDER: readonly TreeLod[] = ["near", "mid", "far", "impostor"];
const TREE_RING_LOD_DITHER_SALT = 1601;

export function decorateTreeRingLodCrossfade(
  handle: TreeMaterialHandle,
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  lod: TreeLod,
): TreeMaterialHandle {
  const uniforms = createCrossfadeUniforms(settings);
  const keep = createTreeRingCrossfadeKeepNode(buffers, lod, uniforms);
  const materials = [handle.regularMaterial, ...Object.values(handle.debugMaterials)]
    .filter((material, index, all) => all.indexOf(material) === index) as NodeMaterialLike[];

  for (const material of materials) {
    material.maskNode = material.maskNode ? material.maskNode.and(keep) : keep;
  }

  const originalPrepass = handle.prepassNodesFor?.bind(handle);
  const originalUpdateSettings = handle.updateSettings.bind(handle);
  handle.prepassNodesFor = (prepassLod: TreeLod): PrepassNodes | undefined => {
    const nodes = originalPrepass?.(prepassLod);
    if (!nodes) return undefined;
    const maskNode = nodes.maskNode as TslNode | undefined;
    return { ...nodes, maskNode: maskNode ? maskNode.and(keep) : keep };
  };
  handle.updateSettings = (next: TreeSettings): void => {
    originalUpdateSettings(next);
    updateCrossfadeUniforms(uniforms, next);
  };
  return handle;
}

export function treeRingCrossfadeState(
  distance: number,
  lod: TreeLod,
  settings: TreeSettings,
): TreeRingCrossfadeState {
  if (!crossfadeEnabled(settings)) return { fade: 1, role: "primary" };
  const halfBand = treeLodCrossfadeHalfBandM(settings);
  const thresholds = treeRingThresholds(settings);
  const index = LOD_ORDER.indexOf(lod);
  const previousThreshold = index > 0 ? thresholds[index - 1] : null;
  const nextThreshold = index < LOD_ORDER.length - 1 ? thresholds[index] : null;

  if (previousThreshold !== null && inBand(distance, previousThreshold, halfBand)) {
    const fade = clamp01((distance - (previousThreshold - halfBand)) / (halfBand * 2));
    return { fade, role: "secondary" };
  }
  if (nextThreshold !== null && inBand(distance, nextThreshold, halfBand)) {
    const fade = 1 - clamp01((distance - (nextThreshold - halfBand)) / (halfBand * 2));
    return { fade, role: "primary" };
  }
  return { fade: 1, role: "primary" };
}

export function treeRingCrossfadeKeeps(noise: number, state: TreeRingCrossfadeState): boolean {
  const value = clamp01(noise);
  return state.role === "secondary" ? value >= 1 - state.fade : value < state.fade;
}

export function treeRingStableDitherNoise(cellX: number, cellZ: number, seed: number): number {
  const salt = TREE_RING_LOD_DITHER_SALT;
  const x = cellX + seed + salt;
  const z = cellZ + seed * 0.37 + salt * 1.17;
  return fractNumber(Math.sin(x * 41.3 + z * 289.1) * 43758.5453);
}

function createTreeRingCrossfadeKeepNode(
  buffers: TreeRingInstanceBuffers,
  lod: TreeLod,
  uniforms: CrossfadeUniforms,
): TslNode {
  // The ring buffer holds TREE_RING_INSTANCE_VEC4S vec4s per tree record; position_scale
  // is field 0 and already carries the jittered world position. Reading it with a stride
  // of one returned a neighbouring record's fields as this tree's cell, and the compute
  // reassigns slots via atomicAdd every dispatch, so both the LOD distance and the dither
  // noise were recomputed from data that moved each frame — the per-frame blink.
  const records: TslNode = treeRingRecords(buffers.cell, buffers.capacity);
  const positionScale: TslNode = treeRingRecordField(records, "positionScale");
  const worldXZ: TslNode = positionScale.xz;
  // Recover the placement cell so the dither hash stays stable per tree: the compute
  // derives world position as (cell + jitter) * cellSize with jitter in [0,1).
  const worldCell: TslNode = floor(worldXZ.div(TREE_RING_CELL_SIZE_M));
  const distance: TslNode = vec2(cameraPosition.x, cameraPosition.z).sub(worldXZ).length();
  const noise: TslNode = treeRingHash(worldCell, uniforms.seed, TREE_RING_LOD_DITHER_SALT);
  const thresholds: readonly [TslNode, TslNode, TslNode] = [uniforms.near, uniforms.mid, uniforms.far];
  const index = LOD_ORDER.indexOf(lod);
  const previousThreshold = index > 0 ? thresholds[index - 1] : null;
  const nextThreshold = index < LOD_ORDER.length - 1 ? thresholds[index] : null;
  const span: TslNode = max(uniforms.halfBand.mul(2), float(0.001));
  const trueNode: TslNode = float(1).greaterThan(0);
  let keep: TslNode = trueNode;

  if (nextThreshold) {
    const start: TslNode = nextThreshold.sub(uniforms.halfBand);
    const end: TslNode = nextThreshold.add(uniforms.halfBand);
    const active: TslNode = distance.greaterThanEqual(start).and(distance.lessThanEqual(end));
    const transition: TslNode = clamp(distance.sub(start).div(span), 0, 1);
    const exitKeep: TslNode = noise.lessThan(float(1).sub(transition));
    keep = active.select(exitKeep, keep);
  }
  if (previousThreshold) {
    const start: TslNode = previousThreshold.sub(uniforms.halfBand);
    const end: TslNode = previousThreshold.add(uniforms.halfBand);
    const active: TslNode = distance.greaterThanEqual(start).and(distance.lessThanEqual(end));
    const transition: TslNode = clamp(distance.sub(start).div(span), 0, 1);
    const entryKeep: TslNode = noise.greaterThanEqual(float(1).sub(transition));
    keep = active.select(entryKeep, keep);
  }
  let result: TslNode = uniforms.enabled.greaterThan(0.5).select(keep, trueNode);
  if (lod === "impostor") {
    const canopySpan: TslNode = max(uniforms.canopyEnd.sub(uniforms.canopyStart), float(0.001));
    const t: TslNode = clamp(distance.sub(uniforms.canopyStart).div(canopySpan), 0, 1);
    const canopyFade: TslNode = t.mul(t).mul(float(3).sub(t.mul(2)));
    const impostorVisibility: TslNode = float(1).sub(canopyFade);
    const canopyActive: TslNode = distance.greaterThanEqual(uniforms.canopyStart);
    const canopyKeep: TslNode = noise.lessThan(impostorVisibility);
    result = canopyActive.select(result.and(canopyKeep), result);
  }
  return result;
}

function createCrossfadeUniforms(settings: TreeSettings): CrossfadeUniforms {
  const distances = treeRingThresholds(settings);
  return {
    enabled: uniform(crossfadeEnabled(settings) ? 1 : 0),
    seed: uniform(settings.seed),
    near: uniform(distances[0]),
    mid: uniform(distances[1]),
    far: uniform(distances[2]),
    halfBand: uniform(treeLodCrossfadeHalfBandM(settings)),
    canopyStart: uniform(settings.lod.canopyFadeStartM),
    canopyEnd: uniform(settings.lod.canopyFadeEndM),
  };
}

function updateCrossfadeUniforms(uniforms: CrossfadeUniforms, settings: TreeSettings): void {
  const distances = treeRingThresholds(settings);
  uniforms.enabled.value = crossfadeEnabled(settings) ? 1 : 0;
  uniforms.seed.value = settings.seed;
  uniforms.near.value = distances[0];
  uniforms.mid.value = distances[1];
  uniforms.far.value = distances[2];
  uniforms.halfBand.value = treeLodCrossfadeHalfBandM(settings);
  uniforms.canopyStart.value = settings.lod.canopyFadeStartM;
  uniforms.canopyEnd.value = settings.lod.canopyFadeEndM;
}

function treeRingThresholds(settings: TreeSettings): readonly [number, number, number] {
  return [
    settings.distanceM * settings.lod.nearFraction,
    settings.distanceM * settings.lod.midFraction,
    settings.distanceM * settings.lod.farFraction,
  ];
}

function crossfadeEnabled(settings: TreeSettings): boolean {
  return settings.lod.crossfadeEnabled && settings.lod.ditherEnabled && settings.lod.crossfadeBandM > 0;
}

function inBand(distance: number, threshold: number, halfBand: number): boolean {
  return distance >= threshold - halfBand && distance <= threshold + halfBand;
}

function treeRingHash(cell: TslNode, seed: TslNode, saltValue: number): TslNode {
  const salt = float(saltValue);
  return fract(
    sin(dot(
      cell.add(vec2(seed.add(salt), seed.mul(0.37).add(salt.mul(1.17)))),
      vec2(41.3, 289.1),
    )).mul(43758.5453),
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function fractNumber(value: number): number {
  return value - Math.floor(value);
}
