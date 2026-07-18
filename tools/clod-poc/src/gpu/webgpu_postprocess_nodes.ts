import * as THREE from "three";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import {
  Fn,
  If,
  clamp,
  dot,
  exp2,
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
import { inverseSmoothstep } from "./postfx_mask_math.js";

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
        const sameSurface = inverseSmoothstep(
          input.depthBias,
          input.depthTolerance,
          sampleView.sub(viewPosition).length(),
        );
        const support = inFrame.and(sampleSky.not()).and(sampleCloser).select(float(1), float(0));
        occlusionSum.addAssign(sameSurface.mul(support));
        weightSum.addAssign(inFrame.and(sampleSky.not()).select(float(1), float(0)));
      }
      const rawAo = float(1).sub(occlusionSum.div(weightSum.max(1e-3)).mul(input.strength));
      const distanceWeight = inverseSmoothstep(input.maxDistance, input.fadeEnd, distance);
      const directReduction = smoothstep(
        GTAO_DIRECT_LIGHT_LUMA_START,
        GTAO_DIRECT_LIGHT_LUMA_END,
        luminance(input.sourceRgb),
      ).mul(GTAO_DIRECT_LIGHT_REDUCTION);
      const litAo = tslMix(rawAo, float(1), directReduction);
      result.assign(tslMix(float(1), litAo, distanceWeight));
    });
    return clamp(result, 0, 1);
  })();
}

export interface GtaoHalfResLayerInput {
  depthTex: TslAny;
  projectionInverse: TslAny;
  strength: TslAny;
  radius: TslAny;
  fadeEnd: TslAny;
  depthBias: TslAny;
  depthTolerance: TslAny;
  minUvRadius: TslAny;
  maxUvRadius: TslAny;
  samples: number;
}

/**
 * Raw ambient occlusion for the merged half-res pass. Same horizon gather as the
 * full-res node, but it emits only the occlusion term (no distance fade, no
 * direct-light reduction) — those belong to the bilateral upsample that reads
 * this attachment back at full resolution. The attachment is single-channel, so
 * the value is written to `.x`.
 */
export function createGtaoHalfResLayerNode(input: GtaoHalfResLayerInput): TslAny {
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
        const sameSurface = inverseSmoothstep(
          input.depthBias,
          input.depthTolerance,
          sampleView.sub(viewPosition).length(),
        );
        const support = inFrame.and(sampleSky.not()).and(sampleCloser).select(float(1), float(0));
        occlusionSum.addAssign(sameSurface.mul(support));
        weightSum.addAssign(inFrame.and(sampleSky.not()).select(float(1), float(0)));
      }
      result.assign(float(1).sub(occlusionSum.div(weightSum.max(1e-3)).mul(input.strength)));
    });
    return vec4(clamp(result, 0, 1), 0, 0, 1);
  })();
}

export interface GtaoUpsampleInput {
  aoTex: TslAny;
  depthTex: TslAny;
  beautyRgb: TslAny;
  projectionInverse: TslAny;
  fadeStart: TslAny;
  fadeEnd: TslAny;
}

/**
 * Joint-bilateral upsample of the half-res AO, guided by full-res depth. Plain
 * bilinear at half resolution streaks on grazing terrain; weighting the four
 * half-res taps by view-depth similarity restores the near-field contact
 * darkening. A gated fallback prevents the horizon-black collapse: when every
 * tap is rejected (a half-res texel spans tens of metres of depth on grazing
 * slopes) the weighted result would fabricate ao=0, so support-free pixels fall
 * back to the plain average. Distance fade and an indirect-only reduction on
 * sun-lit pixels are applied here rather than in the half-res layer.
 */
