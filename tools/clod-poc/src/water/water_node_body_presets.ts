// TSL side of the per-body-kind water presets (Phase 7b), shared by the perf and HQ
// WebGPU materials so per-kind colour/absorption behaviour cannot drift between them.
//
// The interpolated body-kind value blends presets of the two adjacent kinds across a
// body boundary (fract window 0.35..0.65 ≈ the old pondWeight smoothstep), and reads
// exact presets inside a body where the attribute is constant.
//
// Only imported from the WebGPU-only material modules (keeps three/tsl out of the
// WebGL bundle).
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
  /** Preset shallow/deep colours for this fragment's body kind. */
  shallow: TslNode;
  deep: TslNode;
  /** Beer–Lambert extinction per metre (vec3). */
  absorption: TslNode;
  turbidity: TslNode;
  reflectionDamping: TslNode;
  /** Re-sync uniform arrays after a visual-config update. */
  sync(presets: WaterBodyVisualPresets): void;
}

export function buildWaterBodyPresetNodes(bodyKind: TslNode, presets: WaterBodyVisualPresets): WaterBodyPresetNodes {
  const shallowValues = Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3());
  const deepValues = Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3());
  const absorptionValues = Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3());
  const extraValues = Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector2());
  const sync = (next: WaterBodyVisualPresets): void => {
    waterBodyPresetsByKind(next).forEach((preset, kind) => {
      shallowValues[kind].set(preset.shallowColor[0], preset.shallowColor[1], preset.shallowColor[2]);
      deepValues[kind].set(preset.deepColor[0], preset.deepColor[1], preset.deepColor[2]);
      absorptionValues[kind].set(preset.absorption[0], preset.absorption[1], preset.absorption[2]);
      extraValues[kind].set(preset.turbidity, preset.reflectionDamping);
    });
  };
  sync(presets);

  const uShallow = uniformArray(shallowValues) as TslNode;
  const uDeep = uniformArray(deepValues) as TslNode;
  const uAbsorption = uniformArray(absorptionValues) as TslNode;
  const uExtra = uniformArray(extraValues) as TslNode;

  const k: TslNode = clamp(bodyKind, float(0), float(WATER_BODY_KIND_COUNT - 1));
  const k0: TslNode = int(floor(k));
  const k1: TslNode = int(floor(k).add(1).min(float(WATER_BODY_KIND_COUNT - 1)));
  const kt: TslNode = smoothstep(float(0.35), float(0.65), fract(k));
  const blend = (arr: TslNode): TslNode => mix(arr.element(k0), arr.element(k1), kt);

  const extra: TslNode = blend(uExtra);
  return {
    shallow: blend(uShallow),
    deep: blend(uDeep),
    absorption: blend(uAbsorption),
    turbidity: extra.x,
    reflectionDamping: extra.y,
    sync,
  };
}
