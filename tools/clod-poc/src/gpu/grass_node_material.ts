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
  float,
  fract,
  frontFacing,
  max,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  pow,
  screenCoordinate,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment.js";
import {
  createBladeGeometry,
  createGrassTuftGeometry,
  type GrassBladeInstance,
  type GrassLighting,
  type GrassSettings,
  type GrassTier,
} from "../grass.js";

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
const RING_FAR_DISTANCE_FRACTION = 0.94;
const RING_NEAR_METERS = 36;
const RING_MID_METERS = 110;
const RING_FAR_METERS = 170;
const RING_BAND_METERS = 12;

export interface GrassNodeParams {
  lighting: EnvironmentLighting;
  bladeWidth: number;
  windStrength: number;
  windSpeed: number;
  mode?: GrassSettings["shaderMode"];
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
  updateSettings(settings: Pick<GrassSettings, "bladeWidth" | "windStrength" | "windSpeed" | "distance" | "alphaToCoverage">): void;
  updateLighting(lighting: EnvironmentLighting | GrassLighting): void;
}

export function createGrassNodeMaterial(params: GrassNodeParams): GrassNodeMaterialHandle {
  const uTime = uniform(0);
  const uBladeWidth = uniform(params.bladeWidth);
  const uWindStrength = uniform(params.windStrength);
  const uWindSpeed = uniform(params.windSpeed);
  const uFadeCenter = uniform(params.fadeCenter?.clone() ?? new THREE.Vector2());
  const uNearDistance = uniform(Math.min((params.distance ?? 96) * GRASS_V2_NEAR_DISTANCE_FRACTION, RING_NEAR_METERS));
  const uMidDistance = uniform(Math.min((params.distance ?? 96) * GRASS_V2_MID_DISTANCE_FRACTION, RING_MID_METERS));
  const uFarDistance = uniform(Math.min((params.distance ?? 96) * RING_FAR_DISTANCE_FRACTION, RING_FAR_METERS));
  const uBandDistance = uniform(RING_BAND_METERS);
  const uLight = uniform(params.lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(params.lighting.sunColor));
  const uSky = uniform(v3(params.lighting.skyLight));
  const uGround = uniform(v3(params.lighting.groundLight));
  const isPatchV2 = params.mode === "terrain-patch-v2" || params.mode === "webgpu-ring-v1";
  let useAlphaToCoverage = isPatchV2 && params.alphaToCoverage === true;
  const debugAttributes = isPatchV2 && params.debugAttributes === true;

  // Per-instance attributes (InstancedBufferAttribute on the geometry).
  const aOffset4: TslNode = attribute("aOffset", "vec4");
  const aOffset: TslNode = aOffset4.xyz;
  // Packed to stay below WebGPU's common 8 vertex-buffer limit:
  // x=height, y=rotY, z=phase, w=colorMix.
  const aPacked0: TslNode = attribute("aPacked0", "vec4");
  // x=edgeFade, y=normalY, z=widthScale, w=unused.
  const aPacked1: TslNode = attribute("aPacked1", "vec4");
  const aTerrainNormal4: TslNode = attribute("aTerrainNormal", "vec4");
  const aTerrainNormal: TslNode = aTerrainNormal4.xyz;
  const aHeight: TslNode = aPacked0.x;
  const aRotY: TslNode = aPacked0.y;
  const aPhase: TslNode = aPacked0.z;
  const aColorMix: TslNode = aPacked0.w;
  const aWidthScale: TslNode = aPacked1.z;
  const aTier: TslNode = aPacked1.w;
  const uvY: TslNode = uv().y;
  const bend: TslNode = uvY.mul(uvY);
  const windTime: TslNode = uTime.mul(uWindSpeed).add(aPhase).add(aOffset.x.mul(0.071)).add(aOffset.z.mul(0.053));
  const wind: TslNode = vec2(sin(windTime), cos(windTime.mul(0.83).add(aPhase.mul(0.37))))
    .mul(uWindStrength.mul(aHeight).mul(bend));
  let localX: TslNode;
  let localY: TslNode;
  let localZ: TslNode;
  let grassColor: TslNode;
  const pos: TslNode = positionGeometry;

  if (isPatchV2) {
    const edge: TslNode = clamp(aPacked1.x, 0.0, 1.0);
    const terrainNormal: TslNode = normalize(aTerrainNormal);
    const normalY: TslNode = clamp(terrainNormal.y, 0.0, 1.0);
    localX = pos.x.mul(uBladeWidth).mul(aWidthScale).add(wind.x);
    localY = pos.y.mul(aHeight);
    localZ = pos.z.mul(uBladeWidth).mul(aWidthScale).add(wind.y);

    const base = vec3(0.04, 0.16, 0.035);
    const mid = vec3(0.16, 0.36, 0.075);
    const tip = vec3(0.43, 0.58, 0.16);
    const dry = vec3(0.48, 0.38, 0.11);
    grassColor = mix(base, mid, smoothstep(0.0, 0.7, uvY));
    grassColor = mix(grassColor, tip, smoothstep(0.62, 1.0, uvY));
    grassColor = mix(grassColor, dry, aColorMix.mul(0.42));
    if (debugAttributes) {
      grassColor = vec3(edge, normalY, 0.08);
    }
  } else {
    localX = pos.x.mul(uBladeWidth).mul(aWidthScale).add(wind.x);
    localY = pos.y.mul(aHeight);
    localZ = pos.z.mul(uBladeWidth).mul(aWidthScale).add(wind.y);

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
  const bladeNormal: TslNode = normalize(
    vec3(c.mul(localNormal.x).add(s.mul(localNormal.z)), localNormal.y, s.mul(localNormal.x).negate().add(c.mul(localNormal.z))),
  );
  const terrainNormalPull: TslNode = isPatchV2 ? smoothstep(0.18, 1.0, uvY).mul(0.35) : 0.0;
  const worldNormal: TslNode = isPatchV2
    ? normalize(mix(bladeNormal, normalize(aTerrainNormal), terrainNormalPull))
    : bladeNormal;

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
    const ambientFloor: TslNode = grassColor.mul(0.24);
    litColor = ambientFloor.add(grassColor.mul(hemi.add(direct))).add(transmission.mul(grassColor));
  } else {
    const direct: TslNode = uSun.mul(pow(sun, 1.25));
    const transmission: TslNode = vec3(0.46, 0.55, 0.12).mul(back).mul(uvY.mul(0.5).add(0.16));
    const ambientFloor: TslNode = grassColor.mul(0.24);
    litColor = ambientFloor.add(grassColor.mul(hemi.add(direct))).add(transmission.mul(grassColor));
  }

  const material = new MeshBasicNodeMaterial();
  material.positionNode = worldPos; // identity model transform -> local == world
  material.colorNode = litColor;
  if (params.mode === "webgpu-ring-v1") {
    const dist: TslNode = vec2(aOffset.x, aOffset.z).sub(uFadeCenter).length();
    (material as unknown as { maskNode: TslNode }).maskNode =
      grassRingBandMask(aTier, dist, uNearDistance, uMidDistance, uFarDistance, uBandDistance);
  }
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
    updateSettings(settings) {
      uBladeWidth.value = settings.bladeWidth;
      uWindStrength.value = settings.windStrength;
      uWindSpeed.value = settings.windSpeed;
      uNearDistance.value = Math.min(settings.distance * GRASS_V2_NEAR_DISTANCE_FRACTION, RING_NEAR_METERS);
      uMidDistance.value = Math.min(settings.distance * GRASS_V2_MID_DISTANCE_FRACTION, RING_MID_METERS);
      uFarDistance.value = Math.min(settings.distance * RING_FAR_DISTANCE_FRACTION, RING_FAR_METERS);
      useAlphaToCoverage = isPatchV2 && settings.alphaToCoverage === true;
      material.alphaToCoverage = useAlphaToCoverage;
      material.needsUpdate = true;
    },
    updateLighting(lighting) {
      const light = "sunDirection" in lighting ? lighting.sunDirection : lighting.light;
      uLight.value.copy(light).normalize();
      uSun.value.copy(v3(lighting.sunColor));
      uSky.value.copy(v3(lighting.skyLight));
      uGround.value.copy(v3(lighting.groundLight));
    },
  };
}

