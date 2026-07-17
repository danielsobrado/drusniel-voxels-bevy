// Screen-space god rays ("light shafts") for the WebGPU post-process pipeline.
//
// This is the classic radial-blur / light-scattering technique: an occlusion buffer is built from
// the scene (sky pixels keep their colour, including the bright sun disk; geometry contributes a
// small "lit haze" term instead of hard black so shafts persist over terrain silhouettes), then
// samples are accumulated along the ray from each pixel toward the sun's screen position with
// per-step decay.
//
// Two additions give the low-tap half-res variant its dusty volumetric character:
// - Interleaved gradient noise jitters each pixel's march start, converting banding into
//   high-frequency grain that TRAA (or the eye, as dust) absorbs.
// - Animated beam-space value noise modulates the accumulated radiance, producing parallel
//   striations of unequal brightness that drift slowly — dust hanging in light, no particles.
//
// It honours occluder silhouettes via the depth buffer but, like all screen-space shafts, cannot
// represent light scattering when the sun is well off-screen; `sunScreenFade` fades the effect
// softly instead of popping.

import * as THREE from "three";
import {
  Fn,
  clamp,
  dot,
  float,
  floor,
  fract,
  max,
  mix,
  screenCoordinate,
  smoothstep,
  step,
  time,
  vec2,
  vec3,
} from "three/tsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const tslMix = mix as unknown as (a: TslNode, b: TslNode, amount: TslNode) => TslNode;

/** Depth at or beyond this value is treated as sky (cleared far plane). */
const SKY_DEPTH_THRESHOLD = 0.9999;

/** Geometry contributes this fraction of its scene colour to the march source ("lit haze"). */
export const GOD_RAYS_LIT_HAZE = 0.12;

/** Radius in screen UV space over which shaft energy fades away from the sun. */
const GOD_RAYS_SCREEN_FALLOFF_RADIUS = 1.4;

// Interleaved gradient noise (Jimenez 2014) — one dot + two fracts, no texture.
const IGN_MAGIC = { x: 0.06711056, y: 0.00583715, scale: 52.9829189 } as const;

/** Pure reference of the shader's interleaved gradient noise, for unit tests. */
export function interleavedGradientNoiseReference(pixelX: number, pixelY: number): number {
  const inner = IGN_MAGIC.x * pixelX + IGN_MAGIC.y * pixelY;
  const innerFract = inner - Math.floor(inner);
  const outer = IGN_MAGIC.scale * innerFract;
  return outer - Math.floor(outer);
}

function interleavedGradientNoise(pixel: TslNode): TslNode {
  return fract(float(IGN_MAGIC.scale).mul(fract(dot(pixel, vec2(IGN_MAGIC.x, IGN_MAGIC.y)))));
}

function hashNoise2(p: TslNode): TslNode {
  return fract(dot(p, vec2(127.1, 311.7)).sin().mul(43758.5453));
}

/** Bilinearly interpolated value noise over an integer lattice (0..1). */
function valueNoise2(p: TslNode): TslNode {
  const i: TslNode = floor(p);
  const f: TslNode = fract(p);
  const u: TslNode = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = hashNoise2(i);
  const b = hashNoise2(i.add(vec2(1, 0)));
  const c = hashNoise2(i.add(vec2(0, 1)));
  const d = hashNoise2(i.add(vec2(1, 1)));
  return tslMix(tslMix(a, b, u.x), tslMix(c, d, u.x), u.y);
}

export interface ScreenGodRaysInputs {
  /** Scene colour texture node (sampleable), e.g. the scene pass output. */
  sceneTex: TslNode;
  /** Scene depth texture node (sampleable); 1.0 where no geometry was drawn (sky). */
  depthTex: TslNode;
  /** Base screen UV for the current fragment. */
  uvNode: TslNode;
  /** Sun position in screen UV space (uniform vec2). */
  sunUv: TslNode;
  /** Master gain; set to 0 to disable (uniform float). Carries the soft sun-behind/off-screen fade. */
  intensity: TslNode;
  /** Raymarch step scale toward the sun (uniform float). */
  density: TslNode;
  /** Per-step falloff < 1 (uniform float). */
  decay: TslNode;
  /** Per-step weight (uniform float). */
  weight: TslNode;
  /** Output gain on the accumulated shafts (uniform float). */
  exposure: TslNode;
  /** Compile-time raymarch sample count. Drives cost (cheap vs heavy modes). */
  samples: number;
}

