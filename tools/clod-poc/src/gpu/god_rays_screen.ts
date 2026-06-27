// Screen-space god rays ("light shafts") for the WebGPU post-process pipeline.
//
// This is the classic radial-blur / light-scattering technique: an occlusion buffer is built from
// the scene (sky pixels keep their colour, including the bright sun disk; everything the depth
// buffer marks as geometry is treated as a black occluder), then samples are accumulated along the
// ray from each pixel toward the sun's screen position with per-step decay. The result is screen
// blended onto the graded scene.
//
// It honours occluder silhouettes via the depth buffer but, like all screen-space shafts, cannot
// represent light scattering behind geometry. For that, use the volumetric mode instead.

import * as THREE from "three";
import { float, max, step, vec3 } from "three/tsl";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface ScreenGodRaysInputs {
  /** Scene colour texture node (sampleable), e.g. the scene pass output. */
  sceneTex: TslNode;
  /** Scene depth texture node (sampleable); 1.0 where no geometry was drawn (sky). */
  depthTex: TslNode;
  /** Base screen UV for the current fragment. */
  uvNode: TslNode;
  /** Sun position in screen UV space (uniform vec2). */
  sunUv: TslNode;
  /** Master gain; set to 0 to disable (uniform float). Used to gate when the sun is behind. */
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

/**
 * Builds the additive god-rays contribution (a vec3) to screen-blend onto the graded scene colour.
 */
export function buildScreenGodRays(inputs: ScreenGodRaysInputs): TslNode {
  const { sceneTex, depthTex, uvNode, sunUv, intensity, density, decay, weight, exposure, samples } =
    inputs;

  // Sky pixels (no geometry) keep the cleared far depth of 1.0; geometry writes a smaller value.
  const skyThreshold = float(0.9999);
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

export interface SunScreenInfo {
  /** Sun X in screen UV space (0..1 on screen). */
  u: number;
  /** Sun Y in screen UV space (0..1 on screen). */
  v: number;
  /** Whether the sun is in front of the camera (god rays should be gated off when false). */
  visible: boolean;
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
  const visible = _viewDir.z < 0;

  _sunPoint.copy(camera.position).addScaledVector(sunDir, 1e6);
  _sunPoint.project(camera);
  return { u: _sunPoint.x * 0.5 + 0.5, v: _sunPoint.y * 0.5 + 0.5, visible };
}
