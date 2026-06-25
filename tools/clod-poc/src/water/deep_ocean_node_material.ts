import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  clamp,
  cos,
  dot,
  float,
  Fn,
  fract,
  length,
  max,
  mix,
  normalize,
  pow,
  reflect,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
  positionWorld,
} from "three/tsl";
import {
  applyWaterVisual,
  makeWaterUniforms,
  type WaterUniforms,
} from "./waterMaterial.js";
import type { DeepOceanMaterialHandle, DeepOceanMaterialParams } from "./deep_ocean_material.js";
import type { WaterVisualConfig } from "./waterConfig.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export function createDeepOceanNodeMaterialImpl(params: DeepOceanMaterialParams): DeepOceanMaterialHandle {
  const u = makeWaterUniforms({
    visual: params.visual,
    debugMode: 0,
    sunDirection: params.sunDirection,
    cameraPosition: params.cameraPosition,
    worldBounds: { cellsX: 0, cellsZ: 0 },
  });

  const uTime = uniform(0) as TslNode;
  const uShallow = uniform(u.uShallowColor.value) as TslNode;
  const uDeep = uniform(u.uDeepColor.value) as TslNode;
  const uFoam = uniform(u.uFoamColor.value) as TslNode;
  const uHorizon = uniform((params.horizonColor ?? new THREE.Color(0.62, 0.74, 0.88)).clone()) as TslNode;
  const uAlpha = uniform(u.uAlpha.value) as TslNode;
  const uRippleCycle = uniform(u.uRippleCycle.value) as TslNode;
  const uFresnelPower = uniform(u.uFresnelPower.value) as TslNode;
  const uRippleSpeed = uniform(u.uRippleSpeed.value) as TslNode;
  const uRippleAmp = uniform(u.uRippleAmp.value) as TslNode;
  const uRippleScaleA = uniform(u.uRippleScaleA.value) as TslNode;
  const uRippleScaleB = uniform(u.uRippleScaleB.value) as TslNode;
  const uRippleStrengthA = uniform(u.uRippleStrengthA.value) as TslNode;
  const uRippleStrengthB = uniform(u.uRippleStrengthB.value) as TslNode;
  const uRippleLoopDistance = uniform(u.uRippleLoopDistance.value) as TslNode;
  const uLakeBreeze = uniform(u.uLakeBreeze.value) as TslNode;
  const uFresnelBase = uniform(u.uFresnelBase.value) as TslNode;
  const uFresnelNormalFlatten = uniform(u.uFresnelNormalFlatten.value) as TslNode;
  const uTurbidity = uniform(u.uTurbidity.value) as TslNode;
  const uCameraPos = uniform(u.uCameraPos.value) as TslNode;
  const uSunDir = uniform(u.uSunDir.value) as TslNode;
  const uFogDistance = uniform(Math.max(256, params.visual.rippleLoopDistance * 4)) as TslNode;

  const worldPos: TslNode = positionWorld;

  const fragment = Fn(() => {
    const breezeDir: TslNode = normalize(uLakeBreeze.add(vec2(0.00001, 0.0)));
    const breezeSpeed: TslNode = max(abs(uLakeBreeze.x), abs(uLakeBreeze.y));
    const advectSpeed: TslNode = breezeSpeed.mul(uRippleSpeed);
    const phaseA: TslNode = fract(uTime.mul(uRippleCycle));
    const phaseB: TslNode = fract(uTime.mul(uRippleCycle).add(0.5));
    const blend: TslNode = abs(phaseA.sub(0.5)).mul(2.0);
    const advectA: TslNode = breezeDir.mul(phaseA.mul(uRippleLoopDistance).mul(advectSpeed));
    const advectB: TslNode = breezeDir.mul(phaseB.mul(uRippleLoopDistance).mul(advectSpeed));
    const tau = 6.28318530718;
    const uvA: TslNode = worldPos.xz.mul(uRippleScaleA).add(advectA);
    const uvB: TslNode = worldPos.xz.mul(uRippleScaleB).add(advectB).add(vec2(17.31, -9.47));
    const gAx: TslNode = cos(uvA.x.add(phaseA.mul(tau))).mul(uRippleStrengthA)
      .add(cos(uvA.x.add(uvA.y).mul(0.73).sub(phaseA.mul(tau * 0.7))).mul(uRippleStrengthB));
    const gAz: TslNode = sin(uvA.y.sub(phaseA.mul(tau))).negate().mul(uRippleStrengthA)
      .add(cos(uvA.x.sub(uvA.y).mul(0.61).add(phaseA.mul(tau * 0.9))).mul(uRippleStrengthB));
    const gBx: TslNode = cos(uvB.x.add(phaseB.mul(tau))).mul(uRippleStrengthA)
      .add(cos(uvB.x.add(uvB.y).mul(0.73).sub(phaseB.mul(tau * 0.7))).mul(uRippleStrengthB));
    const gBz: TslNode = sin(uvB.y.sub(phaseB.mul(tau))).negate().mul(uRippleStrengthA)
      .add(cos(uvB.x.sub(uvB.y).mul(0.61).add(phaseB.mul(tau * 0.9))).mul(uRippleStrengthB));
    const grad: TslNode = mix(vec3(gAx, 0, gAz), vec3(gBx, 0, gBz), blend).mul(uRippleAmp);
    const normal: TslNode = normalize(vec3(grad.x.negate(), float(1.0), grad.z.negate()));

    const viewDir: TslNode = normalize(uCameraPos.sub(worldPos));
    const fresnelNormal: TslNode = normalize(mix(normal, vec3(0, 1, 0), uFresnelNormalFlatten));
    const fres: TslNode = uFresnelBase.add(
      float(1.0).sub(uFresnelBase).mul(pow(float(1.0).sub(max(dot(viewDir, fresnelNormal), float(0.0))), uFresnelPower)),
    );

    const waterColor: TslNode = mix(uShallow, uDeep, float(1.0));
    const tinted: TslNode = mix(waterColor, uShallow, uTurbidity.mul(0.2));
    const sunDir: TslNode = normalize(uSunDir);
    const reflDir: TslNode = reflect(sunDir.negate(), normal);
    const spec: TslNode = pow(max(dot(reflDir, viewDir), float(0.0)), float(48.0));
    const lit: TslNode = tinted.add(spec.mul(0.18)).add(fres.mul(0.12));

    const chopA: TslNode = sin(worldPos.x.mul(0.09).add(worldPos.z.mul(0.07)).add(uTime.mul(0.55))).mul(0.5).add(0.5);
    const chopB: TslNode = cos(worldPos.x.mul(0.06).sub(worldPos.z.mul(0.11)).sub(uTime.mul(0.41))).mul(0.5).add(0.5);
    const foamBlend: TslNode = mix(chopA, chopB, blend);
    const chop: TslNode = smoothstep(0.42, 0.88, foamBlend);
    const finalColor: TslNode = mix(lit, uFoam, chop.mul(0.35));

    const dist: TslNode = length(uCameraPos.xz.sub(worldPos.xz));
    const horizonLift: TslNode = smoothstep(0.02, 0.35, float(1.0).sub(abs(viewDir.y)));
    const distFog: TslNode = smoothstep(uFogDistance.mul(0.35), uFogDistance, dist);
    const fog: TslNode = clamp(max(horizonLift.mul(0.55), distFog.mul(0.65)), 0.0, 1.0);
    const fogged: TslNode = mix(finalColor, uHorizon, fog);
    const alpha: TslNode = clamp(uAlpha.add(fres.mul(0.14)), 0.0, 1.0);
    return vec4(fogged, alpha);
  })();

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: params.visual.depthWrite,
    side: THREE.DoubleSide,
  });
  material.name = "deep-ocean-node";
  material.colorNode = fragment;

  const uniforms: WaterUniforms & {
    uHorizonColor: { value: THREE.Color };
    uFogDistance: { value: number };
  } = {
    ...u,
    uHorizonColor: { value: (params.horizonColor ?? new THREE.Color(0.62, 0.74, 0.88)).clone() },
    uFogDistance: { value: Math.max(256, params.visual.rippleLoopDistance * 4) },
  };

  return {
    material,
    setTime: (t) => { uniforms.uTime.value = t; uTime.value = t; },
    updateCamera: (pos) => { uniforms.uCameraPos.value.copy(pos); uCameraPos.value.copy(pos); },
    updateSunDirection: (dir) => { uniforms.uSunDir.value.copy(dir).normalize(); uSunDir.value.copy(dir).normalize(); },
    updateHorizonColor: (color) => { uniforms.uHorizonColor.value.copy(color); uHorizon.value.copy(color); },
    updateVisual: (visual: WaterVisualConfig) => {
      applyWaterVisual(uniforms, visual);
      uShallow.value.copy(uniforms.uShallowColor.value);
      uDeep.value.copy(uniforms.uDeepColor.value);
      uFoam.value.copy(uniforms.uFoamColor.value);
      uAlpha.value = uniforms.uAlpha.value;
      uRippleCycle.value = uniforms.uRippleCycle.value;
      uFresnelPower.value = uniforms.uFresnelPower.value;
      uRippleSpeed.value = uniforms.uRippleSpeed.value;
      uRippleAmp.value = uniforms.uRippleAmp.value;
      uRippleScaleA.value = uniforms.uRippleScaleA.value;
      uRippleScaleB.value = uniforms.uRippleScaleB.value;
      uRippleStrengthA.value = uniforms.uRippleStrengthA.value;
      uRippleStrengthB.value = uniforms.uRippleStrengthB.value;
      uRippleLoopDistance.value = uniforms.uRippleLoopDistance.value;
      uLakeBreeze.value.copy(uniforms.uLakeBreeze.value);
      uFresnelBase.value = uniforms.uFresnelBase.value;
      uFresnelNormalFlatten.value = uniforms.uFresnelNormalFlatten.value;
      uTurbidity.value = uniforms.uTurbidity.value;
      uniforms.uFogDistance.value = Math.max(256, visual.rippleLoopDistance * 4);
      uFogDistance.value = uniforms.uFogDistance.value;
      material.depthWrite = visual.depthWrite;
      material.needsUpdate = true;
    },
    dispose: () => { material.dispose(); },
  };
}
