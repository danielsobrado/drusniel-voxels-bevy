import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  clamp,
  dot,
  exp,
  float,
  Fn,
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
import { buildWaterBodyPresetNodes } from "./water_node_body_presets.js";
import { buildWaterStaticGridNodes } from "./water_node_static_grid.js";
import { buildWaterAtlasGridNodes } from "./water_node_atlas_grid.js";
import { buildWaterGlitter, buildWaterSuspendedScatter } from "./water_node_optics.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const WATER_BACKLIGHT_GAIN = 0.10;

export function createWaterPerfNodeMaterial(params: WaterMaterialParams): WaterMaterialHandle {
  const u = makeWaterUniforms(params);
  const riverMaterial = readRiverMaterialSettings();

  const uTime = uniform(0) as TslNode;
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
  const uShoreDistFoamStart = uniform(params.visual.foam.shoreDistanceStart) as TslNode;
  const uShoreDistFoamEnd = uniform(params.visual.foam.shoreDistanceEnd) as TslNode;
  const uFoamNoiseScale = uniform(u.uFoamNoiseScale.value) as TslNode;
  const uFoamShoreStrength = uniform(u.uFoamShoreStrength.value) as TslNode;
  const uFoamRiverStrength = uniform(u.uFoamRiverStrength.value) as TslNode;
  const uFoamSpeedStart = uniform(u.uFoamSpeedStart.value) as TslNode;
  const uFoamSpeedEnd = uniform(u.uFoamSpeedEnd.value) as TslNode;
  const uFoamDropStart = uniform(u.uFoamDropStart.value) as TslNode;
  const uFoamDropEnd = uniform(u.uFoamDropEnd.value) as TslNode;
  const uFresnelBase = uniform(u.uFresnelBase.value) as TslNode;
  const uFresnelNormalFlatten = uniform(u.uFresnelNormalFlatten.value) as TslNode;
  const uGlitterEnabled = uniform(u.uGlitterEnabled.value) as TslNode;
  const uGlitterTightExponent = uniform(u.uGlitterTightExponent.value) as TslNode;
  const uGlitterTightGain = uniform(u.uGlitterTightGain.value) as TslNode;
  const uGlitterBroadExponent = uniform(u.uGlitterBroadExponent.value) as TslNode;
  const uGlitterBroadGain = uniform(u.uGlitterBroadGain.value) as TslNode;
  const uGlitterLowSunGain = uniform(u.uGlitterLowSunGain.value) as TslNode;
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

  const atlasGrid = params.atlasGrid ? buildWaterAtlasGridNodes(params.atlasGrid) : null;
  const staticGrid = !atlasGrid && params.staticGrid ? buildWaterStaticGridNodes(params.staticGrid) : null;
  const grid = atlasGrid ?? staticGrid;
  const aTerrainY = (grid ? grid.terrainY : attribute("aTerrainY", "float")) as TslNode;
  const aBodyMask = (grid ? grid.bodyMask : attribute("aBodyMask", "float")) as TslNode;
  const aBodyKind = (grid ? grid.bodyKind : attribute("aBodyKind", "float")) as TslNode;
  const aFlow = (grid ? grid.flow : attribute("aFlow", "vec4")) as TslNode;
  const aShoreDistance = (grid ? grid.shoreDistance : attribute("aShoreDistance", "float")) as TslNode;
  const aLevel = attribute("aLevel", "float") as TslNode;
  const worldPos: TslNode = positionWorld;
  const body = buildWaterBodyPresetNodes(aBodyKind, params.visual.bodies);

  const fragment = Fn(() => {
    const finiteWorldBounds: TslNode = uWorldBounds.x.greaterThan(float(0)).and(uWorldBounds.y.greaterThan(float(0)));
    const outsideWorld: TslNode = finiteWorldBounds.and(
      worldPos.x.lessThan(float(0))
        .or(worldPos.x.greaterThan(uWorldBounds.x))
        .or(worldPos.z.lessThan(float(0)))
        .or(worldPos.z.greaterThan(uWorldBounds.y)),
    );
    const insideInner: TslNode = worldPos.x.greaterThan(uInnerRect.x)
      .and(worldPos.x.lessThan(uInnerRect.z))
      .and(worldPos.z.greaterThan(uInnerRect.y))
      .and(worldPos.z.lessThan(uInnerRect.w));
    const depth: TslNode = worldPos.y.sub(aTerrainY);
    const baseDiscard: TslNode = or(outsideWorld, or(insideInner, or(depth.lessThanEqual(float(0)), aBodyMask.lessThanEqual(float(0)))));
    (grid ? or(baseDiscard, grid.wallDiscard(depth, aFlow.z)) : baseDiscard).discard();

    const depthMixRgb: TslNode = float(1).sub(exp(depth.negate().mul(body.absorption)));
    const flowSpeed: TslNode = aFlow.z;
    const flowDrop: TslNode = abs(aFlow.w);
    const riverWeight: TslNode = smoothstep(0.001, 0.02, flowSpeed);
    const riverDir: TslNode = normalize(vec2(aFlow.x, aFlow.y).add(vec2(0.00001, 0.0)));
    const breezeDir: TslNode = normalize(uLakeBreeze.add(vec2(0.00001, 0.0)));
    const mixedDir: TslNode = mix(breezeDir, riverDir, riverWeight) as TslNode;
    const mainDir: TslNode = normalize(mixedDir);
    const sideDir: TslNode = vec2(mainDir.y.negate(), mainDir.x);
    const phase: TslNode = uTime.mul(uRippleSpeed);
    const waveA: TslNode = sin(dot(worldPos.xz, mainDir).mul(uRippleScaleA).add(phase)).mul(uRippleStrengthA);
    const waveB: TslNode = sin(dot(worldPos.xz, sideDir).mul(uRippleScaleB).sub(phase.mul(0.73))).mul(uRippleStrengthB);
    const waveNormal: TslNode = normalize(vec3(waveA.negate().mul(uRippleAmp), float(1), waveB.negate().mul(uRippleAmp)));
    const normal: TslNode = normalize(mix(waveNormal, vec3(0.0, 1.0, 0.0), uFresnelNormalFlatten));

    const viewDir: TslNode = normalize(uCameraPos.sub(worldPos));
    const sunDir: TslNode = normalize(uSunDir);
    const ndotv: TslNode = max(dot(viewDir, normal), 0.0);
    const fresnel: TslNode = uFresnelBase.add(float(1).sub(uFresnelBase).mul(pow(float(1).sub(ndotv), uFresnelPower)));
    const backlit: TslNode = max(dot(viewDir, sunDir.negate()), 0.0);
    const suspended = buildWaterSuspendedScatter(depth, ndotv, sunDir, body);

    const shallowEdge: TslNode = float(1).sub(smoothstep(float(0.18), float(1.8), depth));
    const deepBlue: TslNode = mix(vec3(0.0, 0.025, 0.10), body.deep, float(0.70));
    const shallowTeal: TslNode = mix(body.shallow, vec3(0.0, 0.44, 0.60), float(0.30));
    const riverCenter: TslNode = smoothstep(float(0.85), float(3.6), depth).mul(riverWeight);
    const riverTint: TslNode = mix(
      mix(shallowTeal, vec3(0.02, 0.50, 0.46), clamp(uRiverShallowBankTintStrength.mul(0.42), 0.0, 1.0)),
      mix(deepBlue, vec3(0.0, 0.055, 0.13), clamp(uRiverCenterChannelDarkening.mul(0.35), 0.0, 1.0)),
      riverCenter,
    );
    const waterBase: TslNode = mix(mix(shallowTeal, deepBlue, depthMixRgb), riverTint, clamp(riverWeight.mul(0.72), 0.0, 1.0))
      .add(shallowTeal.mul(body.turbidity).mul(shallowEdge).mul(0.22))
      .add(suspended.color);

    const foamWaveA: TslNode = sin(dot(worldPos.xz.mul(uFoamNoiseScale), vec2(0.91, 1.37)).add(phase.mul(0.25)));
    const foamWaveB: TslNode = sin(dot(worldPos.xz.mul(uFoamNoiseScale.mul(0.47)), vec2(-1.21, 0.73)).sub(phase.mul(0.18)));
    const foamBreakup: TslNode = float(0.35).add(foamWaveA.mul(foamWaveB).mul(0.5).add(0.5).mul(0.65));
    const bankContact: TslNode = max(
      float(1).sub(smoothstep(uShoreFoamStart, uShoreFoamEnd, depth)),
      float(1).sub(smoothstep(uShoreDistFoamStart, uShoreDistFoamEnd, aShoreDistance)),
    );
    const wetFade: TslNode = smoothstep(0.005, 0.05, depth).mul(aBodyMask);
    const shoreDetailFade: TslNode = float(1).sub(smoothstep(0.25, 1.25, aLevel));
    const rapid: TslNode = clamp(smoothstep(uFoamSpeedStart, uFoamSpeedEnd, flowSpeed).mul(0.35).add(smoothstep(uFoamDropStart, uFoamDropEnd, flowDrop).mul(0.95)), 0.0, 1.0);
    const foam: TslNode = clamp(
      bankContact.mul(wetFade).mul(foamBreakup).mul(uFoamShoreStrength).mul(shoreDetailFade)
        .add(rapid.mul(riverWeight).mul(wetFade).mul(uFoamRiverStrength).mul(uRiverRapidFoamStrength))
        .add(bankContact.mul(riverWeight).mul(wetFade).mul(uRiverBankFoamStrength).mul(shoreDetailFade).mul(0.35)),
      0.0,
      1.0,
    );

    const skyReflection: TslNode = mix(vec3(0.04, 0.10, 0.22), vec3(0.25, 0.48, 0.78), clamp(normal.y.mul(0.75).add(0.15), 0.0, 1.0));
    const glitterSpec: TslNode = buildWaterGlitter(normal, viewDir, sunDir, {
      enabled: uGlitterEnabled,
      tightExponent: uGlitterTightExponent,
      tightGain: uGlitterTightGain,
      broadExponent: uGlitterBroadExponent,
      broadGain: uGlitterBroadGain,
      lowSunGain: uGlitterLowSunGain,
    });
    const scatter: TslNode = shallowTeal.mul(pow(backlit, float(3.0)).mul(WATER_BACKLIGHT_GAIN));
    const reflectionScale: TslNode = float(0.70).mul(body.reflectionDamping);
    const lit: TslNode = mix(waterBase, skyReflection, clamp(fresnel.mul(reflectionScale), 0.0, 0.82))
      .add(glitterSpec)
      .add(scatter);
    const finalColor: TslNode = mix(mix(lit, uFoam, foam), waterLevelColorTsl(aLevel), uClipmapTint.mul(0.18));
    const shoreFade: TslNode = smoothstep(float(0.02), float(0.35), depth);
    const alpha: TslNode = clamp(uAlpha.add(fresnel.mul(0.18)), 0.0, 1.0).mul(shoreFade);

    const standardDebug: TslNode = uDebugMode.equal(0).select(
      finalColor,
      uDebugMode.equal(1).select(
        depthMixRgb,
        uDebugMode.equal(2).select(
          vec3(foam),
          uDebugMode.equal(3).select(
            vec3(fresnel),
            uDebugMode.equal(4).select(
              vec3(aBodyMask),
              uDebugMode.equal(5).select(
                waterLevelColorTsl(aLevel),
                vec3(riverDir.x.mul(0.5).add(0.5), riverDir.y.mul(0.5).add(0.5), rapid),
              ),
            ),
          ),
        ),
      ),
    );
    const outColor: TslNode = uDebugMode.equal(15).select(suspended.color, standardDebug);
    return vec4(outColor, uDebugMode.equal(0).select(alpha, float(1)));
  });

  const material = new MeshBasicNodeMaterial();
  if (grid) material.positionNode = grid.positionNode;
  material.fragmentNode = fragment();
  material.transparent = true;
  material.depthWrite = params.visual.depthWrite;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.name = "water-perf-node";

  const syncUniformObjects = (v: WaterVisualConfig) => {
    u.uShallowColor.value.setRGB(v.shallowColor[0], v.shallowColor[1], v.shallowColor[2]);
    u.uDeepColor.value.setRGB(v.deepColor[0], v.deepColor[1], v.deepColor[2]);
    u.uFoamColor.value.setRGB(v.foamColor[0], v.foamColor[1], v.foamColor[2]);
  };

  const syncVisual = (v: WaterVisualConfig) => {
    syncUniformObjects(v);
    body.sync(v.bodies);
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
    uShoreDistFoamStart.value = v.foam.shoreDistanceStart;
    uShoreDistFoamEnd.value = v.foam.shoreDistanceEnd;
    uFoamNoiseScale.value = v.foam.noiseScale;
    uFoamShoreStrength.value = v.foam.shoreStrength;
    uFoamRiverStrength.value = v.foam.riverStrength;
    uFoamSpeedStart.value = v.foam.speedStart;
    uFoamSpeedEnd.value = v.foam.speedEnd;
    uFoamDropStart.value = v.foam.dropStart;
    uFoamDropEnd.value = v.foam.dropEnd;
    uFresnelBase.value = v.fresnel.base;
    uFresnelNormalFlatten.value = v.fresnel.normalFlatten;
    uGlitterEnabled.value = v.glitter.enabled ? 1 : 0;
    uGlitterTightExponent.value = v.glitter.tightExponent;
    uGlitterTightGain.value = v.glitter.tightGain;
    uGlitterBroadExponent.value = v.glitter.broadExponent;
    uGlitterBroadGain.value = v.glitter.broadGain;
    uGlitterLowSunGain.value = v.glitter.lowSunGain;
    if (material.depthWrite !== v.depthWrite) {
      material.depthWrite = v.depthWrite;
      material.needsUpdate = true;
    }
  };

  syncVisual(params.visual);

  return {
    material,
    ...(atlasGrid ? { atlasGrid: atlasGrid.handle } : {}),
    ...(staticGrid ? { staticGrid: staticGrid.handle } : {}),
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
