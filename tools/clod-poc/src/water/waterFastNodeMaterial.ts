import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  clamp,
  dot,
  exp,
  float,
  fract,
  max,
  mix,
  normalize,
  or,
  positionWorld,
  pow,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import { makeWaterUniforms, type WaterMaterialHandle, type WaterMaterialParams } from "./waterMaterial.js";
import type { WaterVisualConfig } from "./waterConfig.js";
import { readRiverMaterialSettings } from "./riverMaterialRuntime.js";
import { waterLevelColorTsl } from "./water_node_level_color.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const WATER_FAST_SPEC_POWER = 72;
const WATER_FAST_SPEC_GAIN = 0.26;
const WATER_FAST_BACKLIGHT_GAIN = 0.10;

export function createWaterFastNodeMaterial(params: WaterMaterialParams): WaterMaterialHandle {
  const u = makeWaterUniforms(params);
  const riverMaterial = readRiverMaterialSettings();

  const uTime = uniform(0) as TslNode;
  const uShallow = uniform(u.uShallowColor.value) as TslNode;
  const uDeep = uniform(u.uDeepColor.value) as TslNode;
  const uFoam = uniform(u.uFoamColor.value) as TslNode;
  const uAlpha = uniform(u.uAlpha.value) as TslNode;
  const uFresnelPower = uniform(u.uFresnelPower.value) as TslNode;
  const uRippleSpeed = uniform(u.uRippleSpeed.value) as TslNode;
  const uRippleAmp = uniform(u.uRippleAmp.value) as TslNode;
  const uRippleScaleA = uniform(u.uRippleScaleA.value) as TslNode;
  const uRippleScaleB = uniform(u.uRippleScaleB.value) as TslNode;
  const uRippleStrengthA = uniform(u.uRippleStrengthA.value) as TslNode;
  const uRippleStrengthB = uniform(u.uRippleStrengthB.value) as TslNode;
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
  const uRiverRapidFoamStrength = uniform(riverMaterial.rapidFoamStrength) as TslNode;
  const uRiverBankFoamStrength = uniform(riverMaterial.bankFoamStrength) as TslNode;
  const uRiverShallowBankTintStrength = uniform(riverMaterial.shallowBankTintStrength) as TslNode;
  const uRiverCenterChannelDarkening = uniform(riverMaterial.centerChannelDarkening) as TslNode;

  const aTerrainY = attribute("aTerrainY", "float") as TslNode;
  const aBodyMask = attribute("aBodyMask", "float") as TslNode;
  const aFlow = attribute("aFlow", "vec4") as TslNode;
  const aLevel = attribute("aLevel", "float") as TslNode;
  const worldPos: TslNode = positionWorld;

  const fragment = () => {
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
    or(outsideWorld, or(insideInner, or(depth.lessThanEqual(float(0)), aBodyMask.lessThanEqual(float(0))))).discard();

    const depthNorm: TslNode = clamp(depth.div(uDepthScale), 0.0, 1.0);
    const flowSpeed: TslNode = aFlow.z;
    const flowDrop: TslNode = abs(aFlow.w);
    const riverWeight: TslNode = smoothstep(0.001, 0.02, flowSpeed);
    const riverDir: TslNode = normalize(vec2(aFlow.x, aFlow.y).add(vec2(0.00001, 0.0)));
    const breezeDir: TslNode = normalize(uLakeBreeze.add(vec2(0.00001, 0.0)));
    const mainDir: TslNode = normalize(mix(breezeDir, riverDir, riverWeight));
    const sideDir: TslNode = vec2(mainDir.y.negate(), mainDir.x);
    const phase: TslNode = uTime.mul(uRippleSpeed);
    const waveA: TslNode = sin(dot(worldPos.xz, mainDir).mul(uRippleScaleA).add(phase)).mul(uRippleStrengthA);
    const waveB: TslNode = sin(dot(worldPos.xz, sideDir).mul(uRippleScaleB).sub(phase.mul(0.73))).mul(uRippleStrengthB);
    const normalRaw: TslNode = normalize(vec3(waveA.negate().mul(uRippleAmp), float(1), waveB.negate().mul(uRippleAmp)));
    const normal: TslNode = normalize(mix(normalRaw, vec3(0.0, 1.0, 0.0), uFresnelNormalFlatten));

    const viewDir: TslNode = normalize(uCameraPos.sub(worldPos));
    const sunDir: TslNode = normalize(uSunDir);
    const ndotv: TslNode = max(dot(viewDir, normal), 0.0);
    const fres: TslNode = uFresnelBase.add(float(1).sub(uFresnelBase).mul(pow(float(1).sub(ndotv), uFresnelPower)));
    const sun: TslNode = max(dot(normal, sunDir), 0.0);
    const backlit: TslNode = max(dot(viewDir, sunDir.negate()), 0.0);

    const shallowEdge: TslNode = float(1).sub(smoothstep(float(0.18), float(1.8), depth));
    const deepBlue: TslNode = mix(vec3(0.0, 0.025, 0.10), uDeep, float(0.70));
    const shallowTeal: TslNode = mix(uShallow, vec3(0.0, 0.44, 0.60), float(0.30));
    const riverCenter: TslNode = smoothstep(float(0.85), float(3.6), depth).mul(riverWeight);
    const riverTint: TslNode = mix(
      mix(shallowTeal, vec3(0.02, 0.50, 0.46), clamp(uRiverShallowBankTintStrength.mul(0.42), 0.0, 1.0)),
      mix(deepBlue, vec3(0.0, 0.055, 0.13), clamp(uRiverCenterChannelDarkening.mul(0.35), 0.0, 1.0)),
      riverCenter,
    );
    const base: TslNode = mix(mix(shallowTeal, deepBlue, depthNorm), riverTint, clamp(riverWeight.mul(0.72), 0.0, 1.0));
    const waterBase: TslNode = base.add(shallowTeal.mul(uTurbidity).mul(shallowEdge).mul(0.22));

    const foamHash: TslNode = fract(sin(dot(worldPos.xz.mul(uFoamNoiseScale).add(mainDir.mul(phase.mul(0.25))), vec2(12.9898, 78.233))).mul(43758.5453));
    const bankContact: TslNode = float(1).sub(smoothstep(uShoreFoamStart, uShoreFoamEnd, depth));
    const rapid: TslNode = clamp(smoothstep(uFoamSpeedStart, uFoamSpeedEnd, flowSpeed).mul(0.35).add(smoothstep(uFoamDropStart, uFoamDropEnd, flowDrop).mul(0.95)), 0.0, 1.0);
    const shoreFoam: TslNode = bankContact.mul(foamHash).mul(uFoamShoreStrength);
    const riverFoam: TslNode = rapid.mul(riverWeight).mul(uFoamRiverStrength).mul(uRiverRapidFoamStrength)
      .add(bankContact.mul(riverWeight).mul(uRiverBankFoamStrength).mul(0.35));
    const foam: TslNode = clamp(shoreFoam.add(riverFoam), 0.0, 1.0);

    const skyReflection: TslNode = mix(vec3(0.04, 0.10, 0.22), vec3(0.25, 0.48, 0.78), clamp(normal.y.mul(0.75).add(0.15), 0.0, 1.0));
    const spec: TslNode = vec3(1.0, 0.92, 0.78).mul(pow(sun, float(WATER_FAST_SPEC_POWER)).mul(WATER_FAST_SPEC_GAIN));
    const scatter: TslNode = shallowTeal.mul(pow(backlit, float(3.0)).mul(WATER_FAST_BACKLIGHT_GAIN));
    const lit: TslNode = mix(waterBase, skyReflection, clamp(fres.mul(0.70), 0.0, 0.82)).add(spec).add(scatter);
    const finalColor: TslNode = mix(mix(lit, uFoam, foam), waterLevelColorTsl(aLevel), uClipmapTint.mul(0.18));
    const alpha: TslNode = clamp(uAlpha.add(fres.mul(0.18)), 0.0, 1.0);

    const debugDepth: TslNode = vec3(depthNorm);
    const debugFoam: TslNode = vec3(foam);
    const debugFresnel: TslNode = vec3(fres);
    const debugMask: TslNode = vec3(aBodyMask);
    const debugFlow: TslNode = vec3(riverDir.x.mul(0.5).add(0.5), riverDir.y.mul(0.5).add(0.5), rapid);
    const outCol: TslNode = uDebugMode.equal(0).select(
      finalColor,
      uDebugMode.equal(1).select(
        debugDepth,
        uDebugMode.equal(2).select(
          debugFoam,
          uDebugMode.equal(3).select(
            debugFresnel,
            uDebugMode.equal(4).select(
              debugMask,
              uDebugMode.equal(5).select(waterLevelColorTsl(aLevel), debugFlow),
            ),
          ),
        ),
      ),
    );
    return vec4(outCol, uDebugMode.equal(0).select(alpha, float(1)));
  };

  const material = new MeshBasicNodeMaterial();
  material.fragmentNode = fragment();
  material.transparent = true;
  material.depthWrite = params.visual.depthWrite;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.name = "water-fast-node";

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
    uFresnelPower.value = v.fresnel.power;
    uRippleAmp.value = v.rippleAmp;
    uRippleSpeed.value = v.rippleSpeed;
    uRippleScaleA.value = v.rippleScaleA;
    uRippleScaleB.value = v.rippleScaleB;
    uRippleStrengthA.value = v.rippleStrengthA;
    uRippleStrengthB.value = v.rippleStrengthB;
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
    if (material.depthWrite !== v.depthWrite) {
      material.depthWrite = v.depthWrite;
      material.needsUpdate = true;
    }
  };

  syncVisual(params.visual);

  return {
    material,
    setTime: (t) => { uTime.value = t; },
    setDebugMode: (mode) => { uDebugMode.value = mode; },
    setInnerRect: (minX, minZ, maxX, maxZ) => { uInnerRect.value.set(minX, minZ, maxX, maxZ); },
    setLevelId: () => {},
    setClipmapTint: (enabled) => { uClipmapTint.value = enabled ? 1 : 0; },
    setWireframe: (enabled) => {
      material.wireframe = enabled;
      material.needsUpdate = true;
    },
    updateCamera: (pos) => { uCameraPos.value.copy(pos); },
    updateSunDirection: (dir) => { uSunDir.value.copy(dir).normalize(); },
    updateVisual: syncVisual,
    dispose: () => { material.dispose(); },
  };
}
