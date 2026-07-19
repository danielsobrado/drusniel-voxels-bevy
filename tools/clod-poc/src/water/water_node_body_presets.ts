// TSL side of the per-body-kind water presets, shared by the perf and HQ WebGPU
// materials so colour, absorption, and suspended-scatter behavior cannot drift.
import * as THREE from "three";
import { clamp, float, floor, fract, int, mix, smoothstep, uniformArray } from "three/tsl";
import {
  WATER_BODY_KIND_COUNT,
  waterBodyPresetsByKind,
  type WaterBodyVisualPresets,
} from "./water_body_presets.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface WaterBodyPresetNodes {
  shallow: TslNode;
  deep: TslNode;
  absorption: TslNode;
  turbidity: TslNode;
  reflectionDamping: TslNode;
  scatterColor: TslNode;
  scatterExtinction: TslNode;
  scatterStrength: TslNode;
  scatterAmbient: TslNode;
  sync(presets: WaterBodyVisualPresets): void;
}

export function buildWaterBodyPresetNodes(bodyKind: TslNode, presets: WaterBodyVisualPresets): WaterBodyPresetNodes {
  const shallowValues = Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3());
  const deepValues = Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3());
  const absorptionValues = Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3());
  const extraValues = Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector2());
  const scatterColorValues = Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3());
  const scatterParamValues = Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3());
  const sync = (next: WaterBodyVisualPresets): void => {
    waterBodyPresetsByKind(next).forEach((preset, kind) => {
      shallowValues[kind].set(preset.shallowColor[0], preset.shallowColor[1], preset.shallowColor[2]);
      deepValues[kind].set(preset.deepColor[0], preset.deepColor[1], preset.deepColor[2]);
      absorptionValues[kind].set(preset.absorption[0], preset.absorption[1], preset.absorption[2]);
      extraValues[kind].set(preset.turbidity, preset.reflectionDamping);
      scatterColorValues[kind].set(preset.scatterColor[0], preset.scatterColor[1], preset.scatterColor[2]);
      scatterParamValues[kind].set(preset.scatterExtinction, preset.scatterStrength, preset.scatterAmbient);
    });
  };
  sync(presets);

  const uShallow = uniformArray(shallowValues) as TslNode;
  const uDeep = uniformArray(deepValues) as TslNode;
  const uAbsorption = uniformArray(absorptionValues) as TslNode;
  const uExtra = uniformArray(extraValues) as TslNode;
  const uScatterColor = uniformArray(scatterColorValues) as TslNode;
  const uScatterParams = uniformArray(scatterParamValues) as TslNode;

  const k: TslNode = clamp(bodyKind, float(0), float(WATER_BODY_KIND_COUNT - 1));
  const k0: TslNode = int(floor(k));
  const k1: TslNode = int(floor(k).add(1).min(float(WATER_BODY_KIND_COUNT - 1)));
  const kt: TslNode = smoothstep(float(0.35), float(0.65), fract(k));
  const blend = (arr: TslNode): TslNode => mix(arr.element(k0), arr.element(k1), kt);
  const extra: TslNode = blend(uExtra);
  const scatterParams: TslNode = blend(uScatterParams);

  return {
    shallow: blend(uShallow),
    deep: blend(uDeep),
    absorption: blend(uAbsorption),
    turbidity: extra.x,
    reflectionDamping: extra.y,
    scatterColor: blend(uScatterColor),
    scatterExtinction: scatterParams.x,
    scatterStrength: scatterParams.y,
    scatterAmbient: scatterParams.z,
    sync,
  };
}
