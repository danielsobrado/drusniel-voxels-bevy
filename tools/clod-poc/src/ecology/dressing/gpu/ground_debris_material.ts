import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three/webgpu";
import {
  cameraPosition,
  clamp,
  float,
  max,
  mix,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import { buildSunLightGpuAtlasNodes } from "../../../terrain/sun_visibility/sun_light_gpu_atlas_nodes.js";
import type { DressingClassId } from "../class_registry.js";
import { groundDebrisBiomePolicy } from "./ground_debris_biome_policy.js";
import { groundDebrisBiomeUniforms } from "./ground_debris_biome_state.js";
import { groundDebrisVisualProfile } from "./ground_debris_visuals.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const MIN_SUN_VISIBILITY_RESPONSE = 0.78;
const SNOW_FADE_M = 80;
const FROST_ROUGHNESS = 0.94;

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
  const biomePolicy = groundDebrisBiomePolicy(classId);
  if (!profile || !biomePolicy) return false;

  const biome = groundDebrisBiomeUniforms();
  const base = linearColorNode(profile.baseColor);
  const wet = linearColorNode(profile.wetColor);
  const instanceWetness: TslNode = clamp(record.rotationEnvironment.z, 0, 1);
  const biomeDew: TslNode = biome.dew.mul(biomePolicy.dewStrength).mul(biome.enabled);
  const wetness: TslNode = max(instanceWetness, biomeDew);
  const altitudeSnow: TslNode = smoothstep(
    biome.snowlineM.sub(SNOW_FADE_M),
    biome.snowlineM.add(SNOW_FADE_M),
    record.positionScale.y,
  ).mul(biome.enabled);
  const frost: TslNode = max(biome.frost.mul(biome.enabled), altitudeSnow)
    .mul(biomePolicy.frostStrength);
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
  const sunVisibility = buildSunLightGpuAtlasNodes(record.positionScale.xz).visibility;
  const sunResponse: TslNode = mix(
    float(MIN_SUN_VISIBILITY_RESPONSE),
    float(1),
    sunVisibility,
  );

  let seasonalColor: TslNode = mix(base, wet, wetness);
  if (biomePolicy.autumnStrength > 0) {
    const autumnTint: TslNode = seasonalColor.mul(vec3(1.10, 0.76, 0.42));
    seasonalColor = mix(
      seasonalColor,
      autumnTint,
      biome.autumn.mul(biomePolicy.autumnStrength).mul(biome.enabled),
    );
  }
  seasonalColor = mix(seasonalColor, vec3(0.80, 0.90, 0.98), frost);

  let roughness: TslNode = mix(
    float(profile.dryRoughness),
    float(profile.wetRoughness),
    wetness,
  );
  roughness = mix(roughness, float(FROST_ROUGHNESS), frost);

  material.color.setRGB(1, 1, 1);
  material.colorNode = seasonalColor.mul(variation).mul(sunResponse);
  material.roughnessNode = roughness;
  material.maskNode = material.maskNode ? (material.maskNode as TslNode).and(keep) : keep;
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
