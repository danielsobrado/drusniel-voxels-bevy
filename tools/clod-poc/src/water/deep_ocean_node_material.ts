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
  positionGeometry,
  pow,
  reflect,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { DEEP_OCEAN_GPU_WAVES, type DeepOceanGpuWave } from "./deep_ocean_waves.js";
import { applyWaterVisual, makeWaterUniforms, type WaterUniforms } from "./waterMaterial.js";
import type { DeepOceanMaterialHandle, DeepOceanMaterialParams } from "./deep_ocean_material_v2.js";
import type { WaterVisualConfig } from "./waterConfig.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const PERF_WAVE_COUNT = 8;

function queryFlag(keys: readonly string[]): boolean {
  const maybeWindow = globalThis as typeof globalThis & { location?: { search?: string } };
  const params = new URLSearchParams(maybeWindow.location?.search ?? "");
  return keys.some((key) => {
    const raw = params.get(key);
    return raw === "1" || raw === "true" || raw === "high";
  });
}

function selectedWaves(): readonly DeepOceanGpuWave[] {
  if (queryFlag(["oceanHq", "deepOceanHq", "waterHq"])) return DEEP_OCEAN_GPU_WAVES;
  return DEEP_OCEAN_GPU_WAVES.slice(0, PERF_WAVE_COUNT);
}

function colorUniform(color: readonly [number, number, number]): THREE.Color {
  return new THREE.Color(color[0], color[1], color[2]);
}

