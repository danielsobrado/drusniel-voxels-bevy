// TSL NodeMaterial water material for the default WebGPU renderer.
// Dynamically imported only on the WebGPU path (see main.ts) so the WebGL bundle
// never pulls in three/webgpu / three/tsl. Mirrors the grass NodeMaterial split.
//
// The grid position attribute carries (worldX, waterY, worldZ) with an identity
// model transform, so positionWorld == the position attribute. Per-vertex
// aTerrainY / aBodyMask / aFlow / aLevel are CPU-filled by the WaterField.
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  Break,
  cameraFar,
  cameraNear,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  exp,
  float,
  Fn,
  fract,
  getScreenPosition,
  If,
  interleavedGradientNoise,
  Loop,
  max,
  mix,
  normalize,
  or,
  perspectiveDepthToViewZ,
  pow,
  positionView,
  positionWorld,
  reflect,
  screenCoordinate,
  screenUV,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
  viewportDepthTexture,
  viewportSharedTexture,
} from "three/tsl";
import { makeWaterUniforms, type WaterMaterialHandle, type WaterMaterialParams } from "./waterMaterial.js";
import type { WaterVisualConfig } from "./waterConfig.js";
import { getWaterScreenResources } from "./waterScreenResources.js";
import { DEFAULT_CAUSTICS_CONFIG, type CausticsConfig } from "./causticsConfig.js";
import { readRiverMaterialSettings } from "./riverMaterialRuntime.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
// three 0.184's TSL node graph types are intentionally loose: extension methods
// (.mul/.select/.discard/...) are merged onto nodes via module augmentation, and
// per-node generic params do not line up across vec3()/select() overloads. The
// grass NodeMaterial (gpu/grass_node_material.ts) uses the same `TslNode` alias.
// The core water modules (config/field/clipmap/debug) are fully strict, no `any`.
type TslNode = any;

