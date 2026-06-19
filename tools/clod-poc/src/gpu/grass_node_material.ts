// Phase 3 WebGPU grass (docs/webgpu-migration.md). TSL port of src/grass.ts:
// classic blades plus terrain-patch-v2 distance/edge/slope fades and alpha-to-coverage.
// Blades are placed by the reused generateGrassInstances(); this only re-authors the
// material + instanced geometry assembly for WebGPURenderer.

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

const V2_NEAR_BLADE_ROWS = [
  [0, 1],
  [0.55, 0.6],
  [1, 0],
] as const;
const V2_MID_BLADE_ROWS = [
  [0, 0.78],
  [1, 0],
] as const;
export const GRASS_V2_NEAR_DISTANCE_FRACTION = 0.42;
export const GRASS_V2_MID_DISTANCE_FRACTION = 0.78;
const V2_MID_INSTANCE_FRACTION = 0.35;

export interface GrassNodeParams {
  lighting: EnvironmentLighting;
  bladeWidth: number;
  windStrength: number;
  windSpeed: number;
  mode?: "classic" | "terrain-patch-v2";
  alphaToCoverage?: boolean;
  distance?: number;
  fadeCenter?: THREE.Vector2;
  debugAttributes?: boolean;
}

export interface GrassNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  /** Advance wind animation (seconds). */
  setTime(t: number): void;
  /** Update the XZ point used by terrain-patch-v2 distance fading. */
  setFadeCenter(x: number, z: number): void;
}

export function createGrassNodeMaterial(params: GrassNodeParams): GrassNodeMaterialHandle {
  const uTime = uniform(0);
  const uBladeWidth = uniform(params.bladeWidth);
  const uWindStrength = uniform(params.windStrength);
  const uWindSpeed = uniform(params.windSpeed);
  const uFadeCenter = uniform(params.fadeCenter?.clone() ?? new THREE.Vector2());
  const uLight = uniform(params.lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(params.lighting.sunColor));
  const uSky = uniform(v3(params.lighting.skyLight));
  const uGround = uniform(v3(params.lighting.groundLight));
  const isPatchV2 = params.mode === "terrain-patch-v2";
  const useAlphaToCoverage = isPatchV2 && params.alphaToCoverage === true;
  const debugAttributes = isPatchV2 && params.debugAttributes === true;

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
  let localX: TslNode;
  let localY: TslNode;
  let localZ: TslNode;
  let grassColor: TslNode;
  let coverage: TslNode | null = null;
  const pos: TslNode = positionGeometry;

  if (isPatchV2) {
    localX = pos.x.mul(uBladeWidth).add(wind.x);
    localY = pos.y.mul(aHeight);
    localZ = pos.z.mul(uBladeWidth).add(wind.y);

    const base = vec3(0.04, 0.16, 0.035);
    const mid = vec3(0.16, 0.36, 0.075);
    const tip = vec3(0.43, 0.58, 0.16);
    const dry = vec3(0.48, 0.38, 0.11);
    grassColor = mix(base, mid, smoothstep(0.0, 0.7, uvY));
    grassColor = mix(grassColor, tip, smoothstep(0.62, 1.0, uvY));
    grassColor = mix(grassColor, dry, aColorMix.mul(0.42));
    if (debugAttributes) {
      const edge: TslNode = clamp(attribute("aEdgeFade", "float"), 0.0, 1.0);
      const normalY: TslNode = clamp(attribute("aNormalY", "float"), 0.0, 1.0);
      grassColor = vec3(edge, normalY, 0.08);
    }
  } else {
    localX = pos.x.mul(uBladeWidth).add(wind.x);
    localY = pos.y.mul(aHeight);
    localZ = pos.z.add(wind.y);

    const darkGreen = vec3(0.035, 0.12, 0.025);
    const midGreen = vec3(0.12, 0.34, 0.055);
    const tipGreen = vec3(0.34, 0.56, 0.12);
    const dryGrass = vec3(0.52, 0.42, 0.12);
    grassColor = mix(darkGreen, midGreen, smoothstep(0.0, 0.62, uvY));
    grassColor = mix(grassColor, tipGreen, smoothstep(0.58, 1.0, uvY));
    grassColor = mix(grassColor, dryGrass, aColorMix.mul(0.58));
  }

  const c: TslNode = cos(aRotY);
  const s: TslNode = sin(aRotY);
  // Y-rotation of the wind-displaced local position, then world-place at aOffset.
  const rotX: TslNode = c.mul(localX).add(s.mul(localZ));
  const rotZ: TslNode = s.mul(localX).negate().add(c.mul(localZ));
  const worldPos: TslNode = aOffset.add(vec3(rotX, localY, rotZ));

  const localNormal: TslNode = normalize(
    vec3(nrmComponent("x").sub(wind.x.mul(0.35)), nrmComponent("y").add(bend.mul(0.16)), nrmComponent("z").sub(wind.y.mul(0.35))),
  );
  const worldNormal: TslNode = normalize(
    vec3(c.mul(localNormal.x).add(s.mul(localNormal.z)), localNormal.y, s.mul(localNormal.x).negate().add(c.mul(localNormal.z))),
  );

  // Flip the normal on back faces (double-sided blades).
  const n: TslNode = frontFacing.select(worldNormal, worldNormal.negate());
  const lightDir: TslNode = uLight;
  const sun: TslNode = max(dot(n, lightDir), 0.0);
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi: TslNode = mix(uGround, uSky, sky);
  const back: TslNode = max(dot(n.negate(), lightDir), 0.0);
  let litColor: TslNode;
  if (isPatchV2) {
    const wrap: TslNode = clamp(dot(n, lightDir).mul(0.45).add(0.55), 0.0, 1.0);
    const direct: TslNode = uSun.mul(sun.mul(0.65).add(wrap.mul(0.28)));
    const transmission: TslNode = vec3(0.42, 0.52, 0.12).mul(back).mul(uvY.mul(0.42).add(0.14));
    litColor = grassColor.mul(hemi.add(direct)).add(transmission.mul(grassColor));
  } else {
    const direct: TslNode = uSun.mul(pow(sun, 1.25));
    const transmission: TslNode = vec3(0.46, 0.55, 0.12).mul(back).mul(uvY.mul(0.5).add(0.16));
    litColor = grassColor.mul(hemi.add(direct)).add(transmission.mul(grassColor));
  }

  const material = new MeshBasicNodeMaterial();
  material.positionNode = worldPos; // identity model transform -> local == world
  material.colorNode = litColor;
  if (coverage && useAlphaToCoverage) material.opacityNode = coverage;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  material.depthWrite = true;
  material.alphaToCoverage = useAlphaToCoverage;

  return {
    material,
    setTime(t) {
      uTime.value = t;
    },
    setFadeCenter(x, z) {
      uFadeCenter.value.set(x, z);
    },
  };
}

