import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { clamp, dot, float, max, mix, normalGeometry, normalize, positionWorld, pow, smoothstep, uniform, vec2, vec3 } from "three/tsl";
import type { FarShellLighting } from "../gpu/far_terrain_shell.js";

type TslNode = any;

export interface InfiniteFarShellMaterialOptions {
  lighting: FarShellLighting;
  innerMeters: number;
  outerMeters: number;
  nearBlendMeters: number;
  farFadeMeters: number;
  debugShowMissingFallback: boolean;
}

function v3c(c: THREE.Color): TslNode {
  return vec3(c.r, c.g, c.b);
}

export function createInfiniteFarShellMaterial(
  options: InfiniteFarShellMaterialOptions,
): MeshBasicNodeMaterial {
  const { lighting, innerMeters, outerMeters, nearBlendMeters, farFadeMeters, debugShowMissingFallback } = options;

  const n = normalize(normalGeometry);
  const uLight = uniform(lighting.sunDirection.clone());
  const uSun = uniform(v3c(lighting.sunColor));
  const uSky = uniform(v3c(lighting.skyLight));
  const uGround = uniform(v3c(lighting.groundLight));
  const uHaze = uniform(v3c(lighting.skyLight));
  const uInner = float(innerMeters);
  const uOuter = float(outerMeters);
  const uNearBlend = float(nearBlendMeters);
  const uFarFade = float(farFadeMeters);

  const sun = max(dot(n, uLight), float(0));
  const sky = clamp(n.y.mul(0.5).add(0.5), float(0), float(1));
  const hemi = mix(uGround, uSky, sky);
  const light = hemi.add(uSun.mul(pow(sun, float(1.35))));

  const distXZ = vec2(positionWorld.x, positionWorld.z).length();

  const nearFade = smoothstep(uInner, uInner.add(uNearBlend), distXZ);
  const farFade = float(1).sub(smoothstep(uOuter.sub(uFarFade), uOuter, distXZ));
  const shellFade = nearFade.mul(farFade);

  const hazeT = smoothstep(uOuter.mul(0.55), uOuter.mul(0.98), distXZ);

  const material = new MeshBasicNodeMaterial();
  material.vertexColors = true;
  material.side = THREE.DoubleSide;

  if (debugShowMissingFallback) {
    const debugColor = vec3(1, 0.3, 0.3);
    const debugBase = vec3(0.3, 0.34, 0.22);
    material.colorNode = mix(mix(debugBase.mul(light), uHaze, hazeT), debugColor, shellFade.mul(0.5));
  } else {
    const base = vec3(0.30, 0.34, 0.22);
    const faded = mix(uHaze, base.mul(light), shellFade);
    material.colorNode = mix(faded, uHaze, hazeT);
  }

  return material;
}

export function updateFarShellMaterialMaterial(
  material: MeshBasicNodeMaterial,
  options: Partial<InfiniteFarShellMaterialOptions>,
): void {
  if (options.debugShowMissingFallback !== undefined) {
    material.needsUpdate = true;
  }
}
