// Phase 3 WebGPU grass (docs/webgpu-migration.md). TSL port of the *classic* grass shader in
// src/grass.ts (VERTEX_SHADER / FRAGMENT_SHADER): per-instance wind sway + bend + Y-rotation,
// hemispheric + sun + back-transmission lighting. Instanced via custom per-instance attributes
// (aOffset/aHeight/aRotY/aPhase/aColorMix) on an InstancedBufferGeometry.
//
// NOT yet ported (later): the terrain-patch-v2 mode (distance LOD, edge/slope fades, crossed
// planes) and hardware alpha-to-coverage. Blades are placed by the reused (unchanged)
// generateGrassInstances(); this only re-authors the material + instanced geometry assembly.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  clamp,
  cos,
  dot,
  frontFacing,
  max,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment.js";
import { createBladeGeometry, type GrassBladeInstance } from "../grass.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);

export interface GrassNodeParams {
  lighting: EnvironmentLighting;
  bladeWidth: number;
  windStrength: number;
  windSpeed: number;
}

export interface GrassNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  /** Advance wind animation (seconds). */
  setTime(t: number): void;
}

export function createGrassNodeMaterial(params: GrassNodeParams): GrassNodeMaterialHandle {
  const uTime = uniform(0);
  const uBladeWidth = uniform(params.bladeWidth);
  const uWindStrength = uniform(params.windStrength);
  const uWindSpeed = uniform(params.windSpeed);
  const uLight = uniform(params.lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(params.lighting.sunColor));
  const uSky = uniform(v3(params.lighting.skyLight));
  const uGround = uniform(v3(params.lighting.groundLight));

  // Per-instance attributes (InstancedBufferAttribute on the geometry).
  const aOffset: TslNode = attribute("aOffset", "vec3");
  const aHeight: TslNode = attribute("aHeight", "float");
  const aRotY: TslNode = attribute("aRotY", "float");
  const aPhase: TslNode = attribute("aPhase", "float");
  const aColorMix: TslNode = attribute("aColorMix", "float");

  const uvY: TslNode = uv().y;
  const bend: TslNode = uvY.mul(uvY);
  const windTime: TslNode = uTime.mul(uWindSpeed).add(aPhase).add(aOffset.x.mul(0.071)).add(aOffset.z.mul(0.053));
  const wind: TslNode = vec2(sin(windTime), cos(windTime.mul(0.83).add(aPhase.mul(0.37))))
    .mul(uWindStrength.mul(aHeight).mul(bend));

  // localPosition = (pos.x*width, pos.y*height, pos.z) with wind added to xz.
  const pos: TslNode = positionGeometry;
  const localX: TslNode = pos.x.mul(uBladeWidth).add(wind.x);
  const localY: TslNode = pos.y.mul(aHeight);
  const localZ: TslNode = pos.z.add(wind.y);

  const c: TslNode = cos(aRotY);
  const s: TslNode = sin(aRotY);
  // Y-rotation of the wind-displaced local position, then world-place at aOffset.
  const rotX: TslNode = c.mul(localX).add(s.mul(localZ));
  const rotZ: TslNode = s.mul(localX).negate().add(c.mul(localZ));
  const worldPos: TslNode = aOffset.add(vec3(rotX, localY, rotZ));

  const nrm: TslNode = normalGeometry;
  const localNormal: TslNode = normalize(
    vec3(nrm.x.sub(wind.x.mul(0.35)), nrm.y.add(bend.mul(0.16)), nrm.z.sub(wind.y.mul(0.35))),
  );
  const worldNormal: TslNode = normalize(
    vec3(c.mul(localNormal.x).add(s.mul(localNormal.z)), localNormal.y, s.mul(localNormal.x).negate().add(c.mul(localNormal.z))),
  );

  // Fragment: blade-gradient colour + hemispheric/sun/transmission lighting.
  const darkGreen = vec3(0.035, 0.12, 0.025);
  const midGreen = vec3(0.12, 0.34, 0.055);
  const tipGreen = vec3(0.34, 0.56, 0.12);
  const dryGrass = vec3(0.52, 0.42, 0.12);
  let grassColor: TslNode = mix(darkGreen, midGreen, smoothstep(0.0, 0.62, uvY));
  grassColor = mix(grassColor, tipGreen, smoothstep(0.58, 1.0, uvY));
  grassColor = mix(grassColor, dryGrass, aColorMix.mul(0.58));

  // Flip the normal on back faces (double-sided blades).
  const n: TslNode = frontFacing.select(worldNormal, worldNormal.negate());
  const lightDir: TslNode = uLight;
  const sun: TslNode = max(dot(n, lightDir), 0.0);
  const back: TslNode = max(dot(n.negate(), lightDir), 0.0);
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi: TslNode = mix(uGround, uSky, sky);
  const direct: TslNode = uSun.mul(pow(sun, 1.25));
  const transmission: TslNode = vec3(0.46, 0.55, 0.12).mul(back).mul(uvY.mul(0.5).add(0.16));

  const material = new MeshBasicNodeMaterial();
  material.positionNode = worldPos; // identity model transform -> local == world
  material.colorNode = grassColor.mul(hemi.add(direct)).add(transmission.mul(grassColor));
  material.side = THREE.DoubleSide;

  return {
    material,
    setTime(t) {
      uTime.value = t;
    },
  };
}

// Build an InstancedBufferGeometry: the shared classic blade geometry plus one set of
// per-instance attributes from the placed blades.
export function buildGrassInstancedGeometry(
  instances: readonly GrassBladeInstance[],
): THREE.InstancedBufferGeometry {
  const base = createBladeGeometry();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  geo.setAttribute("normal", base.getAttribute("normal"));

  const count = instances.length;
  const offset = new Float32Array(count * 3);
  const height = new Float32Array(count);
  const rotY = new Float32Array(count);
  const phase = new Float32Array(count);
  const colorMix = new Float32Array(count);
  instances.forEach((b, i) => {
    offset[i * 3] = b.offset[0];
    offset[i * 3 + 1] = b.offset[1];
    offset[i * 3 + 2] = b.offset[2];
    height[i] = b.height;
    rotY[i] = b.rotationY;
    phase[i] = b.phase;
    colorMix[i] = b.colorMix;
  });
  geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offset, 3));
  geo.setAttribute("aHeight", new THREE.InstancedBufferAttribute(height, 1));
  geo.setAttribute("aRotY", new THREE.InstancedBufferAttribute(rotY, 1));
  geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute("aColorMix", new THREE.InstancedBufferAttribute(colorMix, 1));
  geo.instanceCount = count;
  return geo;
}
