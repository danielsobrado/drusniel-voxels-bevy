import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  cameraPosition,
  clamp,
  dot,
  float,
  max,
  mix,
  normalize,
  normalWorld,
  positionWorld,
  smoothstep,
  uniform,
  uv,
  vec2,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment/environment.js";

// TSL graphs have no exported node type surface.
/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export interface CanopyGpuImpostorMaterialHandle {
  readonly material: MeshBasicNodeMaterial;
  updateTransition(startM: number, endM: number): void;
  setShellBlend(blend: number): void;
  updateLighting(lighting: EnvironmentLighting): void;
  dispose(): void;
}

const DEFAULT_ALPHA_COVERAGE = 0.32;

function toVec3(color: THREE.Color): THREE.Vector3 {
  return new THREE.Vector3(color.r, color.g, color.b);
}

/**
 * Far-canopy crown-cluster material. Alpha-hashed opaque (depthWrite true, transparent false):
 * a world-cell dither controls both the tree→canopy distance handoff and the shell crossfade,
 * so nothing relies on blended transparency. Lighting reproduces the hemispheric + sun model
 * from uniforms instead of prebaking a sun scale into the instance albedo.
 */
export function createCanopyGpuImpostorMaterial(
  lighting: EnvironmentLighting,
  handoffStartM: number,
  handoffEndM: number,
): CanopyGpuImpostorMaterialHandle {
  const uCanopyStart = uniform(handoffStartM);
  const uCanopyEnd = uniform(handoffEndM);
  const uShellBlend = uniform(1);
  const uAlphaCoverage = uniform(DEFAULT_ALPHA_COVERAGE);
  const uSunDirection = uniform(lighting.sunDirection.clone());
  const uSunColor = uniform(toVec3(lighting.sunColor));
  const uSkyColor = uniform(toVec3(lighting.skyLight));
  const uGroundColor = uniform(toVec3(lighting.groundLight));

  const material = new MeshBasicNodeMaterial();

  const albedo: TslNode = attribute("canopyAlbedo", "vec3");
  const transitionNoise: TslNode = attribute("canopyTransitionNoise", "float");
  const shellNoise: TslNode = attribute("canopyShellNoise", "float");

  const centered: TslNode = uv().sub(0.5).mul(2);
  const radial: TslNode = centered.length();
  const alphaCoverage: TslNode = float(1).sub(smoothstep(float(0.35), float(1), radial));
  const alphaKeep: TslNode = alphaCoverage.greaterThanEqual(uAlphaCoverage);

  // Tree LOD ownership is radial in the XZ plane. Including camera height here makes an aerial
  // camera reveal canopy inside the tree-owned band and breaks the complementary handoff.
  const distanceM: TslNode = vec2(
    positionWorld.x.sub(cameraPosition.x),
    positionWorld.z.sub(cameraPosition.z),
  ).length();
  const canopyVisibility: TslNode = smoothstep(uCanopyStart, uCanopyEnd, distanceM);
  const transitionKeep: TslNode = transitionNoise.lessThan(canopyVisibility);
  const shellKeep: TslNode = shellNoise.lessThan(uShellBlend);

  (material as unknown as { maskNode: TslNode }).maskNode = alphaKeep.and(transitionKeep).and(shellKeep);

  const n: TslNode = normalize(normalWorld);
  const sun: TslNode = max(dot(n, uSunDirection), float(0));
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), float(0), float(1));
  const hemi: TslNode = mix(uGroundColor, uSkyColor, sky);
  const light: TslNode = hemi.add(uSunColor.mul(sun));
  material.colorNode = albedo.mul(light);

  material.alphaTest = 0;
  material.transparent = false;
  material.depthWrite = true;
  material.depthTest = true;
  material.side = THREE.DoubleSide;
  material.toneMapped = true;

  return {
    material,
    updateTransition(startM: number, endM: number) {
      uCanopyStart.value = startM;
      uCanopyEnd.value = Math.max(startM + 0.001, endM);
    },
    setShellBlend(blend: number) {
      uShellBlend.value = THREE.MathUtils.clamp(blend, 0, 1);
    },
    updateLighting(next: EnvironmentLighting) {
      uSunDirection.value.copy(next.sunDirection);
      uSunColor.value.set(next.sunColor.r, next.sunColor.g, next.sunColor.b);
      uSkyColor.value.set(next.skyLight.r, next.skyLight.g, next.skyLight.b);
      uGroundColor.value.set(next.groundLight.r, next.groundLight.g, next.groundLight.b);
    },
    dispose() {
      material.dispose();
    },
  };
}
