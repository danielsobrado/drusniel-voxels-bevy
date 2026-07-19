import * as THREE from "three";
import { DEFAULT_CAUSTICS_CONFIG } from "./causticsConfig.js";
import { registerSceneStyleApplier } from "../style/scene_style.js";
import {
  WATER_BODY_KIND_COUNT,
  waterBodyPresetsByKind,
  type WaterBodyVisualPresets,
} from "./water_body_presets.js";
import { publishWaterFoamDistanceFade } from "./water_foam_distance.js";
import type { WaterMaterialParams } from "./water_material_types.js";
import type { WaterRefractionConfig, WaterReflectionConfig } from "./waterConfig.js";

export interface WaterUniforms {
  uTime: { value: number };
  uShallowColor: { value: THREE.Color };
  uDeepColor: { value: THREE.Color };
  uFoamColor: { value: THREE.Color };
  uAlpha: { value: number };
  uRippleCycle: { value: number };
  uFresnelPower: { value: number };
  uRippleAmp: { value: number };
  uRippleSpeed: { value: number };
  uRippleScaleA: { value: number };
  uRippleScaleB: { value: number };
  uRippleStrengthA: { value: number };
  uRippleStrengthB: { value: number };
  uRippleLoopDistance: { value: number };
  uLakeBreeze: { value: THREE.Vector2 };
  uShoreFoamStart: { value: number };
  uShoreFoamEnd: { value: number };
  uShoreDistFoamStart: { value: number };
  uShoreDistFoamEnd: { value: number };
  uFoamDetailFadeStartM: { value: number };
  uFoamDetailFadeEndM: { value: number };
  uBodyShallow: { value: THREE.Vector3[] };
  uBodyDeep: { value: THREE.Vector3[] };
  uBodyAbsorption: { value: THREE.Vector3[] };
  uBodyExtra: { value: THREE.Vector2[] };
  uBodyScatterColor: { value: THREE.Vector3[] };
  uBodyScatterParams: { value: THREE.Vector3[] };
  uFoamNoiseScale: { value: number };
  uFoamShoreStrength: { value: number };
  uFoamRiverStrength: { value: number };
  uFoamSpeedStart: { value: number };
  uFoamSpeedEnd: { value: number };
  uFoamDropStart: { value: number };
  uFoamDropEnd: { value: number };
  uFresnelBase: { value: number };
  uFresnelNormalFlatten: { value: number };
  uDepthScale: { value: number };
  uTurbidity: { value: number };
  uGlitterEnabled: { value: number };
  uGlitterTightExponent: { value: number };
  uGlitterTightGain: { value: number };
  uGlitterBroadExponent: { value: number };
  uGlitterBroadGain: { value: number };
  uGlitterLowSunGain: { value: number };
  uClipmapTint: { value: number };
  uInnerRect: { value: THREE.Vector4 };
  uDebugMode: { value: number };
  uCameraPos: { value: THREE.Vector3 };
  uSunDir: { value: THREE.Vector3 };
  uWorldBounds: { value: THREE.Vector2 };
  uRefraction: WaterRefractionConfig;
  uReflection: WaterReflectionConfig;
  uCausticsEnabled: { value: number };
  uCausticsGain: { value: number };
  uCausticsScale: { value: number };
  uCausticsSpeed: { value: number };
}

export function syncWaterBodyUniformArrays(
  uniforms: Pick<
    WaterUniforms,
    | "uBodyShallow"
    | "uBodyDeep"
    | "uBodyAbsorption"
    | "uBodyExtra"
    | "uBodyScatterColor"
    | "uBodyScatterParams"
  >,
  bodies: WaterBodyVisualPresets,
): void {
  waterBodyPresetsByKind(bodies).forEach((preset, kind) => {
    uniforms.uBodyShallow.value[kind].set(...preset.shallowColor);
    uniforms.uBodyDeep.value[kind].set(...preset.deepColor);
    uniforms.uBodyAbsorption.value[kind].set(...preset.absorption);
    uniforms.uBodyExtra.value[kind].set(preset.turbidity, preset.reflectionDamping);
    uniforms.uBodyScatterColor.value[kind].set(...preset.scatterColor);
    uniforms.uBodyScatterParams.value[kind].set(
      preset.scatterExtinction,
      preset.scatterStrength,
      preset.scatterAmbient,
    );
  });
}