export function createGtaoBilateralUpsampleNode(input: GtaoUpsampleInput): TslAny {
  return Fn((): TslAny => {
    const viewC = getViewPosition(screenUV, input.depthTex.x, input.projectionInverse) as TslAny;
    const dist = viewC.length();
    const farK = smoothstep(input.fadeStart, input.fadeEnd, dist);
    const directK = smoothstep(
      GTAO_DIRECT_LIGHT_LUMA_START,
      GTAO_DIRECT_LIGHT_LUMA_END,
      luminance(input.beautyRgb),
    ).mul(GTAO_DIRECT_LIGHT_REDUCTION);
    const halfTexel = vec2(1).div(screenSize.mul(0.5));
    const zC = viewC.z;
    const acc = float(0).toVar();
    const avg = float(0).toVar();
    const wsum = float(1e-4).toVar();
    for (const [ox, oy] of [
      [-0.5, -0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [0.5, 0.5],
    ] as const) {
      const uvi = screenUV.add(halfTexel.mul(vec2(ox, oy)));
      const ai = (input.aoTex.sample(uvi) as TslAny).x;
      const zi = (getViewPosition(uvi, (input.depthTex.sample(uvi) as TslAny).x, input.projectionInverse) as TslAny).z;
      const w = exp2(zi.sub(zC).abs().mul(-3.5));
      acc.addAssign(ai.mul(w));
      avg.addAssign(ai);
      wsum.addAssign(w);
    }
    const aoRaw = tslMix(avg.mul(0.25), acc.div(wsum), smoothstep(0.002, 0.02, wsum));
    return tslMix(tslMix(aoRaw, float(1), directK), float(1), farK);
  })();
}

export interface BounceHalfResLayerInput {
  beauty: TslAny;
  depthTex: TslAny;
  projectionInverse: TslAny;
  radius: TslAny;
  maxDistance: TslAny;
  depthTolerance: TslAny;
  minUvRadius: TslAny;
  maxUvRadius: TslAny;
  taps: number;
}

/**
 * Half-res screen-space bounce gather. Emits the depth-gated neighbourhood
 * radiance (rgb) and its accumulated weight (a); the full-res composite adds it
 * back modulated by the receiver's chroma.
 */
export function createBounceHalfResLayerNode(input: BounceHalfResLayerInput): TslAny {
  return Fn((): TslAny => {
    const result = vec4(0).toVar();
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
        const support = inverseSmoothstep(
          0.05,
          input.depthTolerance,
          sampleView.sub(viewPosition).length(),
        ).mul(inFrame.and(sampleSky.not()).select(float(1), float(0)));
        sum.addAssign(texture(input.beauty.value, uvSample).rgb.mul(support));
        weightSum.addAssign(support);
      }
      result.assign(vec4(sum.div(weightSum.max(1e-3)), weightSum.div(input.taps)));
    });
    return result;
  })();
}

export interface BounceCompositeInput {
  sourceRgb: TslAny;
  bounceTex: TslAny;
  strength: TslAny;
}

/** Adds the half-res bounce gather back, modulated by the receiver's chroma. */
export function createBounceCompositeNode(input: BounceCompositeInput): TslAny {
  return Fn((): TslAny => {
    const receiverLum = luminance(input.sourceRgb).add(0.25);
    const receiverTint = input.sourceRgb.div(receiverLum);
    return input.sourceRgb.add(
      input.bounceTex.rgb.mul(receiverTint).mul(input.bounceTex.a).mul(input.strength),
    );
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
      const fade = inverseSmoothstep(
        CONTACT_SHADOW_FULL_DISTANCE_M,
        CONTACT_SHADOW_MAX_DISTANCE_M,
        distance,
      );
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
        const support = inverseSmoothstep(
          0.05,
          input.depthTolerance,
          sampleView.sub(viewPosition).length(),
        ).mul(inFrame.and(sampleSky.not()).select(float(1), float(0)));
        sum.addAssign(texture(input.beauty.value, uvSample).rgb.mul(support));
        weightSum.addAssign(support);
      }
      const receiverLum = luminance(input.sourceRgb).add(0.25);
      const receiverTint = input.sourceRgb.div(receiverLum);
      const fade = inverseSmoothstep(input.maxDistance.mul(0.5), input.maxDistance, distance);
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
    const shadowMask = inverseSmoothstep(0.08, 0.45, luma).mul(input.shadowAmount);
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
