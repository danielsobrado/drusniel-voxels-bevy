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
import { DEEP_OCEAN_GPU_WAVES } from "./deep_ocean_waves.js";
import { applyWaterVisual, makeWaterUniforms, type WaterUniforms } from "./waterMaterial.js";
import type { DeepOceanMaterialHandle, DeepOceanMaterialParams } from "./deep_ocean_material.js";
import type { WaterVisualConfig } from "./waterConfig.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

function colorNode(color: readonly [number, number, number]): TslNode {
  return vec3(color[0], color[1], color[2]);
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
  const uFoam = uniform(u.uFoamColor.value) as TslNode;
  const uHorizon = uniform((params.horizonColor ?? new THREE.Color(0.62, 0.74, 0.88)).clone()) as TslNode;
  const uAlpha = uniform(u.uAlpha.value) as TslNode;
  const uFresnelPower = uniform(u.uFresnelPower.value) as TslNode;
  const uFresnelNormalFlatten = uniform(u.uFresnelNormalFlatten.value) as TslNode;
  const uCameraPos = uniform(u.uCameraPos.value) as TslNode;
  const uSunDir = uniform(u.uSunDir.value) as TslNode;
  const uFogDistance = uniform(Math.max(256, params.shading.fogFarM)) as TslNode;
  const uFogNear = uniform(Math.max(0, params.shading.fogNearM)) as TslNode;
  const uFogDensity = uniform(Math.max(0, params.shading.fogDensity)) as TslNode;
  const uFoamThreshold = uniform(Math.max(0, params.wave.foamThreshold)) as TslNode;
  const uFoamPower = uniform(Math.max(0.001, params.wave.foamPower)) as TslNode;
  const uFoamIntensity = uniform(Math.max(0, params.wave.foamIntensity)) as TslNode;
  const uReflectionStrength = uniform(Math.max(0, params.shading.reflectionStrength)) as TslNode;
  const uReflectionDistortion = uniform(Math.max(0, params.shading.reflectionDistortion)) as TslNode;
  const uRoughness = uniform(Math.max(0, params.shading.roughness)) as TslNode;

  const pos: TslNode = positionGeometry;
  let waveX: TslNode = float(0);
  let waveY: TslNode = float(0);
  let waveZ: TslNode = float(0);
  let slopeX: TslNode = float(0);
  let slopeZ: TslNode = float(0);
  let jxx: TslNode = float(0);
  let jzz: TslNode = float(0);
  let jxz: TslNode = float(0);
  for (const wave of DEEP_OCEAN_GPU_WAVES) {
    const dirX = float(wave.dirX);
    const dirZ = float(wave.dirZ);
    const k = float(wave.k);
    const amp = float(wave.amp);
    const choppiness = float(wave.choppiness);
    const theta: TslNode = k
      .mul(dirX.mul(pos.x).add(dirZ.mul(pos.z)))
      .sub(float(wave.omega).mul(uTime))
      .add(float(wave.phase));
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
    const normal: TslNode = normalize(vec3(slopeX.negate(), float(1.0), slopeZ.negate()));
    const viewDir: TslNode = normalize(uCameraPos.sub(worldPos));
    const sunDir: TslNode = normalize(uSunDir);
    const fresnelNormal: TslNode = normalize(mix(normal, vec3(0, 1, 0), uFresnelNormalFlatten));
    const ndotv: TslNode = max(dot(viewDir, fresnelNormal), float(0.05));
    const ndotl: TslNode = max(abs(dot(normal, sunDir)), float(0.15));

    const foamUv: TslNode = worldPos.xz.mul(0.8).add(vec2(uTime.mul(0.0525), uTime.mul(-0.03)));
    const n1: TslNode = hashNoise(foamUv);
    const n2: TslNode = hashNoise(foamUv.mul(2.3).add(vec2(17.3, -9.1)));
    const n3: TslNode = hashNoise(foamUv.mul(5.7).add(vec2(-3.8, 23.5)));
    const turbulent: TslNode = float(1.0).sub(abs(n1.mul(2.0).sub(1.0)).mul(0.45).add(abs(n2.mul(2.0).sub(1.0)).mul(0.35)).add(abs(n3.mul(2.0).sub(1.0)).mul(0.2)));
    const foamNoise: TslNode = clamp(turbulent.mul(0.35).add(n1.mul(0.09)).add(n2.mul(0.054)).add(n3.mul(0.036)), 0.0, 1.0);
    const foamEdge: TslNode = uFoamThreshold.add(foamNoise);
    const jacobianApprox: TslNode = float(0.58).sub(waveCompression.mul(0.58));
    const foamMask: TslNode = clamp(pow(float(1.0).sub(smoothstep(foamEdge.sub(0.6), foamEdge, jacobianApprox)), uFoamPower).mul(uFoamIntensity), 0.0, 1.0);

    const deepColor: TslNode = vec3(0.0, 0.03, 0.12);
    const shallowColor: TslNode = vec3(0.0, 0.08, 0.18);
    const elevationMask: TslNode = smoothstep(float(-4.0), float(6.0), waveHeight);
    const baseAlbedo: TslNode = mix(deepColor, uDeep, elevationMask);
    const depthTint: TslNode = mix(shallowColor, baseAlbedo, smoothstep(float(-2.0), float(3.0), waveHeight));
    const hNorm: TslNode = smoothstep(float(-5.0), float(8.0), waveHeight);
    const hColor1: TslNode = mix(colorNode([0.008, 0.102, 0.208]), colorNode([0.024, 0.259, 0.451]), smoothstep(float(0.0), float(0.33), hNorm));
    const hColor2: TslNode = mix(hColor1, colorNode([0.102, 0.541, 0.490]), smoothstep(float(0.33), float(0.66), hNorm));
    const hColor3: TslNode = mix(hColor2, colorNode([0.369, 0.769, 0.690]), smoothstep(float(0.66), float(1.0), hNorm));
    const albedo: TslNode = mix(depthTint, hColor3, float(0.6));

    const reflectionWarp: TslNode = vec3(slopeX.mul(uReflectionDistortion), float(0), slopeZ.mul(uReflectionDistortion));
    const reflectDir: TslNode = normalize(reflect(viewDir.negate(), normal).add(reflectionWarp));
    const reflY: TslNode = reflectDir.y;
    const reflYClamped: TslNode = max(reflY, float(0.0));
    const sunDot: TslNode = max(dot(reflectDir, sunDir), float(0.0));
    const horizonColor: TslNode = mix(vec3(0.85, 0.55, 0.35), vec3(0.55, 0.70, 0.90), smoothstep(float(0.0), float(0.25), sunDir.y));
    const skyGrad: TslNode = mix(horizonColor, vec3(0.15, 0.35, 0.75), smoothstep(float(0.0), float(0.6), reflYClamped));
    const belowHorizon: TslNode = mix(vec3(0.04, 0.08, 0.18), vec3(0.08, 0.15, 0.28), smoothstep(float(-0.5), float(0.0), reflY));
    const reflectedSky: TslNode = mix(belowHorizon, skyGrad, smoothstep(float(-0.25), float(0.12), reflY));
    const mie: TslNode = vec3(1.0, 0.85, 0.55).mul(pow(sunDot, float(8.0)).mul(0.25)).add(vec3(1.0, 0.95, 0.85).mul(pow(sunDot, float(64.0)).mul(1.2)));
    const sunDisc: TslNode = vec3(1.0, 0.92, 0.75).mul(pow(sunDot, float(512.0)).mul(5.0).add(pow(sunDot, float(128.0)).mul(1.5)));
    const ambient: TslNode = mix(vec3(0.03, 0.06, 0.12), vec3(0.06, 0.10, 0.18), smoothstep(float(-0.3), float(0.2), reflY));
    const skyReflection: TslNode = max(reflectedSky.add(mie).add(sunDisc), ambient).mul(float(1.0).sub(uRoughness.mul(0.5)));

    const fresnelSchlick: TslNode = float(0.04).add(float(0.96).mul(pow(float(1.0).sub(ndotv), float(5.0))));
    const reflectionMix: TslNode = fresnelSchlick.mul(uReflectionStrength).mul(float(1.0).sub(foamMask.mul(0.7)));
    const diffuseColor: TslNode = albedo.mul(ndotl.mul(0.8).add(0.2)).mul(float(1.0).sub(reflectionMix));
    const specDot: TslNode = max(dot(normal, normalize(sunDir.add(viewDir))), float(0.0));
    const specular: TslNode = pow(specDot, mix(float(800), float(4), clamp(uRoughness, 0.0, 1.0))).mul(1.2).mul(float(1.0).sub(foamMask));
    const sss: TslNode = mix(vec3(0.01, 0.04, 0.14), colorNode(params.shading.shallowColor), smoothstep(float(-1.0), float(5.0), waveHeight).mul(0.55))
      .mul(pow(max(dot(viewDir, sunDir.negate()), float(0.0)), float(4.0)).mul(0.5).add(smoothstep(float(0.0), float(6.0), waveHeight).mul(0.06)));

    const oceanColor: TslNode = diffuseColor.add(skyReflection.mul(reflectionMix)).add(vec3(specular).mul(float(1.0).sub(uRoughness))).add(sss);
    const foamLit: TslNode = uFoam.mul(ndotl.mul(0.4).add(0.7));
    const litOcean: TslNode = mix(oceanColor, foamLit, foamMask);
    const dist: TslNode = length(uCameraPos.sub(worldPos));
    const fog: TslNode = smoothstep(uFogNear, uFogDistance, dist).mul(uFogDensity);
    const fogged: TslNode = mix(litOcean, uHorizon, clamp(fog, 0.0, 1.0));
    return vec4(fogged, clamp(uAlpha, 0.0, 1.0));
  })();

  const material = new MeshBasicNodeMaterial({ transparent: true, depthTest: true, depthWrite: params.visual.depthWrite, side: THREE.DoubleSide });
  material.name = "deep-ocean-node";
  material.positionNode = displacedPosition;
  material.colorNode = fragment.xyz;
  material.opacityNode = fragment.w;

  const uniforms: WaterUniforms & { uHorizonColor: { value: THREE.Color }; uFogDistance: { value: number } } = {
    ...u,
    uHorizonColor: { value: (params.horizonColor ?? new THREE.Color(0.62, 0.74, 0.88)).clone() },
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
      uFoam.value.copy(uniforms.uFoamColor.value);
      uAlpha.value = uniforms.uAlpha.value;
      uFresnelPower.value = uniforms.uFresnelPower.value;
      uFresnelNormalFlatten.value = uniforms.uFresnelNormalFlatten.value;
      material.depthWrite = visual.depthWrite;
      material.needsUpdate = true;
    },
    dispose: () => { material.dispose(); },
  };
}
