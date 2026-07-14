import * as THREE from "three";
import {
  cameraPosition,
  clamp,
  dot,
  float,
  fract,
  instanceIndex,
  max,
  screenCoordinate,
  sin,
  storage,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import type { TreeLod, TreeSettings } from "./tree_config.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeRingInstanceBuffers } from "./tree_node_material.js";
import {
  TREE_RING_CELL_SIZE_M,
  TREE_RING_JITTER_X_SALT,
  TREE_RING_JITTER_Z_SALT,
} from "./tree_ring_placement.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

type DitherRole = "primary" | "secondary";

interface TreeRingCrossfadeState {
  active: boolean;
  fade: number;
  role: DitherRole;
}

interface NodeMaterialLike extends THREE.Material {
  maskNode?: TslNode;
}

interface CrossfadeUniforms {
  enabled: TslNode;
  near: TslNode;
  mid: TslNode;
  far: TslNode;
  halfBand: TslNode;
}

const LOD_ORDER: readonly TreeLod[] = ["near", "mid", "far", "impostor"];

export function decorateTreeRingLodCrossfade(
  handle: TreeMaterialHandle,
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  lod: TreeLod,
): TreeMaterialHandle {
  const uniforms = createCrossfadeUniforms(settings);
  const keep = createTreeRingCrossfadeKeepNode(settings, buffers, lod, uniforms);
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
  if (!settings.lod.crossfadeEnabled || !settings.lod.ditherEnabled) {
    return { active: true, fade: 1, role: "primary" };
  }
  const halfBand = Math.max(0, settings.lod.crossfadeBandM);
  if (halfBand <= 0) return { active: true, fade: 1, role: "primary" };
  const thresholds = treeRingThresholds(settings);
  const index = LOD_ORDER.indexOf(lod);
  const previousThreshold = index > 0 ? thresholds[index - 1] : null;
  const nextThreshold = index < LOD_ORDER.length - 1 ? thresholds[index] : null;

  if (previousThreshold !== null && inBand(distance, previousThreshold, halfBand)) {
    const fade = clamp01((distance - (previousThreshold - halfBand)) / (halfBand * 2));
    return { active: true, fade, role: "secondary" };
  }
  if (nextThreshold !== null && inBand(distance, nextThreshold, halfBand)) {
    const fade = 1 - clamp01((distance - (nextThreshold - halfBand)) / (halfBand * 2));
    return { active: true, fade, role: "primary" };
  }
  return { active: true, fade: 1, role: "primary" };
}

export function treeRingCrossfadeKeeps(noise: number, state: TreeRingCrossfadeState): boolean {
  const value = clamp01(noise);
  return state.role === "secondary" ? value >= 1 - state.fade : value < state.fade;
}

function createTreeRingCrossfadeKeepNode(
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  lod: TreeLod,
  uniforms: CrossfadeUniforms,
): TslNode {
  const cellStore: TslNode = storage(buffers.cell, "vec4", buffers.capacity).toReadOnly();
  const cell: TslNode = cellStore.element(instanceIndex);
  const worldCell: TslNode = cell.xy;
  const seed = uniform(settings.seed);
  const jitter: TslNode = vec2(
    treeRingHash(worldCell, seed, TREE_RING_JITTER_X_SALT),
    treeRingHash(worldCell, seed, TREE_RING_JITTER_Z_SALT),
  );
  const worldXZ: TslNode = worldCell.add(jitter).mul(TREE_RING_CELL_SIZE_M);
  const distance: TslNode = vec2(cameraPosition.x, cameraPosition.z).sub(worldXZ).length();
  const noise: TslNode = fract(
    fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189),
  );
  const thresholds = [uniforms.near, uniforms.mid, uniforms.far];
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
  return uniforms.enabled.greaterThan(0.5).select(keep, trueNode);
}

function createCrossfadeUniforms(settings: TreeSettings): CrossfadeUniforms {
  const distances = treeRingThresholds(settings);
  return {
    enabled: uniform(crossfadeEnabled(settings) ? 1 : 0),
    near: uniform(distances[0]),
    mid: uniform(distances[1]),
    far: uniform(distances[2]),
    halfBand: uniform(Math.max(0, settings.lod.crossfadeBandM)),
  };
}

function updateCrossfadeUniforms(uniforms: CrossfadeUniforms, settings: TreeSettings): void {
  const distances = treeRingThresholds(settings);
  uniforms.enabled.value = crossfadeEnabled(settings) ? 1 : 0;
  uniforms.near.value = distances[0];
  uniforms.mid.value = distances[1];
  uniforms.far.value = distances[2];
  uniforms.halfBand.value = Math.max(0, settings.lod.crossfadeBandM);
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
