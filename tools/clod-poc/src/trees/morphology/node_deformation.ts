import {
  abs,
  attribute,
  clamp,
  cos,
  float,
  instanceIndex,
  max,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  sin,
  smoothstep,
  storage,
  uint,
  vec2,
  vec3,
} from "three/tsl";
import type { TreeRingInstanceBuffers } from "../tree_node_material.js";
import { TREE_SPECIES, type TreeSettings } from "../tree_config_types.js";
import { targetTreeHeight } from "../tree_geometry_types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type TreeMorphologyNode = any;

export interface TreeMorphologyRecordNodes {
  positionScale: TreeMorphologyNode;
  rotationNormalY: TreeMorphologyNode;
  identityBits: TreeMorphologyNode;
  morphology0: TreeMorphologyNode;
  morphology1: TreeMorphologyNode;
  morphology2: TreeMorphologyNode;
}

export interface TreeMorphologyDeformationNodes {
  position: TreeMorphologyNode;
  normal: TreeMorphologyNode;
  windScale: TreeMorphologyNode;
  flutterScale: TreeMorphologyNode;
  foliageRetention: TreeMorphologyNode;
}

export function treeMorphologyRecordNodes(buffers: TreeRingInstanceBuffers): TreeMorphologyRecordNodes {
  const records: TreeMorphologyNode = storage(buffers.cell, "vec4", buffers.capacity * 6).toReadOnly();
  const base: TreeMorphologyNode = instanceIndex.mul(6);
  return {
    positionScale: records.element(base),
    rotationNormalY: records.element(base.add(1)),
    identityBits: records.element(base.add(2)),
    morphology0: records.element(base.add(3)),
    morphology1: records.element(base.add(4)),
    morphology2: records.element(base.add(5)),
  };
}

export function treeMorphologyHash01Node(
  identityWords: TreeMorphologyNode,
  channel: TreeMorphologyNode,
): TreeMorphologyNode {
  const multiplier: TreeMorphologyNode = uint(1664525);
  const increment: TreeMorphologyNode = uint(1013904223);
  const a0: TreeMorphologyNode = identityWords.x.add(uint(40000)).add(channel.bitAnd(uint(0x3fff)));
  const b0: TreeMorphologyNode = identityWords.y.add(uint(40000)).add(channel.shiftRight(uint(14)).bitAnd(uint(0x3fff)));
  const a1: TreeMorphologyNode = a0.mul(multiplier).add(increment);
  const b1: TreeMorphologyNode = b0.mul(multiplier).add(increment);
  const a2: TreeMorphologyNode = a1.add(b1.mul(multiplier));
  const b2: TreeMorphologyNode = b1.add(a2.mul(multiplier));
  const a3: TreeMorphologyNode = a2.bitXor(a2.shiftRight(uint(16)));
  const b3: TreeMorphologyNode = b2.bitXor(b2.shiftRight(uint(16)));
  const a4: TreeMorphologyNode = a3.add(b3.mul(multiplier));
  const word: TreeMorphologyNode = a4.bitXor(a4.shiftRight(uint(16)));
  return float(word.bitAnd(uint(0xffffff))).div(16777216);
}

function clampTreeMorphologyVectorNode(
  value: TreeMorphologyNode,
  maximum: number,
): TreeMorphologyNode {
  const magnitude: TreeMorphologyNode = value.length();
  return magnitude.greaterThan(float(maximum)).select(
    value.mul(maximum).div(max(magnitude, float(0.000001))),
    value,
  );
}

export function treeMorphologyCrownStartNode(settings: TreeSettings): TreeMorphologyNode {
  const packedWind: TreeMorphologyNode = attribute("treeWind", "vec3");
  const speciesIndex: TreeMorphologyNode = packedWind.z;
  let crownStart: TreeMorphologyNode = float(0.4);
  for (let index = TREE_SPECIES.length - 1; index >= 0; index--) {
    const species = TREE_SPECIES[index]!;
    const config = settings.species[species];
    const ratio = clampNumber(config.trunkHeightM / Math.max(0.001, targetTreeHeight(species, config)), 0, 1);
    crownStart = abs(speciesIndex.sub(float(index))).lessThan(float(0.5)).select(float(ratio), crownStart);
  }
  return crownStart;
}

