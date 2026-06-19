// Phase 3 WebGPU stones (docs/webgpu-migration.md). TSL port of the small procedural
// rock shader in src/stones/stone_instances.ts: vdata-driven strata/moss/AO, procedural
// grain, dust/dirt, and the same hemispheric + sun lighting. Geometry/LOD/scatter stays in
// StoneSystem; this only replaces the material under ?webgpu=1&stones=1.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  clamp,
  dot,
  floor,
  fract,
  frontFacing,
  max,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { StoneLighting } from "../stones/stone_instances.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);

export interface StoneNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  setLighting(lighting: StoneLighting): void;
}

function hash2(p: TslNode): TslNode {
  return fract(sin(dot(p, vec2(41.3, 289.1))).mul(43758.5453));
}

export function createStoneNodeMaterial(lighting: StoneLighting): StoneNodeMaterialHandle {
  const uLight = uniform(lighting.light.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));

  const worldPos: TslNode = positionWorld;
  const vdata: TslNode = attribute("vdata", "vec4");
  const n0: TslNode = normalize(normalWorld);
  const n: TslNode = frontFacing.select(n0, n0.negate());

  const hue = hash2(floor(worldPos.xz.mul(0.5)));
  const lightStone = vec3(0.52, 0.5, 0.47);
  const darkStone = vec3(0.3, 0.29, 0.28);
  let rock: TslNode = mix(darkStone, lightStone, smoothstep(0.0, 1.0, vdata.y));
  rock = mix(rock, rock.mul(vec3(1.05, 0.98, 0.9)), hue.mul(0.5));

  const grain = hash2(floor(worldPos.xz.mul(7.0).add(worldPos.y)));
  rock = rock.mul(grain.mul(0.15).add(0.9));

  const up = clamp(n.y, 0.0, 1.0);
  rock = mix(rock, vec3(0.6, 0.55, 0.47), up.mul(0.18));
  const moss = clamp(vdata.z, 0.0, 1.0).mul(up);
  rock = mix(rock, vec3(0.22, 0.3, 0.14), moss.mul(0.25));
  rock = mix(rock, vec3(0.18, 0.15, 0.12), up.oneMinus().mul(0.18));

  const ao = clamp(vdata.w, 0.0, 1.0);
  const sun = max(dot(n, uLight), 0.0);
  const sky = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi = mix(uGround, uSky, sky);
  const direct = uSun.mul(sun);

  const material = new MeshBasicNodeMaterial();
  material.colorNode = rock.mul(hemi.add(direct)).mul(ao);
  material.side = THREE.FrontSide;

  return {
    material,
    setLighting(next) {
      uLight.value.copy(next.light).normalize();
      uSun.value.copy(v3(next.sunColor));
      uSky.value.copy(v3(next.skyLight));
      uGround.value.copy(v3(next.groundLight));
    },
  };
}
