// Phase 3 WebGPU stones (docs/webgpu-migration.md). TSL port of the small procedural
// rock shader in src/stones/stone_instances.ts: vdata-driven strata/moss/AO, procedural
// grain, dust/dirt, and the same hemispheric + sun lighting. Geometry/LOD/scatter stays in
// StoneSystem; this only replaces the material under ?webgpu=1&stones=1.

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  clamp,
  cos,
  dot,
  floor,
  float,
  fract,
  frontFacing,
  instanceIndex,
  max,
  mix,
  normalGeometry,
  normalWorld,
  normalize,
  positionGeometry,
  positionWorld,
  sin,
  smoothstep,
  storage,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { StoneLighting } from "../stones/stone_instances.js";
import { sampleCarvedBedBilinearTsl, sampleHydrologyBilinearTsl } from "./placement_height.js";
import { readRiverMaterialSettings } from "../water/riverMaterialRuntime.js";

export interface StoneHydrologyWater {
  /** RGBA32F hydrology field; G = wet mask, B = carved-bed Y. */
  texture: THREE.Texture | null;
  /** World size (worldCells) mapping instance XZ → hydrology UV. */
  worldSize: number;
  /** Hydrology grid resolution for bilinear carved-bed sampling. */
  res: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);

export interface StoneNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  setLighting(lighting: StoneLighting): void;
}

export interface StoneStorageInstanceBuffers {
  instanceA: THREE.BufferAttribute;
  instanceB: THREE.BufferAttribute;
  capacity: number;
}

function hash2(p: TslNode): TslNode {
  return fract(sin(dot(p, vec2(41.3, 289.1))).mul(43758.5453));
}

export function createStoneNodeMaterial(
  lighting: StoneLighting,
  instanceBuffers?: StoneStorageInstanceBuffers,
  hydrology?: StoneHydrologyWater,
): StoneNodeMaterialHandle {
  const riverMaterial = readRiverMaterialSettings();
  const uLight = uniform(lighting.light.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const uWetRockDarkening = uniform(riverMaterial.wetRockDarkening);

  let worldPos: TslNode = positionWorld;
  let normalNode: TslNode = normalize(normalWorld);
  let aboveWater: TslNode | null = null;
  let wetRock: TslNode | null = null;
  if (instanceBuffers) {
    const instAStore: TslNode = storage(instanceBuffers.instanceA, "vec4", instanceBuffers.capacity).toReadOnly();
    const instBStore: TslNode = storage(instanceBuffers.instanceB, "vec4", instanceBuffers.capacity).toReadOnly();
    const instA: TslNode = instAStore.element(instanceIndex);
    const instB: TslNode = instBStore.element(instanceIndex);
    const c: TslNode = cos(instB.x);
    const s: TslNode = sin(instB.x);
    const local: TslNode = positionGeometry.mul(instA.w);
    const rx: TslNode = c.mul(local.x).add(s.mul(local.z));
    const rz: TslNode = s.mul(local.x).negate().add(c.mul(local.z));
    // Snap the stone's ground to the carved-bed height (hydrology B channel) so it
    // sits on the carved terrain instead of floating on the un-carved base height.
    let groundY: TslNode = instA.y;
    const sinkDepth: TslNode = instB.w;
    if (hydrology?.texture) {
      const hydroSample = {
        texture: hydrology.texture,
        worldSize: hydrology.worldSize,
        res: hydrology.res,
      };
      const hydro: TslNode = sampleHydrologyBilinearTsl(instA.x, instA.z, hydroSample);
      const heightAboveWater: TslNode = instA.y.sub(hydro.x);
      groundY = sampleCarvedBedBilinearTsl(instA.x, instA.z, hydroSample).sub(sinkDepth);
      aboveWater = hydro.y.lessThan(0.5).or(heightAboveWater.greaterThan(0.03));
      wetRock = hydro.y
        .mul(float(1).sub(smoothstep(0.10, 2.15, heightAboveWater)))
        .mul(uWetRockDarkening);
    }
    worldPos = vec3(
      rx.add(instB.y.mul(local.y)).add(instA.x),
      local.y.add(groundY),
      rz.add(instB.z.mul(local.y)).add(instA.z),
    );
    const nrm: TslNode = normalGeometry;
    normalNode = normalize(vec3(
      c.mul(nrm.x).add(s.mul(nrm.z)),
      nrm.y,
      s.mul(nrm.x).negate().add(c.mul(nrm.z)),
    ));
  }
  const vdata: TslNode = attribute("vdata", "vec4");
  const n0: TslNode = normalNode;
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
  if (wetRock) {
    const fleck = smoothstep(0.78, 0.98, hash2(floor(worldPos.xz.mul(3.5).add(worldPos.y.mul(0.4))))).mul(wetRock).mul(0.42);
    rock = mix(rock, rock.mul(vec3(0.42, 0.50, 0.48)), wetRock);
    rock = mix(rock, vec3(0.72, 0.78, 0.74), fleck);
  }

  const ao = clamp(vdata.w, 0.0, 1.0);
  const sun = max(dot(n, uLight), 0.0);
  const sky = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi = mix(uGround, uSky, sky);
  const direct = uSun.mul(sun);

  const material = new MeshBasicNodeMaterial();
  if (instanceBuffers) material.positionNode = worldPos;
  material.colorNode = rock.mul(hemi.add(direct)).mul(ao);
  if (aboveWater) (material as unknown as { maskNode: TslNode }).maskNode = aboveWater;
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
