import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  float,
  mix,
  vec2,
  vec3,
} from "three/tsl";
import type { DressingClassId } from "../class_registry.js";
import { groundDebrisVisualProfile } from "./ground_debris_visuals.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

interface GroundDebrisRecordNodes {
  readonly positionScale: TslNode;
  readonly rotationEnvironment: TslNode;
}

export function applyGroundDebrisMaterial(
  material: MeshStandardNodeMaterial,
  classId: DressingClassId,
  record: GroundDebrisRecordNodes,
): boolean {
  const profile = groundDebrisVisualProfile(classId);
  if (!profile) return false;

  const base = linearColorNode(profile.baseColor);
  const wet = linearColorNode(profile.wetColor);
  const wetness: TslNode = clamp(record.rotationEnvironment.z, 0, 1);
  const variation: TslNode = record.rotationEnvironment.w.sub(0.5).mul(0.16).add(1);
  const distance: TslNode = vec2(cameraPosition.x, cameraPosition.z)
    .sub(record.positionScale.xz)
    .length();
  const fadeSpan = Math.max(0.001, profile.fadeEndM - profile.fadeStartM);
  const visibility: TslNode = clamp(
    float(profile.fadeEndM).sub(distance).div(fadeSpan),
    0,
    1,
  );
  const keep: TslNode = record.rotationEnvironment.w.lessThan(visibility);

  material.color.setRGB(1, 1, 1);
  material.colorNode = mix(base, wet, wetness).mul(variation);
  material.roughnessNode = mix(
    float(profile.dryRoughness),
    float(profile.wetRoughness),
    wetness,
  );
  material.maskNode = material.maskNode ? material.maskNode.and(keep) : keep;
  material.metalness = 0;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.alphaTest = 0;
  return true;
}

function linearColorNode(hex: number): TslNode {
  const color = new THREE.Color(hex).convertSRGBToLinear();
  return vec3(color.r, color.g, color.b);
}