export interface DustGodRaysInputs extends ScreenGodRaysInputs {
  /** Blend of the beam-space dust striation over clean shafts, 0..1 (uniform float). */
  dustStrength: TslNode;
  /** Spatial frequency of the striation noise in beam space (uniform float). */
  dustScale: TslNode;
  /** Drift speed of the striation noise (uniform float). */
  dustSpeed: TslNode;
}

/**
 * Builds the additive god-rays contribution (a vec3) to screen-blend onto the graded scene colour.
 *
 * Classic full-res variant kept for isolated shader comparisons and the original tests.
 */
export function buildScreenGodRays(inputs: ScreenGodRaysInputs): TslNode {
  const { sceneTex, depthTex, uvNode, sunUv, intensity, density, decay, weight, exposure, samples } =
    inputs;

  // Sky pixels (no geometry) keep the cleared far depth of 1.0; geometry writes a smaller value.
  const skyThreshold = float(SKY_DEPTH_THRESHOLD);
  const occlusionAt = (coord: TslNode): TslNode => {
    const sky = step(skyThreshold, depthTex.sample(coord).r);
    return sceneTex.sample(coord).rgb.mul(sky);
  };

  const coord = uvNode.toVar();
  // Constant per-fragment march delta: from the fragment toward the sun, scaled by density/samples.
  const delta = uvNode.sub(sunUv).mul(density.mul(1 / samples)).toConst();
  const illumDecay = float(1).toVar();
  const accum = vec3(0).toVar();

  for (let i = 0; i < samples; i++) {
    coord.subAssign(delta);
    accum.addAssign(occlusionAt(coord).mul(illumDecay).mul(weight));
    illumDecay.mulAssign(decay);
  }

  return max(accum.mul(exposure).mul(intensity), vec3(0));
}

/**
 * Builds the dust-character god-rays layer (a vec3): IGN-jittered radial march with a lit-haze
 * geometry term and animated beam-space striation. Designed to run at half resolution inside the
 * shared `HalfResMrtNode` pass; the result is upsampled, tinted by sun transmittance, and added
 * in linear light before TRAA.
 */
export function buildDustGodRays(inputs: DustGodRaysInputs): TslNode {
  const {
    sceneTex,
    depthTex,
    uvNode,
    sunUv,
    intensity,
    density,
    decay,
    weight,
    exposure,
    samples,
    dustStrength,
    dustScale,
    dustSpeed,
  } = inputs;

  return Fn((): TslNode => {
    const skyThreshold = float(SKY_DEPTH_THRESHOLD);
    // Sky keeps full radiance; geometry keeps a lit-haze fraction so beams survive silhouettes.
    const sourceAt = (coord: TslNode): TslNode => {
      const sky = step(skyThreshold, depthTex.sample(coord).r);
      return sceneTex.sample(coord).rgb.mul(tslMix(float(GOD_RAYS_LIT_HAZE), float(1), sky));
    };

    const delta = uvNode.sub(sunUv).mul(density.mul(1 / samples)).toConst();
    // IGN start jitter: what makes 16 taps look like many more (banding → grain TAA absorbs).
    const jitter = interleavedGradientNoise(screenCoordinate.xy);
    const coord = uvNode.sub(delta.mul(jitter)).toVar();
    const illumDecay = float(1).toVar();
    const accum = vec3(0).toVar();

    for (let i = 0; i < samples; i++) {
      coord.subAssign(delta);
      accum.addAssign(sourceAt(coord).mul(illumDecay).mul(weight));
      illumDecay.mulAssign(decay);
    }

    // Beam-space dust: noise over the unit direction toward the sun (angular striations, no
    // atan2 seam) with a radial coupling in the second octave, drifting slowly over time.
    const toSun: TslNode = sunUv.sub(uvNode);
    const distToSun: TslNode = toSun.length();
    const beamDir: TslNode = toSun.div(distToSun.max(1e-4));
    const drift: TslNode = (time as TslNode).mul(dustSpeed);
    const beamP: TslNode = beamDir.mul(dustScale).add(vec2(drift, drift.mul(0.7071)));
    const octave1 = valueNoise2(beamP);
    const octave2 = valueNoise2(
      beamP.mul(2.7).add(vec2(17.13, 9.71)).add(distToSun.mul(dustScale.mul(0.35))),
    );
    const dust = octave1.mul(0.65).add(octave2.mul(0.35));
    const dustFactor = tslMix(float(1), dust.mul(1.6).add(0.2), clamp(dustStrength, 0, 1));

    // Use ordered smoothstep edges. Reversed edges are undefined in GLSL/WGSL implementations.
    const screenFalloff = float(1).sub(
      smoothstep(0.0, GOD_RAYS_SCREEN_FALLOFF_RADIUS, distToSun),
    );

    return max(
      accum.mul(dustFactor).mul(screenFalloff).mul(exposure).mul(intensity),
      vec3(0),
    );
  })();
}