export function treeMorphologyDeformationNodes(
  morphology0: TreeMorphologyNode,
  morphology1: TreeMorphologyNode,
  morphology2: TreeMorphologyNode,
  crownStart01: TreeMorphologyNode,
): TreeMorphologyDeformationNodes {
  const height01: TreeMorphologyNode = clamp(attribute("treeHeight01", "float"), 0, 1);
  const radial01: TreeMorphologyNode = clamp(attribute("treeRadial01", "float"), 0, 1);
  const branchLevel: TreeMorphologyNode = clamp(attribute("treeBranchLevel", "float"), 0, 1);
  const branchPhase: TreeMorphologyNode = clamp(attribute("treeBranchPhase", "float"), 0, 1);
  const rootMask: TreeMorphologyNode = clamp(attribute("treeRootMask", "float"), 0, 1);
  const age: TreeMorphologyNode = clamp(morphology0.x, 0, 1);
  const lean: TreeMorphologyNode = clampTreeMorphologyVectorNode(morphology0.yz, 0.22);
  const health: TreeMorphologyNode = clamp(morphology0.w, 0, 1);
  const crownBias: TreeMorphologyNode = clampTreeMorphologyVectorNode(morphology1.xy, 0.35);
  const crownWidth: TreeMorphologyNode = clamp(morphology1.z, 0.82, 1.18);
  const crownFlattening: TreeMorphologyNode = clamp(morphology1.w, 0.82, 1.2);
  const branchDroop: TreeMorphologyNode = clamp(morphology2.x, -0.18, 0.32);
  const foliageDensity: TreeMorphologyNode = clamp(morphology2.y, 0.55, 1.15);
  const rootFlare: TreeMorphologyNode = clamp(morphology2.z, 0.75, 1.35);
  const stiffness: TreeMorphologyNode = clamp(morphology2.w, 0.65, 1.35);

  const safeHeight01: TreeMorphologyNode = max(height01, float(0.001));
  const safeRadial01: TreeMorphologyNode = max(radial01, float(0.001));
  const treeHeight: TreeMorphologyNode = max(abs(positionGeometry.y).div(safeHeight01), float(1));
  const crownRadius: TreeMorphologyNode = max(positionGeometry.xz.length().div(safeRadial01), float(0.5));
  const ageSmooth: TreeMorphologyNode = smoothstep(0, 1, age);
  const heightScale: TreeMorphologyNode = mix(0.72, 1.08, ageSmooth);
  const radiusScale: TreeMorphologyNode = mix(0.78, 1.12, age);
  const crownBlend: TreeMorphologyNode = smoothstep(crownStart01.sub(0.1), crownStart01, height01);
  const crownBiasWeight: TreeMorphologyNode = smoothstep(crownStart01, 1, height01);

  const ageX: TreeMorphologyNode = positionGeometry.x.mul(radiusScale);
  const ageY: TreeMorphologyNode = positionGeometry.y.mul(heightScale);
  const ageZ: TreeMorphologyNode = positionGeometry.z.mul(radiusScale);
  let local: TreeMorphologyNode = vec3(ageX, ageY, ageZ);
  local = vec3(
    local.x.mul(mix(1, crownWidth, crownBlend)),
    local.y.add(mix(0.08, -0.04, age).mul(treeHeight).mul(crownBlend)),
    local.z.mul(mix(1, crownWidth, crownBlend)),
  );
  const crownCenterY: TreeMorphologyNode = mix(crownStart01, 1, 0.5).mul(treeHeight).mul(heightScale);
  local = vec3(
    local.x,
    mix(local.y, crownCenterY.add(local.y.sub(crownCenterY).mul(crownFlattening)), crownBlend),
    local.z,
  );
  const flareScale: TreeMorphologyNode = mix(1, rootFlare, rootMask);
  local = vec3(local.x.mul(flareScale), local.y, local.z.mul(flareScale));

  const droopWeight: TreeMorphologyNode = branchLevel.mul(height01).mul(height01);
  const radialLength: TreeMorphologyNode = max(local.xz.length(), float(0.00001));
  const fallbackDirection: TreeMorphologyNode = vec2(
    cos(branchPhase.mul(6.28318530718)),
    sin(branchPhase.mul(6.28318530718)),
  );
  const radialDirection: TreeMorphologyNode = local.xz.length().greaterThan(float(0.00001))
    .select(local.xz.div(radialLength), fallbackDirection);
  const droopHorizontal: TreeMorphologyNode = radialDirection.mul(branchDroop).mul(droopWeight).mul(treeHeight).mul(0.18);
  local = vec3(
    local.x.add(droopHorizontal.x),
    local.y.sub(branchDroop.mul(droopWeight).mul(treeHeight)),
    local.z.add(droopHorizontal.y),
  );
  local = vec3(
    local.x.add(crownBias.x.mul(crownRadius).mul(crownBiasWeight)),
    local.y,
    local.z.add(crownBias.y.mul(crownRadius).mul(crownBiasWeight)),
  );
  const leanWeight: TreeMorphologyNode = height01.mul(height01);
  local = vec3(
    local.x.add(lean.x.mul(local.y).mul(leanWeight)),
    local.y,
    local.z.add(lean.y.mul(local.y).mul(leanWeight)),
  );

  const sourceNormal: TreeMorphologyNode = normalize(normalGeometry);
  const correctedNormal: TreeMorphologyNode = normalize(vec3(
    sourceNormal.x.div(max(radiusScale, float(0.001))),
    sourceNormal.y.div(max(heightScale, float(0.001)))
      .sub(lean.x.mul(3).mul(leanWeight).mul(sourceNormal.x))
      .sub(lean.y.mul(3).mul(leanWeight).mul(sourceNormal.z)),
    sourceNormal.z.div(max(radiusScale, float(0.001))),
  ));
  return {
    position: local,
    normal: correctedNormal,
    windScale: float(1).div(stiffness).mul(mix(0.85, 1.10, age)),
    flutterScale: mix(0.75, 1.05, health),
    foliageRetention: foliageDensity.mul(mix(0.72, 1.0, health)),
  };
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