function nrmComponent(axis: "x" | "y" | "z"): TslNode {
  const nrm: TslNode = normalGeometry;
  return nrm[axis];
}

function interleavedGradientNoise(p: TslNode): TslNode {
  return fract(fract(p.x.mul(0.06711056).add(p.y.mul(0.00583715))).mul(52.9829189));
}

function grassRingBandMask(
  tier: TslNode,
  dist: TslNode,
  nearDistance: TslNode,
  midDistance: TslNode,
  farDistance: TslNode,
  bandDistance: TslNode,
): TslNode {
  const ign = interleavedGradientNoise(screenCoordinate);
  const fadeIn = (distance: TslNode): TslNode => smoothstep(distance.sub(bandDistance), distance.add(bandDistance), dist);
  const fadeOut = (distance: TslNode): TslNode => float(1).sub(smoothstep(distance.sub(bandDistance), distance.add(bandDistance), dist));
  const passIn = (fade: TslNode): TslNode => ign.greaterThanEqual(float(1).sub(fade));
  const passOut = (fade: TslNode): TslNode => ign.lessThan(fade);
  const nearPass = tier.lessThan(0.5).and(passOut(fadeOut(nearDistance)));
  const midPass = tier.greaterThanEqual(0.5).and(tier.lessThan(1.5))
    .and(passIn(fadeIn(nearDistance))).and(passOut(fadeOut(midDistance)));
  const farPass = tier.greaterThanEqual(1.5).and(tier.lessThan(2.5))
    .and(passIn(fadeIn(midDistance))).and(passOut(fadeOut(farDistance)));
  const superPass = tier.greaterThanEqual(2.5).and(passIn(fadeIn(farDistance)));
  return nearPass.or(midPass).or(farPass).or(superPass);
}

