import * as THREE from "three";
import type { WaterVisualConfig } from "./waterConfig.js";
import type { WaterMaterialParams, WaterMaterialHandle } from "./water_material_types.js";
import { makeWaterUniforms, WATER_VERT, WATER_FRAG, type WaterUniforms } from "./water_material_uniforms.js";

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
}

export function createWaterShaderMaterial(params: WaterMaterialParams): WaterMaterialHandle {
  const uniforms = makeWaterUniforms(params);
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms as unknown as THREE.ShaderMaterial["uniforms"],
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthTest: true,
    depthWrite: params.visual.depthWrite,
    side: THREE.DoubleSide,
  });
  material.name = "water-shader";
  return {
    material,
    setTime: (t) => { uniforms.uTime.value = t; },
    setDebugMode: (mode) => { uniforms.uDebugMode.value = mode; },
    setInnerRect: (minX, minZ, maxX, maxZ) => { uniforms.uInnerRect.value.set(minX, minZ, maxX, maxZ); },
    setLevelId: () => {},
    setClipmapTint: (enabled) => { uniforms.uClipmapTint.value = enabled ? 1 : 0; },
    setWireframe: (enabled) => { material.wireframe = enabled; },
    updateCamera: (pos) => { uniforms.uCameraPos.value.copy(pos); },
    updateSunDirection: (dir) => { uniforms.uSunDir.value.copy(dir).normalize(); },
    updateVisual: (v) => {
      applyWaterVisual(uniforms, v);
      material.depthWrite = v.depthWrite;
      material.needsUpdate = true;
    },
    dispose: () => { material.dispose(); },
  };
}
