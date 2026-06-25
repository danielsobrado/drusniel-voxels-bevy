import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { clamp, dot, float, max, mix, normalize, positionWorld, pow, smoothstep, uniform, vec2, vec3 } from "three/tsl";
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

  const n = normalize(positionWorld);
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

  const nearAlpha = smoothstep(uInner, uInner.add(uNearBlend), distXZ);
  const farAlpha = float(1).sub(smoothstep(uOuter.sub(uFarFade), uOuter, distXZ));
  const alpha = nearAlpha.mul(farAlpha);

  const hazeT = smoothstep(uOuter.mul(0.55), uOuter.mul(0.98), distXZ);

  const material = new MeshBasicNodeMaterial();
  material.vertexColors = true;
  material.side = THREE.DoubleSide;

  if (debugShowMissingFallback) {
    const debugColor = vec3(1, 0.3, 0.3);
    material.colorNode = mix(vec3(0.3, 0.34, 0.22).mul(light), debugColor, alpha.mul(0.5));
  } else {
    const base = vec3(0.30, 0.34, 0.22);
    material.colorNode = mix(base.mul(light), uHaze, hazeT);
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
