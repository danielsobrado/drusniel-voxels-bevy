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

/* eslint-disable @typescript-eslint/no-explicit-any */
// three 0.184's TSL node graph types are intentionally loose: extension methods
// (.mul/.select/.discard/...) are merged onto nodes via module augmentation, and
// per-node generic params do not line up across vec3()/select() overloads. The
// grass NodeMaterial (gpu/grass_node_material.ts) uses the same `TslNode` alias.
// The core water modules (config/field/clipmap/debug) are fully strict, no `any`.
type TslNode = any;

export function createWaterNodeMaterialImpl(params: WaterMaterialParams): WaterMaterialHandle {
  const u = makeWaterUniforms(params);

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
    const breezeDir: TslNode = normalize(uLakeBreeze.add(vec2(0.00001, 0.0)));
    const riverWeight: TslNode = smoothstep(0.001, 0.02, aFlow.z);
    const mixedDir: TslNode = mix(breezeDir, riverDir, riverWeight) as TslNode;
    const advectDir: TslNode = normalize(mixedDir);
    const breezeSpeed: TslNode = max(abs(uLakeBreeze.x), abs(uLakeBreeze.y));
    const advectSpeed: TslNode = max(breezeSpeed, aFlow.z).mul(uRippleSpeed);
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
    const gradX: TslNode = mix(gAx, gBx, blend).mul(uRippleAmp);
    const gradZ: TslNode = mix(gAz, gBz, blend).mul(uRippleAmp);
    const normal: TslNode = normalize(vec3(gradX.negate(), float(1), gradZ.negate()));
    const viewDir: TslNode = normalize(uCameraPos.sub(worldPos));
    const fresnelNormal: TslNode = normalize(mix(normal, vec3(0.0, 1.0, 0.0), uFresnelNormalFlatten));
    const fres: TslNode = uFresnelBase.add(float(1).sub(uFresnelBase).mul(pow(float(1).sub(max(dot(viewDir, fresnelNormal), 0.0)), uFresnelPower)));
    const waterColor: TslNode = mix(mix(uShallow, uDeep, depthNorm), uShallow, uTurbidity.mul(float(1).sub(depthNorm)).mul(0.45));
    const sunDir: TslNode = normalize(uSunDir);
    const reflDir: TslNode = sunDir.negate().sub(normal.mul(dot(sunDir.negate(), normal).mul(2.0)));
    const spec: TslNode = pow(max(dot(reflDir, viewDir), 0.0), 32.0);
    const lit: TslNode = waterColor.add(spec.mul(0.12)).add(fres.mul(0.08)).add(causticVal.mul(vec3(0.12, 0.18, 0.15)));

    // ---- Screen-space refraction + SSR (WebGPU only) -------------------------
    // Gate viewport texture access on screen-resource availability. If the renderer
    // doesn't expose depth/color textures, fall back to the base water shading.
    const screenAvail = getWaterScreenResources().available;
    const refrFallback: TslNode = lit;
    const ssrFallback: TslNode = lit;

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
      const zScene: TslNode = mix(zR, perspectiveDepthToViewZ(viewportDepthTexture(screenUV).x, cameraNear, cameraFar), leaked.select(float(1), float(0)));
      const thick: TslNode = positionView.z.sub(zScene).max(0).min(uRefrMaxThickness);
      const absorb: TslNode = thick.mul(1.25);
      const T: TslNode = vec3(
        exp(absorb.mul(uRefrAbsorption.x.negate())),
        exp(absorb.mul(uRefrAbsorption.y.negate())),
        exp(absorb.mul(uRefrAbsorption.z.negate())),
      );
      const inscat: TslNode = vec3(0.013, 0.036, 0.032).mul(uRefrTurbidity);
      return sceneCol.mul(T).add(inscat.mul(float(1).sub(T)));
    })();

    const ssrHit: TslNode = float(0).toVar();
    const ssrCol: TslNode = Fn(() => {
      if (!screenAvail) return ssrFallback;
      const toCam: TslNode = cameraPosition.sub(worldPos);
      const camDist: TslNode = toCam.length();
      const viewDirN: TslNode = toCam.div(camDist.max(1e-4));
      const rdir: TslNode = reflect(viewDirN.negate(), vec3(normal.x.mul(0.55), normal.y, normal.z.mul(0.55)).normalize());
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
          () => { ssrHit.assign(1); hitUv.assign(uvS); Break(); },
        );
      });
      // Terrain-height fallback: darken toward terrain ambient when SSR misses
      const skyFallback: TslNode = vec3(0.18, 0.32, 0.45).mul(uReflSkyStrength);
      const terrainFallback: TslNode = vec3(0.12, 0.14, 0.10).mul(uReflTerrainStrength);
      const missFallback: TslNode = mix(terrainFallback, skyFallback, float(0.5));
      const e: TslNode = hitUv.sub(0.5).abs().mul(2);
      const edgeFade: TslNode = smoothstep(uReflEdgeFadeStart, uReflEdgeFadeEnd, e.x.max(e.y));
      const scene: TslNode = viewportSharedTexture(hitUv).rgb;
      return mix(missFallback, scene, ssrHit.mul(edgeFade));
    })();

    // Blend refraction and reflection using Fresnel
    const waterEmissive: TslNode = mix(refrCol, ssrCol, fres);
    const finalLit: TslNode = uRefrEnabled.add(uReflSSREnabled).greaterThan(0).select(
      mix(lit, waterEmissive, float(0.6)),
      lit,
    );
    // Two-phase decorrelated foam (Fable5-style): two noise scales, each blended
    // across both phases, with variance renormalization to avoid flat midpoints.
    const foamHashA1: TslNode = fract(sin(dot(worldPos.xz.mul(uFoamNoiseScale).add(advectA.mul(float(0.7))), vec2(12.9898, 78.233))).mul(43758.5453));
    const foamHashB1: TslNode = fract(sin(dot(worldPos.xz.add(vec2(3.71, 1.13)).mul(uFoamNoiseScale).add(advectB.mul(float(0.7))), vec2(12.9898, 78.233))).mul(43758.5453));
    const foamHashA2: TslNode = fract(sin(dot(worldPos.xz.mul(uFoamNoiseScale.mul(0.37)).add(advectA.mul(float(0.41))).add(vec2(5.17, -3.29)), vec2(12.9898, 78.233))).mul(43758.5453));
    const foamHashB2: TslNode = fract(sin(dot(worldPos.xz.add(vec2(7.43, 2.81)).mul(uFoamNoiseScale.mul(0.37)).add(advectB.mul(float(0.41))), vec2(12.9898, 78.233))).mul(43758.5453));
    const varNorm: TslNode = blend.mul(blend).add(float(1).sub(blend).mul(float(1).sub(blend))).sqrt();
    const foamBlend: TslNode = mix(foamHashA1, foamHashB1, blend).sub(0.5).div(varNorm.max(0.01)).add(0.5);
    const foamDetail: TslNode = mix(foamHashA2, foamHashB2, blend).sub(0.5).div(varNorm.max(0.01)).add(0.5);
    const breakup: TslNode = smoothstep(0.35, 0.82, foamBlend.mul(0.62).add(foamDetail.mul(0.38)));
    const wetFade: TslNode = smoothstep(0.005, 0.05, depth).mul(aBodyMask);
    const shore: TslNode = float(1).sub(smoothstep(uShoreFoamStart, uShoreFoamEnd, depth)).mul(wetFade).mul(breakup).mul(uFoamShoreStrength);
    const riverFast: TslNode = smoothstep(uFoamSpeedStart, uFoamSpeedEnd, aFlow.z);
    const riverDrop: TslNode = smoothstep(uFoamDropStart, uFoamDropEnd, aFlow.w);
    const riverFoam: TslNode = riverFast.mul(riverDrop).mul(uFoamRiverStrength).mul(wetFade).mul(float(0.25).add(breakup.mul(0.75)));
    const foam: TslNode = clamp(shore.add(riverFoam), 0.0, 1.0);
    const finalColor: TslNode = mix(mix(finalLit, uFoam, foam), waterLevelColorTsl(aLevel), uClipmapTint.mul(0.18));
    const alpha: TslNode = clamp(uAlpha.add(fres.mul(0.18)), 0.0, 1.0);

    const depthCol: TslNode = vec3(depthNorm);
    const foamCol: TslNode = vec3(foam);
    const fresCol: TslNode = vec3(fres);
    const maskCol: TslNode = vec3(aBodyMask);
    const lv: TslNode = waterLevelColorTsl(aLevel);
    const flowCol: TslNode = vec3(riverDir.x.mul(0.5).add(0.5), riverDir.y.mul(0.5).add(0.5), clamp(aFlow.z.div(max(uFoamSpeedEnd, 0.001)), 0.0, 1.0));
    const refrDebugCol: TslNode = refrCol;
    const reflDebugCol: TslNode = ssrCol;
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
