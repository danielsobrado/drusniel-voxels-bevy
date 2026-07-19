import * as THREE from "three";
import type { WaterVisualConfig } from "./waterConfig.js";
import type { WaterMaterialParams, WaterMaterialHandle } from "./water_material_types.js";
import { makeWaterUniforms, syncWaterBodyUniformArrays, WATER_VERT, WATER_FRAG, type WaterUniforms } from "./water_material_uniforms.js";
import {
  materialChurnDiagnostics,
  setMaterialNeedsUpdate,
  setPipelineSensitiveMaterialProperty,
} from "../rendering/material_churn/material_churn_diagnostics.js";
import { trackedShaderMaterial } from "../rendering/material_churn/tracked_material_factory.js";

export type { WaterMaterialParams, WaterMaterialHandle } from "./water_material_types.js";
export { makeWaterUniforms, waterLevelColor, type WaterUniforms } from "./water_material_uniforms.js";

export function applyWaterVisual(uniforms: WaterUniforms, v: WaterVisualConfig): void {
  uniforms.uShallowColor.value.setRGB(v.shallowColor[0], v.shallowColor[1], v.shallowColor[2]);
  uniforms.uDeepColor.value.setRGB(v.deepColor[0], v.deepColor[1], v.deepColor[2]);
  uniforms.uFoamColor.value.setRGB(v.foamColor[0], v.foamColor[1], v.foamColor[2]);
  uniforms.uAlpha.value = v.alpha;
  uniforms.uRippleCycle.value = v.rippleCycle;
  uniforms.uFresnelPower.value = v.fresnel.power;
  uniforms.uRippleAmp.value = v.rippleAmp;
  uniforms.uRippleSpeed.value = v.rippleSpeed;
  uniforms.uRippleScaleA.value = v.rippleScaleA;
  uniforms.uRippleScaleB.value = v.rippleScaleB;
  uniforms.uRippleStrengthA.value = v.rippleStrengthA;
  uniforms.uRippleStrengthB.value = v.rippleStrengthB;
  uniforms.uRippleLoopDistance.value = v.rippleLoopDistance;
  uniforms.uLakeBreeze.value.set(v.lakeBreeze[0], v.lakeBreeze[1]);
  uniforms.uShoreFoamStart.value = v.shoreFoamStart;
  uniforms.uShoreFoamEnd.value = v.shoreFoamEnd;
  uniforms.uShoreDistFoamStart.value = v.foam.shoreDistanceStart;
  uniforms.uShoreDistFoamEnd.value = v.foam.shoreDistanceEnd;
  syncWaterBodyUniformArrays(uniforms, v.bodies);
  uniforms.uFoamNoiseScale.value = v.foam.noiseScale;
  uniforms.uFoamShoreStrength.value = v.foam.shoreStrength;
  uniforms.uFoamRiverStrength.value = v.foam.riverStrength;
  uniforms.uFoamSpeedStart.value = v.foam.speedStart;
  uniforms.uFoamSpeedEnd.value = v.foam.speedEnd;
  uniforms.uFoamDropStart.value = v.foam.dropStart;
  uniforms.uFoamDropEnd.value = v.foam.dropEnd;
  uniforms.uFresnelBase.value = v.fresnel.base;
  uniforms.uFresnelNormalFlatten.value = v.fresnel.normalFlatten;
  uniforms.uDepthScale.value = v.color.depthScale;
  uniforms.uTurbidity.value = v.color.turbidity;
  uniforms.uGlitterEnabled.value = v.glitter.enabled ? 1 : 0;
  uniforms.uGlitterTightExponent.value = v.glitter.tightExponent;
  uniforms.uGlitterTightGain.value = v.glitter.tightGain;
  uniforms.uGlitterBroadExponent.value = v.glitter.broadExponent;
  uniforms.uGlitterBroadGain.value = v.glitter.broadGain;
  uniforms.uGlitterLowSunGain.value = v.glitter.lowSunGain;
  Object.assign(uniforms.uRefraction, v.refraction);
  Object.assign(uniforms.uReflection, v.reflection);
}

export function createWaterShaderMaterial(params: WaterMaterialParams): WaterMaterialHandle {
  const uniforms = makeWaterUniforms(params);
  const material = trackedShaderMaterial({
    uniforms: uniforms as unknown as THREE.ShaderMaterial["uniforms"],
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthTest: true,
    depthWrite: params.visual.depthWrite,
    side: THREE.DoubleSide,
  }, "water-shader-material");
  material.name = "water-shader";
  return {
    material,
    setTime: (t) => { uniforms.uTime.value = t; },
    setDebugMode: (mode) => { uniforms.uDebugMode.value = mode; },
    setInnerRect: (minX, minZ, maxX, maxZ) => { uniforms.uInnerRect.value.set(minX, minZ, maxX, maxZ); },
    setLevelId: () => {},
    setClipmapTint: (enabled) => { uniforms.uClipmapTint.value = enabled ? 1 : 0; },
    setWireframe: (enabled) => {
      setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "wireframe", enabled, "water-wireframe");
    },
    updateCamera: (pos) => { uniforms.uCameraPos.value.copy(pos); },
    updateSunDirection: (dir) => { uniforms.uSunDir.value.copy(dir).normalize(); },
    updateVisual: (v) => {
      applyWaterVisual(uniforms, v);
      if (setPipelineSensitiveMaterialProperty(materialChurnDiagnostics, material, "depthWrite", v.depthWrite, "water-depth-write")) {
        setMaterialNeedsUpdate(materialChurnDiagnostics, material, "water-depth-write");
      }
    },
    dispose: () => { material.dispose(); },
  };
}
