import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { attribute, clamp, dot, float, max, mix, normalGeometry, normalize, positionGeometry, positionWorld, pow, smoothstep, step, texture, uniform, vec2, vec3 } from "three/tsl";
import type { FarShellLighting } from "../gpu/far_terrain_shell.js";
import { getSunLightGpuAtlas } from "../terrain/sun_visibility/sun_light_gpu_atlas.js";

// TSL node typing is intentionally loose in Three examples and current package typings.
type TslNode = any;

interface FarShellMaterialUniformRefs {
  uDebugFallback: ReturnType<typeof uniform>;
  uSunVisibilityOriginX: ReturnType<typeof uniform>;
  uSunVisibilityOriginZ: ReturnType<typeof uniform>;
  uSunVisibilityWorldSize: ReturnType<typeof uniform>;
  uSunVisibilityValid: ReturnType<typeof uniform>;
}

export interface InfiniteFarShellMaterialOptions {
  lighting: FarShellLighting;
  innerMeters: number;
  outerMeters: number;
  nearBlendMeters: number;
  farFadeMeters: number;
  debugShowMissingFallback: boolean;
  useVertexBiomeColor?: boolean;
}

const FAR_SUN_VISIBILITY_SHADE_MIN = 0.62;

function v3c(c: THREE.Color): TslNode {
  return vec3(c.r, c.g, c.b);
}

export function createInfiniteFarShellMaterial(
  options: InfiniteFarShellMaterialOptions,
): MeshBasicNodeMaterial {
  const { lighting, innerMeters, outerMeters, nearBlendMeters, farFadeMeters, debugShowMissingFallback } = options;
  const sunVisibilityAtlas = getSunLightGpuAtlas();

  const n = normalize(normalGeometry);
  const uLight = uniform(lighting.sunDirection.clone());
  const uSun: TslNode = uniform(v3c(lighting.sunColor));
  const uSky: TslNode = uniform(v3c(lighting.skyLight));
  const uGround: TslNode = uniform(v3c(lighting.groundLight));
  const uHaze: TslNode = uniform(v3c(lighting.skyLight));
  const uInner = float(innerMeters);
  const uOuter = float(outerMeters);
  const uNearBlend = float(nearBlendMeters);
  const uFarFade = float(farFadeMeters);
  const uDebugFallback = uniform(debugShowMissingFallback ? 1 : 0);
  const uSunVisibilityOriginX = uniform(sunVisibilityAtlas.originX);
  const uSunVisibilityOriginZ = uniform(sunVisibilityAtlas.originZ);
  const uSunVisibilityWorldSize = uniform(sunVisibilityAtlas.worldSize);
  const uSunVisibilityValid = uniform(sunVisibilityAtlas.valid);

  const visibilityWorldUv = vec2(
    positionWorld.x.sub(uSunVisibilityOriginX).div(uSunVisibilityWorldSize),
    positionWorld.z.sub(uSunVisibilityOriginZ).div(uSunVisibilityWorldSize),
  );
  const visibilityUv = vec2(
    clamp(visibilityWorldUv.x, float(0.0), float(1.0)),
    clamp(visibilityWorldUv.y, float(0.0), float(1.0)),
  );
  const visibilityInside = step(float(0.0), visibilityWorldUv.x)
    .mul(step(visibilityWorldUv.x, float(1.0)))
    .mul(step(float(0.0), visibilityWorldUv.y))
    .mul(step(visibilityWorldUv.y, float(1.0)))
    .mul(uSunVisibilityValid);
  const visibilitySample = texture(sunVisibilityAtlas.texture, visibilityUv).r;
  const sunVisibility = mix(float(1.0), mix(float(FAR_SUN_VISIBILITY_SHADE_MIN), float(1.0), visibilitySample), visibilityInside);

  const sun = max(dot(n, uLight), float(0));
  const sky = clamp(n.y.mul(0.5).add(0.5), float(0), float(1));
  const hemi = mix(uGround, uSky, sky);
  const directSun = uSun.mul(pow(sun, float(1.35))).mul(sunVisibility);
  const light = hemi.add(directSun);

  const distXZ = vec2(positionGeometry.x, positionGeometry.z).length();
  const nearFade = smoothstep(uInner, uInner.add(uNearBlend), distXZ);
  const farFade = float(1).sub(smoothstep(uOuter.sub(uFarFade), uOuter, distXZ));
  const shellFade = nearFade.mul(farFade);
  const hazeT = smoothstep(uOuter.mul(0.55), uOuter.mul(0.98), distXZ);

  const fallbackBase = vec3(0.30, 0.34, 0.22);
  const base = options.useVertexBiomeColor
    ? mix(fallbackBase, attribute("color", "vec3"), float(1))
    : fallbackBase;
  const normalFaded = mix(uHaze, base.mul(light), shellFade);
  const normalColor = mix(normalFaded, uHaze, hazeT);
  const debugColor = vec3(1, 0.3, 0.3);
  const debugBase = vec3(0.3, 0.34, 0.22);
  const debugLit = mix(debugBase.mul(light), uHaze, hazeT);
  const debugOutput = mix(debugLit, debugColor, shellFade.mul(0.5));

  const material = new MeshBasicNodeMaterial();
  material.side = THREE.DoubleSide;
  material.colorNode = mix(normalColor, debugOutput, uDebugFallback);
  material.userData.farShellMaterialUniforms = {
    uDebugFallback,
    uSunVisibilityOriginX,
    uSunVisibilityOriginZ,
    uSunVisibilityWorldSize,
    uSunVisibilityValid,
  } satisfies FarShellMaterialUniformRefs;

  return material;
}

export function updateFarShellMaterialSunVisibility(material: MeshBasicNodeMaterial): void {
  const refs = material.userData.farShellMaterialUniforms as FarShellMaterialUniformRefs | undefined;
  if (!refs) return;
  const atlas = getSunLightGpuAtlas();
  refs.uSunVisibilityOriginX.value = atlas.originX;
  refs.uSunVisibilityOriginZ.value = atlas.originZ;
  refs.uSunVisibilityWorldSize.value = atlas.worldSize;
  refs.uSunVisibilityValid.value = atlas.valid;
}

export function updateFarShellMaterialMaterial(
  material: MeshBasicNodeMaterial,
  options: Partial<InfiniteFarShellMaterialOptions>,
): void {
  const refs = material.userData.farShellMaterialUniforms as FarShellMaterialUniformRefs | undefined;
  if (!refs) return;
  if (options.debugShowMissingFallback !== undefined) {
    refs.uDebugFallback.value = options.debugShowMissingFallback ? 1 : 0;
  }
  updateFarShellMaterialSunVisibility(material);
}