export function makeWaterUniforms(params: WaterMaterialParams): WaterUniforms {
  const visual = params.visual;
  const caustics = params.caustics ?? DEFAULT_CAUSTICS_CONFIG;
  const bodyArrays = createBodyUniformArrays();
  const foamDistance = publishWaterFoamDistanceFade(visual.foam);
  syncWaterBodyUniformArrays(bodyArrays, visual.bodies);

  const uniforms: WaterUniforms = {
    ...bodyArrays,
    uTime: { value: 0 },
    uShallowColor: { value: new THREE.Color(...visual.shallowColor) },
    uDeepColor: { value: new THREE.Color(...visual.deepColor) },
    uFoamColor: { value: new THREE.Color(...visual.foamColor) },
    uAlpha: { value: visual.alpha },
    uRippleCycle: { value: visual.rippleCycle },
    uFresnelPower: { value: visual.fresnel.power },
    uRippleAmp: { value: visual.rippleAmp },
    uRippleSpeed: { value: visual.rippleSpeed },
    uRippleScaleA: { value: visual.rippleScaleA },
    uRippleScaleB: { value: visual.rippleScaleB },
    uRippleStrengthA: { value: visual.rippleStrengthA },
    uRippleStrengthB: { value: visual.rippleStrengthB },
    uRippleLoopDistance: { value: visual.rippleLoopDistance },
    uLakeBreeze: { value: new THREE.Vector2(...visual.lakeBreeze) },
    uShoreFoamStart: { value: visual.shoreFoamStart },
    uShoreFoamEnd: { value: visual.shoreFoamEnd },
    uShoreDistFoamStart: { value: visual.foam.shoreDistanceStart },
    uShoreDistFoamEnd: { value: visual.foam.shoreDistanceEnd },
    uFoamDetailFadeStartM: { value: foamDistance.startM },
    uFoamDetailFadeEndM: { value: foamDistance.endM },
    uFoamNoiseScale: { value: visual.foam.noiseScale },
    uFoamShoreStrength: { value: visual.foam.shoreStrength },
    uFoamRiverStrength: { value: visual.foam.riverStrength },
    uFoamSpeedStart: { value: visual.foam.speedStart },
    uFoamSpeedEnd: { value: visual.foam.speedEnd },
    uFoamDropStart: { value: visual.foam.dropStart },
    uFoamDropEnd: { value: visual.foam.dropEnd },
    uFresnelBase: { value: visual.fresnel.base },
    uFresnelNormalFlatten: { value: visual.fresnel.normalFlatten },
    uDepthScale: { value: visual.color.depthScale },
    uTurbidity: { value: visual.color.turbidity },
    uGlitterEnabled: { value: visual.glitter.enabled ? 1 : 0 },
    uGlitterTightExponent: { value: visual.glitter.tightExponent },
    uGlitterTightGain: { value: visual.glitter.tightGain },
    uGlitterBroadExponent: { value: visual.glitter.broadExponent },
    uGlitterBroadGain: { value: visual.glitter.broadGain },
    uGlitterLowSunGain: { value: visual.glitter.lowSunGain },
    uClipmapTint: { value: 0 },
    uInnerRect: { value: new THREE.Vector4(0, 0, 0, 0) },
    uDebugMode: { value: params.debugMode },
    uCameraPos: { value: params.cameraPosition.clone() },
    uSunDir: { value: params.sunDirection.clone().normalize() },
    uWorldBounds: {
      value: new THREE.Vector2(params.worldBounds.cellsX, params.worldBounds.cellsZ),
    },
    uRefraction: { ...visual.refraction },
    uReflection: { ...visual.reflection },
    uCausticsEnabled: { value: caustics.enabled ? 1 : 0 },
    uCausticsGain: { value: caustics.gain },
    uCausticsScale: { value: caustics.scale },
    uCausticsSpeed: { value: caustics.speed },
  };

  // Scene style: the configured values stay the baseline; the applier restyles
  // this instance live and is applied once immediately so late-created water
  // materials come up matching the active preset.
  const styleBaseline = {
    foamShore: visual.foam.shoreStrength,
    normalFlatten: visual.fresnel.normalFlatten,
    glitterEnabled: visual.glitter.enabled ? 1 : 0,
  };
  registerSceneStyleApplier((preset) => {
    uniforms.uFoamShoreStrength.value = styleBaseline.foamShore * preset.water.foamShoreMul;
    uniforms.uFresnelNormalFlatten.value =
      styleBaseline.normalFlatten + (1 - styleBaseline.normalFlatten) * preset.water.normalFlattenPull;
    uniforms.uGlitterEnabled.value = preset.water.glitter ? styleBaseline.glitterEnabled : 0;
  });
  return uniforms;
}

function createBodyUniformArrays(): Pick<
  WaterUniforms,
  | "uBodyShallow"
  | "uBodyDeep"
  | "uBodyAbsorption"
  | "uBodyExtra"
  | "uBodyScatterColor"
  | "uBodyScatterParams"
> {
  return {
    uBodyShallow: {
      value: Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3()),
    },
    uBodyDeep: {
      value: Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3()),
    },
    uBodyAbsorption: {
      value: Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3()),
    },
    uBodyExtra: {
      value: Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector2()),
    },
    uBodyScatterColor: {
      value: Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3()),
    },
    uBodyScatterParams: {
      value: Array.from({ length: WATER_BODY_KIND_COUNT }, () => new THREE.Vector3()),
    },
  };
}