function nrmComponent(axis: "x" | "y" | "z"): TslNode {
  const nrm: TslNode = normalGeometry;
  return nrm[axis];
}

export interface GrassInstancedGeometryOptions {
  mode?: "classic" | "terrain-patch-v2";
  tier?: "near" | "mid";
  crossed?: boolean;
  edgeShape?: boolean;
}

// Build an InstancedBufferGeometry: the shared classic blade geometry plus one set of
// per-instance attributes from the placed blades.
export function buildGrassInstancedGeometry(
  instances: readonly GrassBladeInstance[],
  options: GrassInstancedGeometryOptions = {},
): THREE.InstancedBufferGeometry {
  const mode = options.mode ?? "classic";
  const rows = mode === "terrain-patch-v2" && options.tier === "mid" ? V2_MID_BLADE_ROWS : mode === "terrain-patch-v2" ? V2_NEAR_BLADE_ROWS : undefined;
  const base = rows ? createBladeGeometry(rows, options.crossed === true && options.tier !== "mid") : createBladeGeometry();
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
  const edgeFade = new Float32Array(count);
  const normalY = new Float32Array(count);
  instances.forEach((b, i) => {
    offset[i * 3] = b.offset[0];
    offset[i * 3 + 1] = b.offset[1];
    offset[i * 3 + 2] = b.offset[2];
    const edgeMultiplier = options.edgeShape === true && mode === "terrain-patch-v2"
      ? THREE.MathUtils.lerp(0.35, 1.0, THREE.MathUtils.clamp(b.edgeFade, 0, 1))
      : 1;
    height[i] = b.height * edgeMultiplier;
    rotY[i] = b.rotationY;
    phase[i] = b.phase;
    colorMix[i] = b.colorMix;
    edgeFade[i] = b.edgeFade;
    normalY[i] = b.normalY;
  });
  geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offset, 3));
  geo.setAttribute("aHeight", new THREE.InstancedBufferAttribute(height, 1));
  geo.setAttribute("aRotY", new THREE.InstancedBufferAttribute(rotY, 1));
  geo.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phase, 1));
  geo.setAttribute("aColorMix", new THREE.InstancedBufferAttribute(colorMix, 1));
  geo.setAttribute("aEdgeFade", new THREE.InstancedBufferAttribute(edgeFade, 1));
  geo.setAttribute("aNormalY", new THREE.InstancedBufferAttribute(normalY, 1));
  geo.instanceCount = count;
  base.dispose();
  return geo;
}

export function grassMidInstances(instances: readonly GrassBladeInstance[]): GrassBladeInstance[] {
  const midCount = Math.max(1, Math.floor(instances.length * V2_MID_INSTANCE_FRACTION));
  return instances.slice(0, midCount).map((instance) => ({
    ...instance,
    height: instance.height * 1.55,
    edgeFade: Math.min(1, instance.edgeFade * 1.15),
  }));
}