export function createDeepOceanNodeMaterialImpl(params: DeepOceanMaterialParams): DeepOceanMaterialHandle {
  const u = makeWaterUniforms({
    visual: params.visual,
    debugMode: 0,
    sunDirection: params.sunDirection,
    cameraPosition: params.cameraPosition,
    worldBounds: { cellsX: 0, cellsZ: 0 },
  });

  const uTime = uniform(0) as TslNode;
  const uDeep = uniform(u.uDeepColor.value) as TslNode;
  const uShallow = uniform(u.uShallowColor.value) as TslNode;
  const uFoam = uniform(u.uFoamColor.value) as TslNode;
  const uHorizon = uniform((params.horizonColor ?? colorUniform(params.shading.fogColor)).clone()) as TslNode;
  const uSkyZenith = uniform(colorUniform(params.shading.skyZenithColor)) as TslNode;
  const uSssColor = uniform(colorUniform(params.shading.sssColor)) as TslNode;
  const uSssStrength = uniform(Math.max(0, params.shading.sssStrength)) as TslNode;
  const uFresnelNormalFlatten = uniform(u.uFresnelNormalFlatten.value) as TslNode;
  const uCameraPos = uniform(u.uCameraPos.value) as TslNode;
  const uSunDir = uniform(u.uSunDir.value) as TslNode;
  const uFogDistance = uniform(Math.max(256, params.shading.fogFarM)) as TslNode;
  const uFogNear = uniform(Math.max(0, params.shading.fogNearM)) as TslNode;
  const uFogDensity = uniform(Math.max(0, params.shading.fogDensity)) as TslNode;
  const uHorizonStart = uniform(Math.max(0, params.shading.horizonBlendStartM)) as TslNode;
  const uHorizonEnd = uniform(Math.max(1, params.shading.horizonBlendEndM)) as TslNode;
  const uFoamThreshold = uniform(Math.max(0, params.wave.foamThreshold)) as TslNode;
  const uFoamPower = uniform(Math.max(0.001, params.wave.foamPower)) as TslNode;
  const uFoamIntensity = uniform(Math.max(0, params.wave.foamIntensity)) as TslNode;
  const uReflectionStrength = uniform(Math.max(0, params.shading.reflectionStrength)) as TslNode;
  const uReflectionDistortion = uniform(Math.max(0, params.shading.reflectionDistortion)) as TslNode;
  const uRoughness = uniform(Math.max(0, params.shading.roughness)) as TslNode;
  const uDetailStrength = uniform(Math.max(0, params.wave.detailNormalStrength)) as TslNode;
  const uDetailFadeStart = uniform(Math.max(0, params.wave.detailNormalFadeStartM)) as TslNode;
  const uDetailFadeEnd = uniform(Math.max(1, params.wave.detailNormalFadeEndM)) as TslNode;

  const pos: TslNode = positionGeometry;
  let waveX: TslNode = float(0);
  let waveY: TslNode = float(0);
  let waveZ: TslNode = float(0);
  let slopeX: TslNode = float(0);
  let slopeZ: TslNode = float(0);
  let jxx: TslNode = float(0);
  let jzz: TslNode = float(0);
  let jxz: TslNode = float(0);
  for (const wave of selectedWaves()) {
    const dirX = float(wave.dirX);
    const dirZ = float(wave.dirZ);
    const k = float(wave.k);
    const amp = float(wave.amp);
    const choppiness = float(wave.choppiness);
    const theta: TslNode = k.mul(dirX.mul(pos.x).add(dirZ.mul(pos.z))).sub(float(wave.omega).mul(uTime)).add(float(wave.phase));
    const s: TslNode = sin(theta);
    const c: TslNode = cos(theta);
    waveX = waveX.sub(amp.mul(dirX).mul(s).mul(choppiness));
    waveZ = waveZ.sub(amp.mul(dirZ).mul(s).mul(choppiness));
    waveY = waveY.add(amp.mul(c));
    slopeX = slopeX.sub(amp.mul(k).mul(dirX).mul(s));
    slopeZ = slopeZ.sub(amp.mul(k).mul(dirZ).mul(s));
    jxx = jxx.sub(amp.mul(k).mul(dirX).mul(dirX).mul(c).mul(choppiness));
    jzz = jzz.sub(amp.mul(k).mul(dirZ).mul(dirZ).mul(c).mul(choppiness));
    jxz = jxz.sub(amp.mul(k).mul(dirX).mul(dirZ).mul(c).mul(choppiness));
  }

  const displacedPosition: TslNode = vec3(pos.x.add(waveX), pos.y.add(waveY), pos.z.add(waveZ));
  const worldPos: TslNode = displacedPosition;
  const jacobian: TslNode = float(1).add(jxx).mul(float(1).add(jzz)).sub(jxz.mul(jxz));
  const waveCompression: TslNode = clamp(float(0.58).sub(jacobian).mul(1 / 0.58), 0.0, 1.0);
  const hashNoise = (uv: TslNode): TslNode => fract(sin(dot(uv, vec2(12.9898, 78.233))).mul(43758.5453));

  const fragment = Fn(() => {
    const waveHeight: TslNode = worldPos.y.sub(float(params.surfaceY));
    const dist: TslNode = length(uCameraPos.sub(worldPos));
    const detailFade: TslNode = float(1.0).sub(smoothstep(uDetailFadeStart, uDetailFadeEnd, dist));
    const normalBase: TslNode = normalize(vec3(slopeX.negate(), float(1.0), slopeZ.negate()));
    const detailUv: TslNode = worldPos.xz.mul(0.14).add(vec2(uTime.mul(0.04), uTime.mul(-0.025)));
    const d0: TslNode = hashNoise(detailUv);
    const detail: TslNode = vec2(hashNoise(detailUv.add(vec2(0.35, 0))).sub(d0), hashNoise(detailUv.add(vec2(0, 0.35))).sub(d0)).mul(uDetailStrength).mul(detailFade);
    const normal: TslNode = normalize(vec3(normalBase.x.sub(detail.x), normalBase.y, normalBase.z.sub(detail.y)));
    const viewDir: TslNode = normalize(uCameraPos.sub(worldPos));
    const sunDir: TslNode = normalize(uSunDir);
    const fresnelNormal: TslNode = normalize(mix(normal, vec3(0, 1, 0), uFresnelNormalFlatten));
    const ndotv: TslNode = max(dot(viewDir, fresnelNormal), float(0.05));
    const ndotl: TslNode = max(abs(dot(normal, sunDir)), float(0.15));

    const foamUv: TslNode = worldPos.xz.mul(0.08).add(vec2(uTime.mul(0.03), 0));
    const foamBreakup: TslNode = float(0.45).add(smoothstep(float(0.25), float(0.85), hashNoise(foamUv)).mul(0.55));
    const jacobianApprox: TslNode = float(0.58).sub(waveCompression.mul(0.58));
    const foamMask: TslNode = clamp(pow(float(1.0).sub(smoothstep(uFoamThreshold.sub(0.5), uFoamThreshold, jacobianApprox)), uFoamPower).mul(uFoamIntensity).mul(foamBreakup), 0.0, 1.0);

    const elevationMask: TslNode = smoothstep(float(-3.0), float(6.0), waveHeight);
    const albedo: TslNode = mix(uDeep, uShallow, elevationMask);
    const reflectDir: TslNode = normalize(reflect(viewDir.negate(), normal).add(vec3(detail.x.mul(uReflectionDistortion), float(0), detail.y.mul(uReflectionDistortion))));
    const reflY: TslNode = max(reflectDir.y, float(0.0));
    const sunDot: TslNode = max(dot(reflectDir, sunDir), float(0.0));
    const skyReflection: TslNode = mix(uHorizon, uSkyZenith, smoothstep(float(0.0), float(0.6), reflY))
      .add(vec3(1.0, 0.92, 0.75).mul(pow(sunDot, float(96.0)).mul(1.2).add(pow(sunDot, float(8.0)).mul(0.18))));

    const fresnelSchlick: TslNode = float(0.02).add(float(0.98).mul(pow(float(1.0).sub(ndotv), float(5.0))));
    const reflectionMix: TslNode = fresnelSchlick.mul(uReflectionStrength).mul(float(1.0).sub(foamMask.mul(0.7)));
    const diffuseColor: TslNode = albedo.mul(ndotl.mul(0.8).add(0.2)).mul(float(1.0).sub(reflectionMix));
    const specDot: TslNode = max(dot(normal, normalize(sunDir.add(viewDir))), float(0.0));
    const specular: TslNode = pow(specDot, mix(float(180), float(18), clamp(uRoughness, 0.0, 1.0))).mul(1.2).mul(float(1.0).sub(foamMask));
    const sss: TslNode = uSssColor.mul(uSssStrength).mul(pow(max(dot(viewDir, sunDir.negate()), float(0.0)), float(4.0))).mul(smoothstep(float(0.0), float(6.0), waveHeight));
    const oceanColor: TslNode = diffuseColor.add(skyReflection.mul(reflectionMix)).add(vec3(specular).mul(float(1.0).sub(uRoughness))).add(sss);
    const litOcean: TslNode = mix(oceanColor, uFoam.mul(ndotl.mul(0.4).add(0.7)), foamMask);
    const fogBase: TslNode = smoothstep(uFogNear, uFogDistance, dist).mul(uFogDensity);
    const fogHorizon: TslNode = smoothstep(uHorizonStart, uHorizonEnd, dist);
    const fogged: TslNode = mix(litOcean, uHorizon, clamp(max(fogBase, fogHorizon), 0.0, 1.0));
    return vec4(fogged, float(1.0));
  })();

  const material = new MeshBasicNodeMaterial({ transparent: false, depthTest: true, depthWrite: true, side: THREE.FrontSide });
  material.name = "deep-ocean-node-v2";
  material.positionNode = displacedPosition;
  material.colorNode = fragment.xyz;
  material.opacityNode = fragment.w;

  const uniforms: WaterUniforms & { uHorizonColor: { value: THREE.Color }; uFogDistance: { value: number } } = {
    ...u,
    uHorizonColor: { value: (params.horizonColor ?? colorUniform(params.shading.fogColor)).clone() },
    uFogDistance: { value: Math.max(256, params.shading.fogFarM) },
  };

  return {
    material,
    setTime: (t) => { uniforms.uTime.value = t; uTime.value = t; },
    updateCamera: (pos) => { uniforms.uCameraPos.value.copy(pos); uCameraPos.value.copy(pos); },
    updateSunDirection: (dir) => { uniforms.uSunDir.value.copy(dir).normalize(); uSunDir.value.copy(dir).normalize(); },
    updateHorizonColor: (color) => { uniforms.uHorizonColor.value.copy(color); uHorizon.value.copy(color); },
    updateVisual: (visual: WaterVisualConfig) => {
      applyWaterVisual(uniforms, visual);
      uDeep.value.copy(uniforms.uDeepColor.value);
      uShallow.value.copy(uniforms.uShallowColor.value);
      uFoam.value.copy(uniforms.uFoamColor.value);
      uFresnelNormalFlatten.value = uniforms.uFresnelNormalFlatten.value;
      material.depthWrite = true;
      material.needsUpdate = true;
    },
    dispose: () => { material.dispose(); },
  };
}