export interface GrassInstancedGeometryOptions {
  mode?: GrassSettings["shaderMode"];
  tier?: GrassTier;
  crossed?: boolean;
  edgeShape?: boolean;
}

function makeDeterministicRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function transformedBladeGeometry(
  blades: number,
  rows: readonly (readonly [number, number])[],
  seed: number,
): THREE.BufferGeometry {
  const rnd = makeDeterministicRandom(seed + blades * 97 + rows.length * 17);
  const source = createBladeGeometry(rows, false);
  const sourcePosition = source.getAttribute("position");
  const sourceNormal = source.getAttribute("normal");
  const sourceUv = source.getAttribute("uv");
  const sourceIndex = source.getIndex();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let blade = 0; blade < blades; blade++) {
    const yaw = rnd() * Math.PI * 2;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    const offsetX = (rnd() - 0.5) * 0.18;
    const offsetZ = (rnd() - 0.5) * 0.18;
    const heightScale = 0.62 + rnd() * 0.7;
    const widthScale = 0.82 + rnd() * 0.55;
    const lean = (rnd() - 0.5) * 0.34;
    const baseVertex = positions.length / 3;

    for (let i = 0; i < sourcePosition.count; i++) {
      const x = sourcePosition.getX(i) * widthScale;
      const y = sourcePosition.getY(i) * heightScale;
      const z = sourcePosition.getZ(i);
      const shearX = x + lean * y;
      positions.push(
        shearX * cosYaw + z * sinYaw + offsetX,
        y,
        z * cosYaw - shearX * sinYaw + offsetZ,
      );
      normals.push(
        sourceNormal.getX(i) * cosYaw + sourceNormal.getZ(i) * sinYaw,
        sourceNormal.getY(i),
        sourceNormal.getZ(i) * cosYaw - sourceNormal.getX(i) * sinYaw,
      );
      uvs.push(sourceUv.getX(i), sourceUv.getY(i));
    }

    if (sourceIndex) {
      for (let i = 0; i < sourceIndex.count; i++) indices.push(baseVertex + sourceIndex.getX(i));
    }
  }

  source.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