export function createWaterNodeMaterialImpl(params: WaterMaterialParams): WaterMaterialHandle {
  const u = makeWaterUniforms(params);
  const riverMaterial = readRiverMaterialSettings();

  const uTime = uniform(0) as TslNode;
  const uShallow = uniform(u.uShallowColor.value) as TslNode;
  const uDeep = uniform(u.uDeepColor.value) as TslNode;
  const uFoam = uniform(u.uFoamColor.value) as TslNode;
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
  const uShoreFoamStart = uniform(u.uShoreFoamStart.value) as TslNode;
  const uShoreFoamEnd = uniform(u.uShoreFoamEnd.value) as TslNode;
  const uFoamNoiseScale = uniform(u.uFoamNoiseScale.value) as TslNode;
  const uFoamShoreStrength = uniform(u.uFoamShoreStrength.value) as TslNode;
  const uFoamRiverStrength = uniform(u.uFoamRiverStrength.value) as TslNode;
  const uFoamSpeedStart = uniform(u.uFoamSpeedStart.value) as TslNode;
  const uFoamSpeedEnd = uniform(u.uFoamSpeedEnd.value) as TslNode;
  const uFoamDropStart = uniform(u.uFoamDropStart.value) as TslNode;
  const uFoamDropEnd = uniform(u.uFoamDropEnd.value) as TslNode;
  const uFresnelBase = uniform(u.uFresnelBase.value) as TslNode;
  const uFresnelNormalFlatten = uniform(u.uFresnelNormalFlatten.value) as TslNode;
  const uDepthScale = uniform(u.uDepthScale.value) as TslNode;
  const uTurbidity = uniform(u.uTurbidity.value) as TslNode;
  const uClipmapTint = uniform(u.uClipmapTint.value) as TslNode;
  const uInnerRect = uniform(u.uInnerRect.value) as TslNode;
  const uDebugMode = uniform(u.uDebugMode.value) as TslNode;
  const uCameraPos = uniform(u.uCameraPos.value) as TslNode;
  const uSunDir = uniform(u.uSunDir.value) as TslNode;
  const uWorldBounds = uniform(u.uWorldBounds.value) as TslNode;
  const uRiverFlowNormalStrength = uniform(riverMaterial.flowNormalStrength) as TslNode;
  const uRiverCrossCurrentStrength = uniform(riverMaterial.crossCurrentStrength) as TslNode;
  const uRiverRapidNormalBoost = uniform(riverMaterial.rapidNormalBoost) as TslNode;
  const uRiverBankFoamStrength = uniform(riverMaterial.bankFoamStrength) as TslNode;
  const uRiverRapidFoamStrength = uniform(riverMaterial.rapidFoamStrength) as TslNode;
  const uRiverFoamStreakStrength = uniform(riverMaterial.foamStreakStrength) as TslNode;
  const uRiverShallowBankTintStrength = uniform(riverMaterial.shallowBankTintStrength) as TslNode;
  const uRiverCenterChannelDarkening = uniform(riverMaterial.centerChannelDarkening) as TslNode;

  // Refraction uniforms
  const uRefrStrength = uniform(u.uRefraction.strength) as TslNode;
  const uRefrValidationBias = uniform(u.uRefraction.depthValidationBias) as TslNode;
  const uRefrAbsorption = uniform(new THREE.Vector3(u.uRefraction.absorptionR, u.uRefraction.absorptionG, u.uRefraction.absorptionB)) as TslNode;
  const uRefrTurbidity = uniform(u.uRefraction.turbidityStrength) as TslNode;
  const uRefrEnabled = uniform(u.uRefraction.enabled ? 1 : 0) as TslNode;
  const uRefrMaxThickness = uniform(u.uRefraction.maxThickness) as TslNode;

  // Reflection uniforms
  const uReflSSREnabled = uniform(u.uReflection.ssrEnabled ? 1 : 0) as TslNode;
  const uReflMaxSteps = uniform(u.uReflection.maxSteps) as TslNode;
  const uReflStepScale = uniform(u.uReflection.stepScale) as TslNode;
  const uReflEdgeFadeStart = uniform(u.uReflection.edgeFadeStart) as TslNode;
  const uReflEdgeFadeEnd = uniform(u.uReflection.edgeFadeEnd) as TslNode;
  const uReflSkyStrength = uniform(u.uReflection.skyFallbackStrength) as TslNode;
  const uReflTerrainStrength = uniform(u.uReflection.terrainFallbackStrength) as TslNode;

  // Caustics uniforms
  const uCausticsEnabled = uniform(u.uCausticsEnabled.value) as TslNode;
  const uCausticsGain = uniform(u.uCausticsGain.value) as TslNode;
  const uCausticsScale = uniform(u.uCausticsScale.value) as TslNode;
  const uCausticsSpeed = uniform(u.uCausticsSpeed.value) as TslNode;
  const causticsCfg: CausticsConfig = params.caustics ?? DEFAULT_CAUSTICS_CONFIG;
  const uCausticsDepthFade = uniform(causticsCfg.depthFade) as TslNode;
  const uCausticsFocalDepth = uniform(causticsCfg.focalDepth) as TslNode;
  const uCausticsSunGateStart = uniform(causticsCfg.sunGateStart) as TslNode;
  const uCausticsSunGateEnd = uniform(causticsCfg.sunGateEnd) as TslNode;

  const aTerrainY = attribute("aTerrainY", "float") as TslNode;
  const aBodyMask = attribute("aBodyMask", "float") as TslNode;
  const aFlow = attribute("aFlow", "vec4") as TslNode;
  const aLevel = attribute("aLevel", "float") as TslNode;

  const worldPos: TslNode = positionWorld;

  const fragment = Fn(() => {
    const px: TslNode = worldPos.x;
    const pz: TslNode = worldPos.z;
    const outsideWorld: TslNode = px.lessThan(float(0))
      .or(px.greaterThan(uWorldBounds.x))
      .or(pz.lessThan(float(0)))
      .or(pz.greaterThan(uWorldBounds.y));
    const insideInner: TslNode = px.greaterThan(uInnerRect.x)
      .and(px.lessThan(uInnerRect.z))
      .and(pz.greaterThan(uInnerRect.y))
      .and(pz.lessThan(uInnerRect.w));
    const depth: TslNode = worldPos.y.sub(aTerrainY);
    // Discard clipmap-hole pixels, dry vertices, outside world, and outside body mask.
    or(
      outsideWorld,
      or(
        insideInner,
        or(
          depth.lessThanEqual(float(0)),
          aBodyMask.lessThanEqual(float(0))
        )
      )
    ).discard();

    const depthNorm: TslNode = clamp(depth.div(uDepthScale), 0.0, 1.0);

    // Procedural caustics: layered sine waves, fading with depth.
    // Gated by uCausticsEnabled — produces 0 when disabled.
    const causticVal: TslNode = Fn(() => {
      const cuv: TslNode = worldPos.xz.mul(uCausticsScale);
      const ct: TslNode = uTime.mul(uCausticsSpeed);
      const c1: TslNode = sin(cuv.x.mul(3.7).add(ct.mul(1.1)).add(cuv.y.mul(2.3)))
        .mul(cos(cuv.y.mul(4.1).sub(ct.mul(0.9)).add(cuv.x.mul(1.7))));
      const c2: TslNode = sin(cuv.x.mul(5.3).sub(ct.mul(0.7)).add(cuv.y.mul(3.9)))
        .mul(cos(cuv.y.mul(2.9).add(ct.mul(1.3)).sub(cuv.x.mul(2.1))));
      const raw: TslNode = c1.mul(0.6).add(c2.mul(0.4)).mul(0.5).add(0.5);
      const pattern: TslNode = smoothstep(0.3, 0.8, raw);
      const depthFade: TslNode = exp(depth.mul(uCausticsDepthFade.negate()));
      const focalFade: TslNode = smoothstep(float(0.04), uCausticsFocalDepth, depth);
      const sunUp: TslNode = smoothstep(uCausticsSunGateStart, uCausticsSunGateEnd, normalize(uSunDir).y);
      return pattern.mul(depthFade).mul(focalFade).mul(sunUp).mul(uCausticsGain).mul(uCausticsEnabled);
    })();

    const riverDir: TslNode = normalize(vec2(aFlow.x, aFlow.y).add(vec2(0.00001, 0.0)));
    const sideDir: TslNode = vec2(riverDir.y.negate(), riverDir.x);
    const breezeDir: TslNode = normalize(uLakeBreeze.add(vec2(0.00001, 0.0)));
    const flowSpeed: TslNode = aFlow.z;
    const flowDrop: TslNode = abs(aFlow.w);
    const riverWeight: TslNode = smoothstep(0.001, 0.02, flowSpeed);
    const rapidSpeed: TslNode = smoothstep(uFoamSpeedStart, uFoamSpeedEnd, flowSpeed);
    const rapidDrop: TslNode = smoothstep(uFoamDropStart, uFoamDropEnd, flowDrop);
    const rapidMask: TslNode = clamp(rapidSpeed.mul(0.45).add(rapidDrop.mul(0.85)).mul(riverWeight), 0.0, 1.0);
    const mixedDir: TslNode = mix(breezeDir, riverDir, riverWeight) as TslNode;
    const advectDir: TslNode = normalize(mixedDir);
    const breezeSpeed: TslNode = max(abs(uLakeBreeze.x), abs(uLakeBreeze.y));
    const advectSpeed: TslNode = max(breezeSpeed, flowSpeed.mul(float(1.0).add(rapidMask.mul(0.9)))).mul(uRippleSpeed);
    const phaseA: TslNode = fract(uTime.mul(uRippleCycle));
    const phaseB: TslNode = fract(uTime.mul(uRippleCycle).add(0.5));
    const blend: TslNode = abs(phaseA.sub(0.5)).mul(2.0);
    const advectA: TslNode = advectDir.mul(phaseA.mul(uRippleLoopDistance).mul(advectSpeed));
    const advectB: TslNode = advectDir.mul(phaseB.mul(uRippleLoopDistance).mul(advectSpeed));
    const tau = 6.28318530718;
    const uvA: TslNode = worldPos.xz.mul(uRippleScaleA).add(advectDir.mul(phaseA.mul(uRippleLoopDistance).mul(advectSpeed)));
    const uvB: TslNode = worldPos.xz.mul(uRippleScaleB)
      .add(advectDir.mul(phaseB.mul(uRippleLoopDistance).mul(advectSpeed)))
      .add(vec2(17.31, -9.47));
    const gAx: TslNode = cos(uvA.x.add(phaseA.mul(tau))).mul(uRippleStrengthA)
      .add(cos(uvA.x.add(uvA.y).mul(0.73).sub(phaseA.mul(tau * 0.7))).mul(uRippleStrengthB));
    const gAz: TslNode = sin(uvA.y.sub(phaseA.mul(tau))).negate().mul(uRippleStrengthA)
      .add(cos(uvA.x.sub(uvA.y).mul(0.61).add(phaseA.mul(tau * 0.9))).mul(uRippleStrengthB));
    const gBx: TslNode = cos(uvB.x.add(phaseB.mul(tau))).mul(uRippleStrengthA)
      .add(cos(uvB.x.add(uvB.y).mul(0.73).sub(phaseB.mul(tau * 0.7))).mul(uRippleStrengthB));
    const gBz: TslNode = sin(uvB.y.sub(phaseB.mul(tau))).negate().mul(uRippleStrengthA)
      .add(cos(uvB.x.sub(uvB.y).mul(0.61).add(phaseB.mul(tau * 0.9))).mul(uRippleStrengthB));
    const flowCoord: TslNode = vec2(dot(worldPos.xz, riverDir), dot(worldPos.xz, sideDir));
    const channelPhase: TslNode = uTime.mul(advectSpeed).mul(1.35);
    const channelWave: TslNode = sin(flowCoord.x.mul(uRippleScaleA.mul(5.5)).sub(channelPhase).add(sin(flowCoord.y.mul(0.08)).mul(0.7)));
    const sideRipple: TslNode = cos(flowCoord.y.mul(uRippleScaleB.mul(4.0)).add(flowCoord.x.mul(0.018)).add(channelPhase.mul(0.45)));
    const channelGrad: TslNode = riverDir.mul(channelWave.mul(uRippleStrengthA).mul(uRiverFlowNormalStrength))
      .add(sideDir.mul(sideRipple.mul(uRippleStrengthB).mul(uRiverCrossCurrentStrength)))
      .mul(riverWeight)
      .mul(float(0.45).add(rapidMask.mul(uRiverRapidNormalBoost)));
    const gradX: TslNode = mix(gAx, gBx, blend).add(channelGrad.x).mul(uRippleAmp);
    const gradZ: TslNode = mix(gAz, gBz, blend).add(channelGrad.y).mul(uRippleAmp);
    const normal: TslNode = normalize(vec3(gradX.negate(), float(1), gradZ.negate()));

    const viewDir: TslNode = normalize(uCameraPos.sub(worldPos));
    const sunDir: TslNode = normalize(uSunDir);
    const fresnelNormal: TslNode = normalize(mix(normal, vec3(0.0, 1.0, 0.0), uFresnelNormalFlatten));
    const ndotv: TslNode = max(dot(viewDir, fresnelNormal), 0.0);
    const fres: TslNode = uFresnelBase.add(
      float(1).sub(uFresnelBase).mul(pow(float(1).sub(ndotv), uFresnelPower)),
    );

    const reflectDir: TslNode = normalize(reflect(viewDir.negate(), normal));
    const reflY: TslNode = reflectDir.y;
    const reflYClamped: TslNode = max(reflY, float(0.0));
    const sunDot: TslNode = max(dot(reflectDir, sunDir), float(0.0));

    const horizonColor: TslNode = mix(
      vec3(0.85, 0.55, 0.35),
      vec3(0.55, 0.70, 0.90),
      smoothstep(float(0.0), float(0.25), sunDir.y),
    );
    const skyGrad: TslNode = mix(
      horizonColor,
      vec3(0.12, 0.32, 0.72),
      smoothstep(float(0.0), float(0.6), reflYClamped),
    );
    const belowHorizon: TslNode = mix(
      vec3(0.035, 0.07, 0.16),
      vec3(0.07, 0.14, 0.28),
      smoothstep(float(-0.5), float(0.0), reflY),
    );
    const reflectedSky: TslNode = mix(
      belowHorizon,
      skyGrad,
      smoothstep(float(-0.25), float(0.12), reflY),
    );
    const mie: TslNode = vec3(1.0, 0.72, 0.42)
      .mul(pow(sunDot, float(8.0)).mul(0.25))
      .add(vec3(1.0, 0.95, 0.85).mul(pow(sunDot, float(64.0)).mul(1.2)));
    const sunDisc: TslNode = vec3(1.0, 0.92, 0.75).mul(
      pow(sunDot, float(512.0)).mul(4.5).add(pow(sunDot, float(128.0)).mul(1.4)),
    );
    const skyReflection: TslNode = max(
      reflectedSky.add(mie).add(sunDisc),
      vec3(0.035, 0.07, 0.14),
    ).mul(0.88);

    const deepBlue: TslNode = mix(vec3(0.0, 0.025, 0.10), uDeep, float(0.65));
    const shallowTeal: TslNode = mix(uShallow, vec3(0.0, 0.45, 0.62), float(0.35));
    const shallowEdge: TslNode = float(1).sub(smoothstep(float(0.18), float(1.8), depth));
    const channelCenter: TslNode = smoothstep(float(0.85), float(3.6), depth).mul(riverWeight);
    const shallowBankColor: TslNode = mix(shallowTeal, vec3(0.02, 0.50, 0.46), clamp(uRiverShallowBankTintStrength.mul(0.42), 0.0, 1.0));
    const riverCenterColor: TslNode = mix(deepBlue, vec3(0.0, 0.055, 0.13), clamp(uRiverCenterChannelDarkening.mul(0.35), 0.0, 1.0));
    const riverTintColor: TslNode = mix(shallowBankColor, riverCenterColor, channelCenter);
    const waterColorRaw: TslNode = mix(shallowTeal, deepBlue, depthNorm);
    const waterColor: TslNode = mix(waterColorRaw, riverTintColor, clamp(riverWeight.mul(0.72).mul(uRiverShallowBankTintStrength), 0.0, 1.0));
    const waterTint: TslNode = mix(
      waterColor,
      shallowBankColor,
      uTurbidity.mul(float(1).sub(depthNorm)).mul(0.50).add(shallowEdge.mul(riverWeight).mul(0.18).mul(uRiverShallowBankTintStrength)),
    );
    const waterBase: TslNode = waterTint.add(causticVal.mul(vec3(0.10, 0.18, 0.16)));

    const screenAvail = getWaterScreenResources().available;
    const refrFallback: TslNode = waterBase;
    const ssrFallback: TslNode = skyReflection;

    const refrCol: TslNode = Fn(() => {
      if (!screenAvail) return refrFallback;

      const dist: TslNode = cameraPosition.sub(worldPos).length();
      const refrK: TslNode = clamp(float(9).div(dist.max(1)), 0.04, 1).mul(uRefrStrength);
      const ruv: TslNode = screenUV.add(normal.xz.mul(refrK));
      const refrDepthSample: TslNode = viewportDepthTexture(ruv);
      const zR: TslNode = perspectiveDepthToViewZ(refrDepthSample.x, cameraNear, cameraFar);
      const leaked: TslNode = zR.greaterThan(positionView.z.add(uRefrValidationBias));
      const uvF: TslNode = mix(ruv, screenUV, leaked.select(float(1), float(0)));
      const sceneCol: TslNode = viewportSharedTexture(uvF).rgb;
      const zScene: TslNode = mix(
        zR,
        perspectiveDepthToViewZ(viewportDepthTexture(screenUV).x, cameraNear, cameraFar),
        leaked.select(float(1), float(0)),
      );
      const thick: TslNode = positionView.z.sub(zScene).max(0).min(uRefrMaxThickness);
      const absorb: TslNode = thick.mul(1.25);
      const transmittance: TslNode = vec3(
        exp(absorb.mul(uRefrAbsorption.x.negate())),
        exp(absorb.mul(uRefrAbsorption.y.negate())),
        exp(absorb.mul(uRefrAbsorption.z.negate())),
      );
      const inscat: TslNode = vec3(0.013, 0.036, 0.032).mul(uRefrTurbidity);
      return sceneCol.mul(transmittance).add(inscat.mul(float(1).sub(transmittance)));
    })();

    const ssrHit: TslNode = float(0).toVar();
    const ssrCol: TslNode = Fn(() => {
      if (!screenAvail) return ssrFallback;

      const toCam: TslNode = cameraPosition.sub(worldPos);
      const camDist: TslNode = toCam.length();
      const viewDirN: TslNode = toCam.div(camDist.max(1e-4));
      const rdir: TslNode = reflect(
        viewDirN.negate(),
        vec3(normal.x.mul(0.55), normal.y, normal.z.mul(0.55)).normalize(),
      );
      const dirV: TslNode = cameraViewMatrix.mul(vec4(rdir, 0)).xyz;
      const stepLen: TslNode = clamp(camDist.mul(uReflStepScale), 0.25, 28);
      const jitter: TslNode = interleavedGradientNoise(screenCoordinate.xy);
      const hitUv: TslNode = vec2(0, 0).toVar();

      Loop(uReflMaxSteps.toUint(), ({ i }: { readonly i: any }) => {
        const t: TslNode = float(i).add(jitter).mul(stepLen);
        const pV: TslNode = positionView.add(dirV.mul(t));
        const uvS: TslNode = getScreenPosition(pV, cameraProjectionMatrix);

        If(
          uvS.x.lessThan(0).or(uvS.x.greaterThan(1)).or(uvS.y.lessThan(0)).or(uvS.y.greaterThan(1)),
          () => { Break(); },
        );

        const zS: TslNode = perspectiveDepthToViewZ(viewportDepthTexture(uvS).x, cameraNear, cameraFar);
        If(
          zS.greaterThan(pV.z.add(0.06)).and(zS.lessThan(pV.z.add(stepLen.mul(2.6).add(0.7)))),
          () => {
            ssrHit.assign(1);
            hitUv.assign(uvS);
            Break();
          },
        );
      });

      const terrainFallback: TslNode = vec3(0.12, 0.14, 0.10).mul(uReflTerrainStrength);
      const missFallback: TslNode = mix(terrainFallback, skyReflection.mul(uReflSkyStrength), float(0.72));
      const edge: TslNode = hitUv.sub(0.5).abs().mul(2);
      const edgeFade: TslNode = smoothstep(uReflEdgeFadeStart, uReflEdgeFadeEnd, edge.x.max(edge.y));
      const scene: TslNode = viewportSharedTexture(hitUv).rgb;

      return mix(missFallback, scene, ssrHit.mul(edgeFade));
    })();

    const waterEmissive: TslNode = mix(refrCol, ssrCol, fres);
    const finalLit: TslNode = uRefrEnabled.add(uReflSSREnabled).greaterThan(0).select(
      mix(waterBase, waterEmissive, float(0.6)),
      mix(waterBase, skyReflection, clamp(fres.mul(0.72), 0.0, 0.82)),
    );
    // Two-phase decorrelated foam (Fable5-style): two noise scales, each blended
    // across both phases, with variance renormalization to avoid flat midpoints.
    const foamHashA1: TslNode = fract(sin(dot(worldPos.xz.mul(uFoamNoiseScale).add(advectA.mul(float(0.7))), vec2(12.9898, 78.233))).mul(43758.5453));
    const foamHashB1: TslNode = fract(sin(dot(worldPos.xz.add(vec2(3.71, 1.13)).mul(uFoamNoiseScale).add(advectB.mul(float(0.7))), vec2(12.9898, 78.233))).mul(43758.5453));
    const foamHashA2: TslNode = fract(sin(dot(worldPos.xz.mul(uFoamNoiseScale.mul(0.37)).add(advectA.mul(float(0.41))).add(vec2(5.17, -3.29)), vec2(12.9898, 78.233))).mul(43758.5453));
    const foamHashB2: TslNode = fract(sin(dot(worldPos.xz.add(vec2(7.43, 2.81)).mul(uFoamNoiseScale.mul(0.37)).add(advectB.mul(float(0.41))), vec2(12.9898, 78.233))).mul(43758.5453));
    const streakA: TslNode = smoothstep(float(0.48), float(0.82), sin(flowCoord.x.mul(0.17).sub(uTime.mul(advectSpeed).mul(2.8)).add(sin(flowCoord.y.mul(0.33)).mul(0.6))).mul(0.5).add(0.5));
    const streakB: TslNode = smoothstep(float(0.52), float(0.86), sin(flowCoord.x.mul(0.31).add(flowCoord.y.mul(0.19)).sub(uTime.mul(advectSpeed).mul(3.7))).mul(0.5).add(0.5));
    const varNorm: TslNode = blend.mul(blend).add(float(1).sub(blend).mul(float(1).sub(blend))).sqrt();
    const foamBlend: TslNode = mix(foamHashA1, foamHashB1, blend).sub(0.5).div(varNorm.max(0.01)).add(0.5);
    const foamDetail: TslNode = mix(foamHashA2, foamHashB2, blend).sub(0.5).div(varNorm.max(0.01)).add(0.5);
    const flowBreakup: TslNode = clamp(
      foamBlend.mul(0.42)
        .add(foamDetail.mul(0.26))
        .add(streakA.mul(0.20).mul(uRiverFoamStreakStrength))
        .add(streakB.mul(0.12).mul(uRiverFoamStreakStrength)),
      0.0,
      1.0,
    );
    const breakup: TslNode = smoothstep(
      0.35,
      0.82,
      mix(foamBlend.mul(0.62).add(foamDetail.mul(0.38)), flowBreakup, clamp(riverWeight.mul(0.85).mul(uRiverFoamStreakStrength), 0.0, 1.0)),
    );
    const wetFade: TslNode = smoothstep(0.005, 0.05, depth).mul(aBodyMask);
    const bankContact: TslNode = float(1).sub(smoothstep(uShoreFoamStart, uShoreFoamEnd, depth));
    const shore: TslNode = bankContact.mul(wetFade).mul(breakup).mul(uFoamShoreStrength);
    const riverRapids: TslNode = clamp(rapidSpeed.mul(0.35).add(rapidDrop.mul(0.95)).add(rapidSpeed.mul(rapidDrop).mul(0.70)), 0.0, 1.0)
      .mul(uRiverRapidFoamStrength);
    const riverBankFoam: TslNode = bankContact.mul(riverWeight).mul(float(0.35).add(rapidDrop.mul(0.65)));
    const riverFoam: TslNode = clamp(riverRapids.add(riverBankFoam.mul(uRiverBankFoamStrength)), 0.0, 1.0)
      .mul(uFoamRiverStrength)
      .mul(wetFade)
      .mul(float(0.18).add(breakup.mul(0.82)));
    const foam: TslNode = clamp(shore.add(riverFoam), 0.0, 1.0);

    const backlit: TslNode = pow(max(dot(viewDir, sunDir.negate()), float(0.0)), float(4.0)).mul(0.30);
    const crestScatter: TslNode = smoothstep(float(0.45), float(0.95), foamBlend).mul(0.24).add(rapidMask.mul(0.18));
    const sss: TslNode = mix(vec3(0.01, 0.04, 0.14), shallowTeal, float(0.55))
      .mul(backlit.add(crestScatter))
      .mul(float(1).sub(depthNorm.mul(0.45)));

    const specDot: TslNode = max(dot(reflect(sunDir.negate(), normal), viewDir), float(0.0));
    const sunSpec: TslNode = vec3(1.0, 0.92, 0.76).mul(
      pow(specDot, float(384.0)).mul(1.15).add(pow(specDot, float(96.0)).mul(0.28)),
    );

    const finalWater: TslNode = finalLit.add(sss).add(sunSpec);
    const finalColor: TslNode = mix(
      mix(finalWater, uFoam, foam),
      waterLevelColorTsl(aLevel),
      uClipmapTint.mul(0.18),
    );
    const alpha: TslNode = clamp(uAlpha.add(fres.mul(0.18)), 0.0, 1.0);

    const depthCol: TslNode = vec3(depthNorm);
    const foamCol: TslNode = vec3(foam);
    const fresCol: TslNode = vec3(fres);
    const maskCol: TslNode = vec3(aBodyMask);
    const lv: TslNode = waterLevelColorTsl(aLevel);
    const flowCol: TslNode = vec3(riverDir.x.mul(0.5).add(0.5), riverDir.y.mul(0.5).add(0.5), clamp(riverRapids, 0.0, 1.0));
    const refrDebugCol: TslNode = waterTint;
    const reflDebugCol: TslNode = skyReflection;
    const ssrHitCol: TslNode = vec3(ssrHit, float(0).sub(ssrHit).add(1).mul(0.3), float(0));

    const outCol: TslNode = uDebugMode.equal(0).select(
      finalColor,
      uDebugMode.equal(1).select(
        depthCol,
        uDebugMode.equal(2).select(
          foamCol,
          uDebugMode.equal(3).select(
            fresCol,
            uDebugMode.equal(4).select(
              maskCol,
              uDebugMode.equal(5).select(
                lv,
                uDebugMode.equal(6).select(
                  flowCol,
                  uDebugMode.equal(12).select(
                    refrDebugCol,
                    uDebugMode.equal(13).select(reflDebugCol, ssrHitCol),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
    const outAlpha: TslNode = uDebugMode.equal(0).select(alpha, float(1));
    return vec4(outCol, outAlpha);
  });

  const material = new MeshBasicNodeMaterial();
  material.fragmentNode = fragment();
  material.transparent = true;
  material.depthWrite = false;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.name = "water-node";

  const syncUniformObjects = (v: WaterVisualConfig) => {
    u.uShallowColor.value.setRGB(v.shallowColor[0], v.shallowColor[1], v.shallowColor[2]);
    u.uDeepColor.value.setRGB(v.deepColor[0], v.deepColor[1], v.deepColor[2]);
    u.uFoamColor.value.setRGB(v.foamColor[0], v.foamColor[1], v.foamColor[2]);
  };

  const syncVisual = (v: WaterVisualConfig) => {
    syncUniformObjects(v);
    uShallow.value.copy(u.uShallowColor.value);
    uDeep.value.copy(u.uDeepColor.value);
    uFoam.value.copy(u.uFoamColor.value);
    uAlpha.value = v.alpha;
    uRippleCycle.value = v.rippleCycle;
    uFresnelPower.value = v.fresnel.power;
    uRippleAmp.value = v.rippleAmp;
    uRippleSpeed.value = v.rippleSpeed;
    uRippleScaleA.value = v.rippleScaleA;
    uRippleScaleB.value = v.rippleScaleB;
    uRippleStrengthA.value = v.rippleStrengthA;
    uRippleStrengthB.value = v.rippleStrengthB;
    uRippleLoopDistance.value = v.rippleLoopDistance;
    uLakeBreeze.value.set(v.lakeBreeze[0], v.lakeBreeze[1]);
    uShoreFoamStart.value = v.shoreFoamStart;
    uShoreFoamEnd.value = v.shoreFoamEnd;
    uFoamNoiseScale.value = v.foam.noiseScale;
    uFoamShoreStrength.value = v.foam.shoreStrength;
    uFoamRiverStrength.value = v.foam.riverStrength;
    uFoamSpeedStart.value = v.foam.speedStart;
    uFoamSpeedEnd.value = v.foam.speedEnd;
    uFoamDropStart.value = v.foam.dropStart;
    uFoamDropEnd.value = v.foam.dropEnd;
    uFresnelBase.value = v.fresnel.base;
    uFresnelNormalFlatten.value = v.fresnel.normalFlatten;
    uDepthScale.value = v.color.depthScale;
    uTurbidity.value = v.color.turbidity;
    uRefrStrength.value = v.refraction.strength;
    uRefrValidationBias.value = v.refraction.depthValidationBias;
    uRefrAbsorption.value.set(v.refraction.absorptionR, v.refraction.absorptionG, v.refraction.absorptionB);
    uRefrTurbidity.value = v.refraction.turbidityStrength;
    uRefrEnabled.value = v.refraction.enabled ? 1 : 0;
    uRefrMaxThickness.value = v.refraction.maxThickness;
    uReflSSREnabled.value = v.reflection.ssrEnabled ? 1 : 0;
    uReflMaxSteps.value = v.reflection.maxSteps;
    uReflStepScale.value = v.reflection.stepScale;
    uReflEdgeFadeStart.value = v.reflection.edgeFadeStart;
    uReflEdgeFadeEnd.value = v.reflection.edgeFadeEnd;
    uReflSkyStrength.value = v.reflection.skyFallbackStrength;
    uReflTerrainStrength.value = v.reflection.terrainFallbackStrength;
    material.depthWrite = v.depthWrite;
    material.needsUpdate = true;
  };

  return {
    material,
    setTime: (t) => { u.uTime.value = t; uTime.value = t; },
    setDebugMode: (mode) => { u.uDebugMode.value = mode; uDebugMode.value = mode; },
    setInnerRect: (minX, minZ, maxX, maxZ) => {
      u.uInnerRect.value.set(minX, minZ, maxX, maxZ);
      uInnerRect.value.set(minX, minZ, maxX, maxZ);
    },
    setLevelId: () => { /* level carried per-vertex via aLevel */ },
    setClipmapTint: (enabled) => { u.uClipmapTint.value = enabled ? 1 : 0; uClipmapTint.value = u.uClipmapTint.value; },
    setWireframe: (enabled) => { material.wireframe = enabled; material.needsUpdate = true; },
    updateCamera: (pos) => { u.uCameraPos.value.copy(pos); uCameraPos.value.copy(pos); },
    updateSunDirection: (dir) => { u.uSunDir.value.copy(dir).normalize(); uSunDir.value.copy(u.uSunDir.value); },
    updateVisual: syncVisual,
    dispose: () => { material.dispose(); },
  };
}

function waterLevelColorTsl(level: TslNode): TslNode {
  const c0: TslNode = vec3(0.36, 0.62, 0.95);
  const c1: TslNode = vec3(0.30, 0.86, 0.58);
  const c2: TslNode = vec3(0.94, 0.74, 0.30);
  const c3: TslNode = vec3(0.95, 0.42, 0.46);
  const c4: TslNode = vec3(0.66, 0.46, 0.94);
  const c5: TslNode = vec3(0.42, 0.78, 0.92);
  const idx: TslNode = clamp(level.floor(), 0.0, 5.0);
  return idx.equal(0).select(c0,
    idx.equal(1).select(c1,
      idx.equal(2).select(c2,
        idx.equal(3).select(c3,
          idx.equal(4).select(c4, c5)))));
}
