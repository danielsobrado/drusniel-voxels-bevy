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
  attribute,
  clamp,
  cos,
  dot,
  float,
  Fn,
  max,
  mix,
  normalize,
  or,
  pow,
  positionWorld,
  sin,
  smoothstep,
  uniform,
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
  const uFresnelPower = uniform(u.uFresnelPower.value) as TslNode;
  const uRippleSpeed = uniform(u.uRippleSpeed.value) as TslNode;
  const uRippleAmp = uniform(u.uRippleAmp.value) as TslNode;
  const uShoreFoamStart = uniform(u.uShoreFoamStart.value) as TslNode;
  const uShoreFoamEnd = uniform(u.uShoreFoamEnd.value) as TslNode;
  const uMaxDepth = uniform(u.uMaxDepthForColor.value) as TslNode;
  const uInnerRect = uniform(u.uInnerRect.value) as TslNode;
  const uDebugMode = uniform(u.uDebugMode.value) as TslNode;
  const uCameraPos = uniform(u.uCameraPos.value) as TslNode;
  const uSunDir = uniform(u.uSunDir.value) as TslNode;

  const aTerrainY = attribute("aTerrainY", "float") as TslNode;
  const aBodyMask = attribute("aBodyMask", "float") as TslNode;
  const aFlow = attribute("aFlow", "vec3") as TslNode;
  const aLevel = attribute("aLevel", "float") as TslNode;

  const worldPos: TslNode = positionWorld;

  const fragment = Fn(() => {
    const px: TslNode = worldPos.x;
    const pz: TslNode = worldPos.z;
    const insideInner: TslNode = px.greaterThan(uInnerRect.x)
      .and(px.lessThan(uInnerRect.z))
      .and(pz.greaterThan(uInnerRect.y))
      .and(pz.lessThan(uInnerRect.w));
    const depth: TslNode = worldPos.y.sub(aTerrainY);
    // Discard clipmap-hole pixels and dry vertices in one bool node.
    or(insideInner, depth.lessThanEqual(float(0))).discard();

    const depthNorm: TslNode = clamp(depth.div(uMaxDepth), 0.0, 1.0);
    const flowDir: TslNode = vec3(aFlow.x, 0.0, aFlow.y);
    const flowPhase: TslNode = dot(flowDir.xz, worldPos.xz).mul(0.15).mul(aFlow.z);
    const t: TslNode = uTime.mul(uRippleSpeed).add(flowPhase);
    const g1x: TslNode = cos(px.mul(0.18).add(t.mul(1.3))).mul(0.18).add(cos(px.add(pz).mul(0.13).add(t.mul(0.7))).mul(0.13)).mul(uRippleAmp);
    const g1z: TslNode = sin(pz.mul(0.21).sub(t.mul(1.1))).negate().mul(0.21).add(cos(px.add(pz).mul(0.13).add(t.mul(0.7))).mul(0.13)).mul(uRippleAmp);
    const normal: TslNode = normalize(vec3(g1x.negate(), float(1), g1z.negate()));
    const viewDir: TslNode = normalize(uCameraPos.sub(worldPos));
    const fres: TslNode = pow(float(1).sub(max(dot(viewDir, normal), 0.0)), uFresnelPower);
    const waterColor: TslNode = mix(uShallow, uDeep, depthNorm);
    const sunDir: TslNode = normalize(uSunDir);
    const reflDir: TslNode = sunDir.negate().sub(normal.mul(dot(sunDir.negate(), normal).mul(2.0)));
    const spec: TslNode = pow(max(dot(reflDir, viewDir), 0.0), 32.0);
    const lit: TslNode = waterColor.add(spec.mul(0.15));
    const shore: TslNode = float(1).sub(smoothstep(uShoreFoamStart, uShoreFoamEnd, depth));
    const finalColor: TslNode = mix(lit, uFoam, shore.mul(0.6));
    const alpha: TslNode = clamp(uAlpha.add(fres.mul(0.18)), 0.0, 1.0);

    const depthCol: TslNode = vec3(depthNorm);
    const foamCol: TslNode = vec3(shore);
    const fresCol: TslNode = vec3(fres);
    const maskCol: TslNode = vec3(aBodyMask);
    const lv: TslNode = waterLevelColorTsl(aLevel);

    const outCol: TslNode = uDebugMode.equal(0).select(
      finalColor,
      uDebugMode.equal(1).select(
        depthCol,
        uDebugMode.equal(2).select(
          foamCol,
          uDebugMode.equal(3).select(
            fresCol,
            uDebugMode.equal(4).select(maskCol, lv),
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
    uFresnelPower.value = v.fresnelPower;
    uRippleAmp.value = v.rippleAmp;
    uRippleSpeed.value = v.rippleSpeed;
    uShoreFoamStart.value = v.shoreFoamStart;
    uShoreFoamEnd.value = v.shoreFoamEnd;
    uMaxDepth.value = v.maxDepthForColor;
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