export interface SunScreenInfo {
  /** Sun X in screen UV space (0..1 on screen). */
  u: number;
  /** Sun Y in screen UV space (0..1 on screen). */
  v: number;
  /** Whether the sun is in front of the camera (god rays should be gated off when false). */
  visible: boolean;
  /** Cosine of the angle between the camera forward axis and the sun (negative = behind). */
  forward: number;
}

const _viewDir = new THREE.Vector3();
const _sunPoint = new THREE.Vector3();

/**
 * Projects a directional-sun direction into screen UV space for the given camera.
 *
 * The sun is treated as infinitely distant, so we project a point far along the sun direction from
 * the camera. `visible` is derived from the view-space direction (not the projected point) because a
 * perspective projection of a point behind the camera flips its sign and cannot be trusted.
 */
export function projectSunToScreen(sunDir: THREE.Vector3, camera: THREE.Camera): SunScreenInfo {
  // View-space sun direction. The camera looks down -Z in view space, so the sun is in front when
  // its view-space Z is negative.
  _viewDir.copy(sunDir).transformDirection(camera.matrixWorldInverse);
  const forward = -_viewDir.z;
  const visible = forward > 0;

  camera.getWorldPosition(_sunPoint);
  _sunPoint.addScaledVector(sunDir, 1e6).project(camera);
  return { u: _sunPoint.x * 0.5 + 0.5, v: _sunPoint.y * 0.5 + 0.5, visible, forward };
}

/** UV margin beyond the screen edge over which shafts fade to zero. */
const SUN_FADE_UV_MARGIN = 0.35;
/** Forward-cosine range over which shafts fade in as the sun crosses the camera plane. */
const SUN_FADE_FORWARD_END = 0.12;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function smooth01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

/** Pure reference of the shader's radial screen falloff, for unit tests. */
export function godRaysScreenFalloffReference(distanceToSun: number): number {
  return 1 - smooth01(distanceToSun / GOD_RAYS_SCREEN_FALLOFF_RADIUS);
}

/**
 * Soft 0..1 master gain for the screen-space shafts: 1 while the sun is comfortably on screen,
 * easing to 0 as it leaves the frame or crosses behind the camera — no pop, by design. Applied
 * CPU-side into the stage's intensity uniform every frame.
 */
export function sunScreenFade(info: SunScreenInfo, marginUv = SUN_FADE_UV_MARGIN): number {
  if (!(info.forward > 0)) return 0;
  const outsideU = Math.max(0, -info.u, info.u - 1);
  const outsideV = Math.max(0, -info.v, info.v - 1);
  const outside = Math.hypot(outsideU, outsideV);
  const edgeFade = smooth01(1 - outside / Math.max(1e-4, marginUv));
  const facingFade = smooth01(info.forward / SUN_FADE_FORWARD_END);
  return edgeFade * facingFade;
}