// Build an InstancedBufferGeometry: the shared classic blade geometry plus one set of
// per-instance attributes from the placed blades.
export function buildGrassInstancedGeometry(
  instances: readonly GrassBladeInstance[],
  options: GrassInstancedGeometryOptions = {},
): THREE.InstancedBufferGeometry {
  const mode = options.mode ?? "classic";
  const terrainPatchMode = mode === "terrain-patch-v2" || mode === "webgpu-ring-v1";
  const rows = terrainPatchMode && options.tier === "mid" ? V2_MID_BLADE_ROWS : terrainPatchMode ? V2_NEAR_BLADE_ROWS : undefined;
  let base: THREE.BufferGeometry;
  if (mode === "webgpu-ring-v1" && options.tier === "near") {
    base = transformedBladeGeometry(5, V2_NEAR_BLADE_ROWS, 0x9e3779b9);
  } else if (mode === "webgpu-ring-v1" && options.tier === "mid") {
    base = transformedBladeGeometry(3, V2_MID_BLADE_ROWS, 0x85ebca6b);
  } else if (terrainPatchMode && options.tier === "far") {
    base = createGrassTuftGeometry(0.2);
  } else if (terrainPatchMode && options.tier === "super") {
    base = createGrassTuftGeometry(0.34);
  } else {
    base = rows ? createBladeGeometry(rows, options.crossed === true && options.tier !== "mid") : createBladeGeometry();
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute("position", base.getAttribute("position"));
  geo.setAttribute("uv", base.getAttribute("uv"));
  geo.setAttribute("normal", base.getAttribute("normal"));

  const count = instances.length;
  const offset = new Float32Array(count * 4);
  const packed0 = new Float32Array(count * 4);
  const packed1 = new Float32Array(count * 4);
  const terrainNormal = new Float32Array(count * 4);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  instances.forEach((b, i) => {
    offset[i * 4] = b.offset[0];
    offset[i * 4 + 1] = b.offset[1];
    offset[i * 4 + 2] = b.offset[2];
    offset[i * 4 + 3] = 1;
    const edgeMultiplier = options.edgeShape === true && terrainPatchMode
      ? THREE.MathUtils.lerp(0.35, 1.0, THREE.MathUtils.clamp(b.edgeFade, 0, 1))
      : 1;
    const height = b.height * edgeMultiplier;
    packed0[i * 4] = height;
    packed0[i * 4 + 1] = b.rotationY;
    packed0[i * 4 + 2] = b.phase;
    packed0[i * 4 + 3] = b.colorMix;
    packed1[i * 4] = b.edgeFade;
    packed1[i * 4 + 1] = b.normalY;
    packed1[i * 4 + 2] = b.widthScale ?? 1;
    packed1[i * 4 + 3] = tierIndex(options.tier);
    const normal = b.terrainNormal;
    terrainNormal[i * 4] = normal[0];
    terrainNormal[i * 4 + 1] = normal[1];
    terrainNormal[i * 4 + 2] = normal[2];
    terrainNormal[i * 4 + 3] = 0;
    minX = Math.min(minX, b.offset[0]);
    minY = Math.min(minY, b.offset[1]);
    minZ = Math.min(minZ, b.offset[2]);
    maxX = Math.max(maxX, b.offset[0]);
    maxY = Math.max(maxY, b.offset[1] + height);
    maxZ = Math.max(maxZ, b.offset[2]);
  });
  geo.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offset, 4));
  geo.setAttribute("aPacked0", new THREE.InstancedBufferAttribute(packed0, 4));
  geo.setAttribute("aPacked1", new THREE.InstancedBufferAttribute(packed1, 4));
  geo.setAttribute("aTerrainNormal", new THREE.InstancedBufferAttribute(terrainNormal, 4));
  geo.instanceCount = count;
  const margin = 4;
  geo.boundingBox = new THREE.Box3(
    new THREE.Vector3(minX - margin, minY - margin, minZ - margin),
    new THREE.Vector3(maxX + margin, maxY + margin, maxZ + margin),
  );
  geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  base.dispose();
  return geo;
}

function tierIndex(tier: GrassTier | undefined): number {
  if (tier === "mid") return 1;
  if (tier === "far") return 2;
  if (tier === "super") return 3;
  return 0;
}

export function grassMidInstances(instances: readonly GrassBladeInstance[]): GrassBladeInstance[] {
  const midCount = Math.max(1, Math.floor(instances.length * V2_MID_INSTANCE_FRACTION));
  return instances.slice(0, midCount).map((instance) => ({
    ...instance,
    height: instance.height * 1.55,
    edgeFade: Math.min(1, instance.edgeFade * 1.15),
  }));
}
