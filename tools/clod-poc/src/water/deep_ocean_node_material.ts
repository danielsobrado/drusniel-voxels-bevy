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
  const uFoamNoiseScale = uniform(u.uFoamNoiseScale.value) as TslNode;
  const uFresnelBase = uniform(u.uFresnelBase.value) as TslNode;
  const uFresnelNormalFlatten = uniform(u.uFresnelNormalFlatten.value) as TslNode;
  const uTurbidity = uniform(u.uTurbidity.value) as TslNode;
  const uCameraPos = uniform(u.uCameraPos.value) as TslNode;
  const uSunDir = uniform(u.uSunDir.value) as TslNode;
  const uFogDistance = uniform(Math.max(256, params.visual.rippleLoopDistance * 4)) as TslNode;

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

    const bumpUv: TslNode = worldPos.xz.mul(max(uFoamNoiseScale.mul(2.5), float(0.02))).add(advectA.mul(0.15));
    const bumpBase: TslNode = hashNoise(bumpUv);
    const bumpX: TslNode = hashNoise(bumpUv.add(vec2(0.02, 0))).sub(bumpBase).mul(7.5);
    const bumpZ: TslNode = hashNoise(bumpUv.add(vec2(0, 0.02))).sub(bumpBase).mul(7.5);
    const rippleGrad: TslNode = mix(vec3(gAx, 0, gAz), vec3(gBx, 0, gBz), blend).mul(uRippleAmp);
    const detailGrad: TslNode = vec3(bumpX.mul(0.18), 0, bumpZ.mul(0.18));
    const waveGrad: TslNode = vec3(slopeX, 0, slopeZ);
    const grad: TslNode = rippleGrad.add(detailGrad).add(waveGrad);
    const normal: TslNode = normalize(vec3(grad.x.negate(), float(1.0), grad.z.negate()));

    const viewDir: TslNode = normalize(uCameraPos.sub(worldPos));
    const sunDir: TslNode = normalize(uSunDir);
    const fresnelNormal: TslNode = normalize(mix(normal, vec3(0, 1, 0), uFresnelNormalFlatten));
    const ndotv: TslNode = max(dot(viewDir, fresnelNormal), float(0.0));
    const fres: TslNode = uFresnelBase.add(
      float(1.0).sub(uFresnelBase).mul(pow(float(1.0).sub(ndotv), uFresnelPower)),
    );

    const reflectDir: TslNode = normalize(reflect(viewDir.negate(), normal));
    const reflY: TslNode = reflectDir.y;
    const reflYClamped: TslNode = max(reflY, float(0.0));
    const sunDot: TslNode = max(dot(reflectDir, sunDir), float(0.0));
    const horizonColor: TslNode = mix(vec3(0.85, 0.55, 0.35), vec3(0.55, 0.70, 0.90), smoothstep(float(0.0), float(0.25), sunDir.y));
    const skyGrad: TslNode = mix(horizonColor, vec3(0.12, 0.32, 0.72), smoothstep(float(0.0), float(0.6), reflYClamped));
    const belowHorizon: TslNode = mix(vec3(0.035, 0.07, 0.16), vec3(0.07, 0.14, 0.28), smoothstep(float(-0.5), float(0.0), reflY));
    const reflectedSky: TslNode = mix(belowHorizon, skyGrad, smoothstep(float(-0.25), float(0.12), reflY));
    const mie: TslNode = vec3(1.0, 0.72, 0.42).mul(pow(sunDot, float(8.0)).mul(0.25))
      .add(vec3(1.0, 0.95, 0.85).mul(pow(sunDot, float(64.0)).mul(1.2)));
    const sunDisc: TslNode = vec3(1.0, 0.92, 0.75).mul(
      pow(sunDot, float(512.0)).mul(4.5).add(pow(sunDot, float(128.0)).mul(1.4)),
    );
    const skyReflection: TslNode = max(reflectedSky.add(mie).add(sunDisc), vec3(0.035, 0.07, 0.14)).mul(0.88);

    const deepBlue: TslNode = mix(vec3(0.0, 0.025, 0.10), uDeep, float(0.55));
    const shallowTeal: TslNode = mix(uShallow, vec3(0.0, 0.45, 0.62), float(0.35));
    const viewDepthTint: TslNode = smoothstep(float(0.0), float(0.55), float(1.0).sub(ndotv));
    const heightTint: TslNode = smoothstep(float(-3.0), float(5.5), waveHeight);
    const viewColor: TslNode = mix(deepBlue, shallowTeal, viewDepthTint.mul(0.28).add(uTurbidity.mul(0.18)));
    const waterColor: TslNode = mix(viewColor, mix(vec3(0.01, 0.04, 0.14), shallowTeal, heightTint), float(0.32));

    const foamUv: TslNode = worldPos.xz.mul(max(uFoamNoiseScale, float(0.01))).add(advectA.mul(0.35));
    const n1: TslNode = hashNoise(foamUv.add(vec2(uTime.mul(0.03), uTime.mul(-0.02))));
    const n2: TslNode = hashNoise(foamUv.mul(2.3).add(vec2(17.3, -9.1)).add(vec2(uTime.mul(-0.04), uTime.mul(0.05))));
    const n3: TslNode = hashNoise(foamUv.mul(5.7).add(vec2(-3.8, 23.5)).add(vec2(uTime.mul(0.05), uTime.mul(0.02))));
    const baseFbm: TslNode = n1.mul(0.5).add(n2.mul(0.3)).add(n3.mul(0.2));
    const noiseDomainWarp: TslNode = mix(baseFbm, float(1.0).sub(abs(baseFbm.mul(2.0).sub(1.0))), float(0.4));
    const r1: TslNode = float(1.0).sub(abs(n1.mul(2.0).sub(1.0)));
    const r2: TslNode = float(1.0).sub(abs(n2.mul(2.0).sub(1.0)));
    const r3: TslNode = float(1.0).sub(abs(n3.mul(2.0).sub(1.0)));
    const noiseRidged: TslNode = r1.mul(0.5).add(r2.mul(r1).mul(0.3)).add(r3.mul(r2).mul(0.2));
    const c1: TslNode = hashNoise(foamUv.mul(0.8).add(vec2(uTime.mul(0.02), uTime.mul(-0.015))));
    const c2: TslNode = hashNoise(foamUv.mul(0.8).add(vec2(0.33, 0.77)).add(vec2(uTime.mul(0.02), uTime.mul(-0.015))));
    const noiseCellular: TslNode = clamp(float(1.0).sub(abs(c1.sub(c2))).mul(1.5), 0.0, 1.0);
    const noiseBillow: TslNode = abs(n1.mul(2.0).sub(1.0)).mul(0.5).add(abs(n2.mul(2.0).sub(1.0)).mul(0.3)).add(abs(n3.mul(2.0).sub(1.0)).mul(0.2));
    const noiseSwiss: TslNode = r1.mul(0.6).add(r2.mul(r1).mul(r1).mul(0.4));
    const noiseTurbulent: TslNode = float(1.0).sub(noiseBillow);
    const foamNoise: TslNode = clamp(
      noiseDomainWarp.mul(0.24).add(noiseRidged.mul(0.24)).add(noiseCellular.mul(0.08)).add(noiseBillow.mul(0.10)).add(noiseSwiss.mul(0.14)).add(noiseTurbulent.mul(0.20)),
      0.0,
      1.0,
    );

    const crestFoam: TslNode = smoothstep(float(1.2), float(4.0), waveHeight).mul(smoothstep(float(0.36), float(0.82), foamNoise));
    const compressionFoam: TslNode = smoothstep(float(0.04), float(0.55), waveCompression).mul(smoothstep(float(0.42), float(0.86), foamNoise));
    const foam: TslNode = smoothstep(float(0.70), float(0.96), foamNoise).mul(0.10).add(crestFoam.mul(0.34)).add(compressionFoam.mul(0.38));
    const backlit: TslNode = pow(max(dot(viewDir, sunDir.negate()), float(0.0)), float(4.0)).mul(0.35);
    const crestScatter: TslNode = smoothstep(float(0.0), float(5.5), waveHeight).mul(0.38)
      .add(smoothstep(float(0.45), float(0.95), foamNoise).mul(0.20));
    const sss: TslNode = mix(vec3(0.01, 0.04, 0.14), shallowTeal, float(0.55)).mul(backlit.add(crestScatter));
    const specDot: TslNode = max(dot(reflect(sunDir.negate(), normal), viewDir), float(0.0));
    const sunSpec: TslNode = vec3(1.0, 0.92, 0.76).mul(pow(specDot, float(384.0)).mul(1.35).add(pow(specDot, float(96.0)).mul(0.32)));
    const litWater: TslNode = mix(waterColor.add(sss).add(sunSpec), skyReflection, clamp(fres.mul(0.75), 0.0, 0.85));
    const finalColor: TslNode = mix(litWater, uFoam, clamp(foam, 0.0, 1.0));
    const dist: TslNode = length(uCameraPos.xz.sub(worldPos.xz));
    const horizonLift: TslNode = smoothstep(0.02, 0.35, float(1.0).sub(abs(viewDir.y)));
    const distFog: TslNode = smoothstep(uFogDistance.mul(0.35), uFogDistance, dist);
    const fog: TslNode = clamp(max(horizonLift.mul(0.42), distFog.mul(0.58)), 0.0, 1.0);
    const fogged: TslNode = mix(finalColor, uHorizon, fog);
    const alpha: TslNode = clamp(uAlpha.add(fres.mul(0.18)), 0.0, 1.0);
    return vec4(fogged, alpha);
  })();

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthTest: true,
    depthWrite: params.visual.depthWrite,
    side: THREE.DoubleSide,
  });
  material.name = "deep-ocean-node";
  material.positionNode = displacedPosition;
  material.colorNode = fragment.xyz;
  material.opacityNode = fragment.w;

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
      uFoamNoiseScale.value = uniforms.uFoamNoiseScale.value;
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
