import * as THREE from "three";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import {
  Fn,
  If,
  clamp,
  dot,
  float,
  getScreenPosition,
  getViewPosition,
  luminance,
  mix,
  screenSize,
  screenUV,
  smoothstep,
  texture,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

export type TslAny = any;

const DEFAULT_ALPHA = 1.0;
const VIGNETTE_SCALE = 1.6;
const CONTACT_SHADOW_STEPS = 8;
const CONTACT_SHADOW_MAX_DISTANCE_M = 260;
const CONTACT_SHADOW_FULL_DISTANCE_M = 120;
const CONTACT_SHADOW_DEPTH_RANGE_FACTOR = 0.85;
const BOUNCE_GOLDEN_ANGLE = 2.399963;
const GTAO_GOLDEN_ANGLE = 2.399963;
const GTAO_DIRECT_LIGHT_LUMA_START = 1.2;
const GTAO_DIRECT_LIGHT_LUMA_END = 4.0;
const GTAO_DIRECT_LIGHT_REDUCTION = 0.75;
const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

const tslMix = mix as unknown as (a: TslAny, b: TslAny, amount: TslAny) => TslAny;

export interface TraaNodeInput {
  sourceRgb: TslAny;
  depthTex: TslAny;
  camera: THREE.Camera;
  projectionInverse: TslAny;
  cameraWorld: TslAny;
  prevView: TslAny;
  prevProjection: TslAny;
}

export function createTraaPostProcessNode(input: TraaNodeInput): TslAny {
  const velocity = {
    load: (texel: TslAny): TslAny => {
      const uv = texel.div(screenSize);
      const depth = (input.depthTex.load(texel) as TslAny).x;
      const posView = getViewPosition(uv, depth, input.projectionInverse) as TslAny;
      const posWorld = input.cameraWorld.mul(vec4(posView, 1)).xyz;
      const posPrevView = input.prevView.mul(vec4(posWorld, 1)).xyz;
      const clipPrev = input.prevProjection.mul(vec4(posPrevView, 1));
      const uvPrevRaw = clipPrev.xy.div(clipPrev.w).mul(0.5).add(0.5);
      const uvPrev = vec2(uvPrevRaw.x, uvPrevRaw.y.oneMinus());
      return vec4(uv.sub(uvPrev).mul(vec2(2, -2)), 0, 1);
    },
  } as TslAny;

  return traa(vec4(input.sourceRgb, DEFAULT_ALPHA), input.depthTex, velocity, input.camera as TslAny) as TslAny;
}

export interface GtaoNodeInput {
  sourceRgb: TslAny;
  depthTex: TslAny;
  projectionInverse: TslAny;
  strength: TslAny;
  radius: TslAny;
  maxDistance: TslAny;
  fadeEnd: TslAny;
  depthBias: TslAny;
  depthTolerance: TslAny;
  minUvRadius: TslAny;
  maxUvRadius: TslAny;
  samples: number;
}

export function createGtaoPostProcessNode(input: GtaoNodeInput): TslAny {
  return Fn((): TslAny => {
    const result = float(1).toVar();
    const depth = input.depthTex.x;
    const isSky = depth.lessThanEqual(1e-7).or(depth.greaterThanEqual(0.9999999));
    const viewPosition = getViewPosition(screenUV, depth, input.projectionInverse) as TslAny;
    const distance = viewPosition.length();
    If(isSky.not().and(distance.lessThan(input.fadeEnd)), () => {
      const radiusUv = clamp(input.radius.div(distance.max(0.0001)), input.minUvRadius, input.maxUvRadius);
      const occlusionSum = float(0).toVar();
      const weightSum = float(0).toVar();
      for (let tap = 0; tap < input.samples; tap++) {
        const angle = tap * GTAO_GOLDEN_ANGLE + 0.35;
        const radius = Math.sqrt((tap + 0.5) / input.samples);
        const uvSample = screenUV.add(vec2(Math.cos(angle), Math.sin(angle)).mul(radiusUv).mul(radius));
        const inFrame = uvSample.x
          .greaterThan(0.001)
          .and(uvSample.x.lessThan(0.999))
          .and(uvSample.y.greaterThan(0.001))
          .and(uvSample.y.lessThan(0.999));
        const sampleDepth = texture(input.depthTex.value, uvSample).x;
        const sampleSky = sampleDepth.lessThanEqual(1e-7).or(sampleDepth.greaterThanEqual(0.9999999));
        const sampleView = getViewPosition(uvSample, sampleDepth, input.projectionInverse) as TslAny;
        const sampleCloser = sampleView.z.sub(viewPosition.z).greaterThan(input.depthBias);
        const sameSurface = smoothstep(input.depthTolerance, input.depthBias, sampleView.sub(viewPosition).length());
        const support = inFrame.and(sampleSky.not()).and(sampleCloser).select(float(1), float(0));
        occlusionSum.addAssign(sameSurface.mul(support));
        weightSum.addAssign(inFrame.and(sampleSky.not()).select(float(1), float(0)));
      }
      const rawAo = float(1).sub(occlusionSum.div(weightSum.max(1e-3)).mul(input.strength));
      const farFade = smoothstep(input.fadeEnd, input.maxDistance, distance);
      const directReduction = smoothstep(
        GTAO_DIRECT_LIGHT_LUMA_START,
        GTAO_DIRECT_LIGHT_LUMA_END,
        luminance(input.sourceRgb),
      ).mul(GTAO_DIRECT_LIGHT_REDUCTION);
      const litAo = tslMix(rawAo, float(1), directReduction);
      result.assign(tslMix(float(1), litAo, farFade));
    });
    return clamp(result, 0, 1);
  })();
}

export interface ContactShadowNodeInput {
  depthTex: TslAny;
  projectionInverse: TslAny;
  projection: TslAny;
  view: TslAny;
  sunDirection: TslAny;
  strength: TslAny;
  radius: TslAny;
  depthBias: TslAny;
}

export function createContactShadowPostProcessNode(input: ContactShadowNodeInput): TslAny {
  return Fn((): TslAny => {
    const result = float(1).toVar();
    const depth = input.depthTex.x;
    const isSky = depth.lessThanEqual(1e-7).or(depth.greaterThanEqual(0.9999999));
    const viewPosition = getViewPosition(screenUV, depth, input.projectionInverse) as TslAny;
    const distance = viewPosition.length();
    If(isSky.not().and(distance.lessThan(CONTACT_SHADOW_MAX_DISTANCE_M)), () => {
      const sunView = input.view.mul(vec4(input.sunDirection, 0)).xyz.normalize();
      const hitF = float(2).toVar();
      for (let step = 1; step <= CONTACT_SHADOW_STEPS; step++) {
        const fraction = (step / CONTACT_SHADOW_STEPS) ** 1.6;
        If(hitF.greaterThan(1.5), () => {
          const sampleView = viewPosition.add(sunView.mul(input.radius).mul(fraction));
          const uvSample = getScreenPosition(sampleView, input.projection);
          const inFrame = uvSample.x
            .greaterThan(0.001)
            .and(uvSample.x.lessThan(0.999))
            .and(uvSample.y.greaterThan(0.001))
            .and(uvSample.y.lessThan(0.999));
          const depthSample = texture(input.depthTex.value, uvSample).x;
          const bufferView = getViewPosition(uvSample, depthSample, input.projectionInverse) as TslAny;
          const depthDelta = bufferView.z.sub(sampleView.z);
          const hit = depthDelta
            .greaterThan(input.depthBias)
            .and(depthDelta.lessThan(input.radius.mul(CONTACT_SHADOW_DEPTH_RANGE_FACTOR)))
            .and(inFrame);
          If(hit, () => {
            hitF.assign(fraction);
          });
        });
      }
      const occlusion = hitF.lessThan(1.5).select(float(1).sub(hitF.mul(0.5)), float(0));
      const fade = smoothstep(CONTACT_SHADOW_MAX_DISTANCE_M, CONTACT_SHADOW_FULL_DISTANCE_M, distance);
      result.assign(float(1).sub(occlusion.mul(input.strength).mul(fade)));
    });
    return result;
  })();
}

export interface BounceNodeInput {
  sourceRgb: TslAny;
  beauty: TslAny;
  depthTex: TslAny;
  projectionInverse: TslAny;
  strength: TslAny;
  radius: TslAny;
  maxDistance: TslAny;
  depthTolerance: TslAny;
  minUvRadius: TslAny;
  maxUvRadius: TslAny;
  taps: number;
}

export function createBouncePostProcessNode(input: BounceNodeInput): TslAny {
  return Fn((): TslAny => {
    const result = input.sourceRgb.toVar();
    const depth = input.depthTex.x;
    const isSky = depth.lessThanEqual(1e-7).or(depth.greaterThanEqual(0.9999999));
    const viewPosition = getViewPosition(screenUV, depth, input.projectionInverse) as TslAny;
    const distance = viewPosition.length();
    If(isSky.not().and(distance.lessThan(input.maxDistance)), () => {
      const radiusUv = clamp(input.radius.div(distance.max(0.0001)), input.minUvRadius, input.maxUvRadius);
      const sum = vec3(0).toVar();
      const weightSum = float(0).toVar();
      for (let tap = 0; tap < input.taps; tap++) {
        const angle = tap * BOUNCE_GOLDEN_ANGLE + 0.7;
        const radius = Math.sqrt((tap + 0.5) / input.taps);
        const uvSample = screenUV.add(vec2(Math.cos(angle), Math.sin(angle)).mul(radiusUv).mul(radius));
        const inFrame = uvSample.x
          .greaterThan(0.001)
          .and(uvSample.x.lessThan(0.999))
          .and(uvSample.y.greaterThan(0.001))
          .and(uvSample.y.lessThan(0.999));
        const depthSample = texture(input.depthTex.value, uvSample).x;
        const sampleSky = depthSample.lessThanEqual(1e-7).or(depthSample.greaterThanEqual(0.9999999));
        const sampleView = getViewPosition(uvSample, depthSample, input.projectionInverse) as TslAny;
        const support = smoothstep(input.depthTolerance, 0.05, sampleView.sub(viewPosition).length())
          .mul(inFrame.and(sampleSky.not()).select(float(1), float(0)));
        sum.addAssign(texture(input.beauty.value, uvSample).rgb.mul(support));
        weightSum.addAssign(support);
      }
      const receiverLum = luminance(input.sourceRgb).add(0.25);
      const receiverTint = input.sourceRgb.div(receiverLum);
      const fade = smoothstep(input.maxDistance, input.maxDistance.mul(0.5), distance);
      const bounce = sum.div(weightSum.max(1e-3)).mul(receiverTint).mul(input.strength).mul(fade);
      result.assign(input.sourceRgb.add(bounce));
    });
    return result;
  })();
}

export interface GradeNodeInput {
  sourceRgb: TslAny;
  postRgb: TslAny;
  autoExposure: TslAny;
  exposure: TslAny;
  contrast: TslAny;
  saturation: TslAny;
  vignette: TslAny;
  opacity: TslAny;
  whiteBalance: TslAny;
  shadowTint: TslAny;
  shadowAmount: TslAny;
  highlightTint: TslAny;
  highlightAmount: TslAny;
}

export function createGradePostProcessNode(input: GradeNodeInput): TslAny {
  return Fn((): TslAny => {
    const balanced = input.postRgb.mul(input.exposure).mul(input.autoExposure).mul(input.whiteBalance);
    const luma = dot(balanced, vec3(...LUMA_WEIGHTS));
    const shadowMask = smoothstep(0.45, 0.08, luma).mul(input.shadowAmount);
    const shadowed = tslMix(balanced, balanced.mul(input.shadowTint), shadowMask);
    const highlightMask = smoothstep(0.35, 0.95, luma).mul(input.highlightAmount);
    const tinted = tslMix(shadowed, shadowed.mul(input.highlightTint), highlightMask);
    const contrasted = tinted.sub(0.5).mul(input.contrast).add(0.5);
    const saturated = tslMix(luminance(contrasted) as TslAny, contrasted, input.saturation);
    const center = screenUV.sub(0.5);
    const vignette = clamp(float(1).sub(dot(center, center).mul(input.vignette).mul(VIGNETTE_SCALE)), 0, 1);
    const graded = saturated.mul(vignette);
    return tslMix(input.sourceRgb, graded, clamp(input.opacity, 0, 1));
  })();
}
