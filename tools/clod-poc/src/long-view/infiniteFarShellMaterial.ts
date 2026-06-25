import { MeshBasicNodeMaterial } from "three/webgpu";
import { clamp, dot, float, max, mix, normalGeometry, normalize, positionWorld, pow, smoothstep, uniform, vec2, vec3 } from "three/tsl";
import type { FarShellLighting } from "../gpu/far_terrain_shell.js";

export interface InfiniteFarShellMaterialOptions {
  lighting: FarShellLighting;
  innerMeters: number;
  outerMeters: number;
  nearBlendMeters: number;
  farFadeMeters: number;
  debugShowMissingFallback: boolean;
}

export function createInfiniteFarShellMaterial(
  options: InfiniteFarShellMaterialOptions,
): MeshBasicNodeMaterial {
  const { lighting, innerMeters, outerMeters, nearBlendMeters, farFadeMeters, debugShowMissingFallback } = options;

  const n = normalize(normalGeometry);
  const uLight = uniform(lighting.sunDirection.clone());
  const uSun = uniform(vec3(lighting.sunColor.r, lighting.sunColor.g, lighting.sunColor.b));
  const uSky = uniform(vec3(lighting.skyLight.r, lighting.skyLight.g, lighting.skyLight.b));
  const uGround = uniform(vec3(lighting.groundLight.r, lighting.groundLight.g, lighting.groundLight.b));
  const uHaze = uniform(vec3(lighting.skyLight.r, lighting.skyLight.g, lighting.skyLight.b));

  const uInner = float(innerMeters);
  const uOuter = float(outerMeters);
  const uNearBlend = float(nearBlendMeters);
  const uFarFade = float(farFadeMeters);

  const base = vec3(0.30, 0.34, 0.22);
  const sun = max(dot(n, uLight), 0.0);
  const sky = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi = mix(uGround, uSky, sky);
  const light = hemi.add(uSun.mul(pow(sun, 1.35)));

  const distXZ = vec2(positionWorld.x, positionWorld.z).length();

  const nearAlpha = smoothstep(uInner, uInner.add(uNearBlend), distXZ);
  const farAlpha = float(1.0).sub(smoothstep(uOuter.sub(uFarFade), uOuter, distXZ));
  const alpha = nearAlpha.mul(farAlpha);

  const hazeT = smoothstep(uOuter.mul(0.55), uOuter.mul(0.98), distXZ);
  const color = mix(base.mul(light), uHaze, hazeT);

  const debugColor = vec3(1.0, 0.3, 0.3);

  const material = new MeshBasicNodeMaterial();
  material.colorNode = debugShowMissingFallback ? debugColor : color;
  material.opacityNode = alpha;
  material.transparent = true;
  material.depthWrite = false;

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
