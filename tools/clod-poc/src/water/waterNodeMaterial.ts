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
  clamp,
  cos,
  dot,
  float,
  Fn,
  fract,
  max,
  mix,
  normalize,
  or,
  pow,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { makeWaterUniforms, type WaterMaterialHandle, type WaterMaterialParams } from "./waterMaterial.js";
import type { WaterVisualConfig } from "./waterConfig.js";

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
    const lit: TslNode = waterColor.add(spec.mul(0.12)).add(fres.mul(0.08));
    const foamHash: TslNode = fract(sin(dot(worldPos.xz.mul(uFoamNoiseScale).add(advectDir.mul(uTime.mul(0.05))), vec2(12.9898, 78.233))).mul(43758.5453));
    const breakup: TslNode = smoothstep(0.22, 0.82, foamHash);
    const wetFade: TslNode = smoothstep(0.005, 0.05, depth).mul(aBodyMask);
    const shore: TslNode = float(1).sub(smoothstep(uShoreFoamStart, uShoreFoamEnd, depth)).mul(wetFade).mul(breakup).mul(uFoamShoreStrength);
    const riverFast: TslNode = smoothstep(uFoamSpeedStart, uFoamSpeedEnd, aFlow.z);
    const riverDrop: TslNode = smoothstep(uFoamDropStart, uFoamDropEnd, aFlow.w);
    const riverFoam: TslNode = riverFast.mul(riverDrop).mul(uFoamRiverStrength).mul(wetFade).mul(float(0.25).add(breakup.mul(0.75)));
    const foam: TslNode = clamp(shore.add(riverFoam), 0.0, 1.0);
    const finalColor: TslNode = mix(mix(lit, uFoam, foam), waterLevelColorTsl(aLevel), uClipmapTint.mul(0.18));
    const alpha: TslNode = clamp(uAlpha.add(fres.mul(0.18)), 0.0, 1.0);

    const depthCol: TslNode = vec3(depthNorm);
    const foamCol: TslNode = vec3(foam);
    const fresCol: TslNode = vec3(fres);
    const maskCol: TslNode = vec3(aBodyMask);
    const lv: TslNode = waterLevelColorTsl(aLevel);
    const flowCol: TslNode = vec3(riverDir.x.mul(0.5).add(0.5), riverDir.y.mul(0.5).add(0.5), clamp(aFlow.z.div(max(uFoamSpeedEnd, 0.001)), 0.0, 1.0));

    const outCol: TslNode = uDebugMode.equal(0).select(
      finalColor,
      uDebugMode.equal(1).select(
        depthCol,
        uDebugMode.equal(2).select(
          foamCol,
          uDebugMode.equal(3).select(
            fresCol,
            uDebugMode.equal(4).select(maskCol, uDebugMode.equal(5).select(lv, flowCol)),
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
  material.depthWrite = params.visual.depthWrite;
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
  const idx: TslNode = clamp(level.floor(), 0.0, 4.0);
  return idx.equal(0).select(c0,
    idx.equal(1).select(c1,
      idx.equal(2).select(c2,
        idx.equal(3).select(c3, c4))));
}
