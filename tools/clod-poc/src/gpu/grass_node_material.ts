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
  instanceIndex,
  max,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  pow,
  screenCoordinate,
  sin,
  smoothstep,
  storage,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment.js";
import {
  createBladeGeometry,
  createGrassClumpGeometry,
  createGrassTuftGeometry,
  DEFAULT_GRASS_SETTINGS,
  grassRowsForSegments,
  type GrassBladeInstance,
  type GrassLighting,
  type GrassRingInstanceBuffers,
  type GrassSettings,
  type GrassTier,
} from "../grass.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);

export const GRASS_V2_NEAR_DISTANCE_FRACTION = DEFAULT_GRASS_SETTINGS.lod.nearFraction;
export const GRASS_V2_MID_DISTANCE_FRACTION = DEFAULT_GRASS_SETTINGS.lod.midFraction;

export interface GrassNodeParams {
  lighting: EnvironmentLighting;
  bladeWidth: number;
  windStrength: number;
  windSpeed: number;
  gustStrength?: number;
  mode?: GrassSettings["shaderMode"];
  alphaToCoverage?: boolean;
  distance?: number;
  ring?: GrassSettings["ring"];
  lod?: GrassSettings["lod"];
  fadeCenter?: THREE.Vector2;
  debugAttributes?: boolean;
  /** When set (webgpu-ring-v1), instances are read from these storage buffers, not attributes. */
  ringInstanceBuffers?: GrassRingInstanceBuffers;
  /**
   * Hydrology water-surface texture (R = water Y; dry cells carry a below-ground
   * sentinel). When set, blades whose ground sits under the water surface are
   * discarded so grass stops floating over hydrology lakes/rivers. (Stage 1 — does
   * not move blades; the terrain carve itself is a later stage.)
   */
  hydrologyWaterTexture?: THREE.Texture | null;
  /** World size (worldCells) used to map instance XZ → hydrology texture UV. */
  worldSize?: number;
  /** Metres of blade base allowed below the water surface before discard. */
  waterClearance?: number;
  /** Explicit tier base offset into the shared storage buffer (tier * maxPerTier). When set, the material reads instanceIndex + tierBaseOffset instead of relying on indirect firstInstance. */
  tierBaseOffset?: number;
}

export interface GrassNodeMaterialHandle {
  material: MeshBasicNodeMaterial;
  /** Advance wind animation (seconds). */
  setTime(t: number): void;
  /** Update the XZ point used by terrain-patch-v2 distance fading. */
  setFadeCenter(x: number, z: number): void;
  updateSettings(settings: Pick<GrassSettings, "bladeWidth" | "windStrength" | "windSpeed" | "distance" | "alphaToCoverage" | "ring" | "lod">): void;
  updateLighting(lighting: EnvironmentLighting | GrassLighting): void;
}

export function createGrassNodeMaterial(params: GrassNodeParams): GrassNodeMaterialHandle {
  const uTime = uniform(0);
  const uBladeWidth = uniform(params.bladeWidth);
  const uWindStrength = uniform(params.windStrength);
  const uWindSpeed = uniform(params.windSpeed);
  const uGustStrength = uniform(params.gustStrength ?? 0.15);
  const uFadeCenter = uniform(params.fadeCenter?.clone() ?? new THREE.Vector2());
  const ringSettings = params.ring ?? DEFAULT_GRASS_SETTINGS.ring;
  const lodSettings = params.lod ?? DEFAULT_GRASS_SETTINGS.lod;
  const distance = params.distance ?? DEFAULT_GRASS_SETTINGS.distance;
  const uNearDistance = uniform(Math.min(distance * lodSettings.nearFraction, ringSettings.nearMeters));
  const uMidDistance = uniform(Math.min(distance * lodSettings.midFraction, ringSettings.midMeters));
  const uFarDistance = uniform(Math.min(distance * ringSettings.farDistanceFraction, ringSettings.farMeters));
  const uBandDistance = uniform(ringSettings.bandMeters);
  const uLight = uniform(params.lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(params.lighting.sunColor));
  const uSky = uniform(v3(params.lighting.skyLight));
  const uGround = uniform(v3(params.lighting.groundLight));
  const isPatchV2 = params.mode === "terrain-patch-v2" || params.mode === "webgpu-ring-v1";
  let useAlphaToCoverage = isPatchV2 && params.alphaToCoverage === true;
  const debugAttributes = isPatchV2 && params.debugAttributes === true;

  // Per-instance data. CPU-patch path: InstancedBufferAttribute read via attribute(). GPU-ring
  // path: storage buffers read via storage().element(instanceIndex) — instanceIndex carries the
  // per-tier firstInstance from the indirect args, so one material serves all four tiers. Read-only
  // because a vertex stage may not bind read_write storage. Layout matches grass_ring.compute.wgsl:
  //   offset = (x, y, z, 1) ; packed0 = (height, rotY, phase, colorMix) ;
  //   packed1 = (edgeFade, normalY, widthScale, tier) ; terrainNormal = (nx, ny, nz, 0).
  const ring = params.ringInstanceBuffers;
  const uTierBaseOffset = uniform(params.tierBaseOffset ?? 0) as TslNode;
  let aOffset4: TslNode;
  let aPacked0: TslNode;
  let aPacked1: TslNode;
  let aTerrainNormal4: TslNode;
  if (ring) {
    // toReadOnly() on the storage node (a vertex stage may not bind read_write storage), then index.
    // instanceIndex includes the per-tier firstInstance from indirect draw args, so one material
    // serves all four tiers. The optional tierBaseOffset uniform (set when per-tier materials are
    // used) adds an explicit offset for safety; when omitted it defaults to 0 and the indirect
    // firstInstance provides the tier separation.
    const offsetStore: TslNode = storage(ring.offset, "vec4", ring.capacity).toReadOnly();
    const packed0Store: TslNode = storage(ring.packed0, "vec4", ring.capacity).toReadOnly();
    const packed1Store: TslNode = storage(ring.packed1, "vec4", ring.capacity).toReadOnly();
    const terrainNormalStore: TslNode = storage(ring.terrainNormal, "vec4", ring.capacity).toReadOnly();
    const storageIndex: TslNode = instanceIndex.add(uTierBaseOffset);
    aOffset4 = offsetStore.element(storageIndex);
    aPacked0 = packed0Store.element(storageIndex);
    aPacked1 = packed1Store.element(storageIndex);
    aTerrainNormal4 = terrainNormalStore.element(storageIndex);
  } else {
    aOffset4 = attribute("aOffset", "vec4");
    aPacked0 = attribute("aPacked0", "vec4");
    aPacked1 = attribute("aPacked1", "vec4");
    aTerrainNormal4 = attribute("aTerrainNormal", "vec4");
  }
  const aOffset: TslNode = aOffset4.xyz;
  // Hydrology field (R = waterY, G = wetMask, B = carved-bed Y). Snap the blade's
  // ground onto the carved bed (the height the mesh is built at) so grass stops
  // floating over carved terrain; reuse the sample for the under-water discard.
  let groundY: TslNode = aOffset.y;
  let hydroWaterY: TslNode | null = null;
  if (params.hydrologyWaterTexture) {
    const uHydroWorldSize = uniform(params.worldSize ?? 1);
    const hydroUv: TslNode = vec2(aOffset.x, aOffset.z).div(uHydroWorldSize);
    const hydro: TslNode = texture(params.hydrologyWaterTexture, hydroUv);
    hydroWaterY = hydro.x;
    groundY = hydro.z;
  }
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
  const gustBase: TslNode = sin(windTime.mul(0.13)).mul(0.5).add(0.5);
  const gustDetail: TslNode = sin(windTime.mul(0.73).add(aOffset.x.mul(0.19).add(aOffset.z.mul(0.14)))).mul(0.5).add(0.5);
  const gust: TslNode = gustBase.mul(0.6).add(gustDetail.mul(0.4));
  const gustK: TslNode = aTerrainNormal4.w;
  const windAmp: TslNode = uWindStrength.mul(aHeight).mul(bend).mul(uGustStrength.mul(gust).mul(gustK).add(1.0).sub(uGustStrength));
  const wind: TslNode = vec2(sin(windTime), cos(windTime.mul(0.83).add(aPhase.mul(0.37))))
    .mul(windAmp);
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
  const worldPos: TslNode = vec3(aOffset.x, groundY, aOffset.z).add(vec3(rotX, localY, rotZ));

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

  // Discard blades whose (carved-bed) ground is under the hydrology water surface,
  // keeping land grass (dry cells store a below-ground sentinel water Y).
  let aboveWater: TslNode | null = null;
  if (hydroWaterY) {
    const uWaterClearance = uniform(params.waterClearance ?? 0.5);
    aboveWater = groundY.greaterThan(hydroWaterY.add(uWaterClearance));
  }

  const material = new MeshBasicNodeMaterial();
  material.positionNode = worldPos; // identity model transform -> local == world
  material.colorNode = litColor;
  if (params.mode === "webgpu-ring-v1") {
    const dist: TslNode = vec2(aOffset.x, aOffset.z).sub(uFadeCenter).length();
    const bandMask: TslNode = grassRingBandMask(aTier, dist, uNearDistance, uMidDistance, uFarDistance, uBandDistance);
    (material as unknown as { maskNode: TslNode }).maskNode =
      aboveWater ? bandMask.and(aboveWater) : bandMask;
  } else if (aboveWater) {
    (material as unknown as { maskNode: TslNode }).maskNode = aboveWater;
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
      if ("gustStrength" in settings) uGustStrength.value = (settings as { gustStrength?: number }).gustStrength ?? 0.15;
      uNearDistance.value = Math.min(settings.distance * settings.lod.nearFraction, settings.ring.nearMeters);
      uMidDistance.value = Math.min(settings.distance * settings.lod.midFraction, settings.ring.midMeters);
      uFarDistance.value = Math.min(settings.distance * settings.ring.farDistanceFraction, settings.ring.farMeters);
      uBandDistance.value = settings.ring.bandMeters;
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
  settings?: GrassSettings;
}

// Build an InstancedBufferGeometry: the shared classic blade geometry plus one set of
// per-instance attributes from the placed blades.
export function buildGrassInstancedGeometry(
  instances: readonly GrassBladeInstance[],
  options: GrassInstancedGeometryOptions = {},
): THREE.InstancedBufferGeometry {
  const mode = options.mode ?? "classic";
  const terrainPatchMode = mode === "terrain-patch-v2" || mode === "webgpu-ring-v1";
  const settings = options.settings ?? DEFAULT_GRASS_SETTINGS;
  const nearRows = grassRowsForSegments(settings.blade.nearSegments);
  const midRows = grassRowsForSegments(settings.blade.midSegments, 0);
  const rows = terrainPatchMode && options.tier === "mid" ? midRows : terrainPatchMode ? nearRows : undefined;
  let base: THREE.BufferGeometry;
  if (mode === "webgpu-ring-v1" && options.tier === "near") {
    base = createGrassClumpGeometry(settings.blade.nearBladesPerInstance, settings.blade.nearSegments, settings);
  } else if (mode === "webgpu-ring-v1" && options.tier === "mid") {
    base = createGrassClumpGeometry(settings.blade.midBladesPerInstance, settings.blade.midSegments, settings);
  } else if (terrainPatchMode && options.tier === "far") {
    base = createGrassTuftGeometry(settings);
  } else if (terrainPatchMode && options.tier === "super") {
    base = createGrassTuftGeometry(settings.blade.farTuftWidthM * 1.45 / Math.max(settings.blade.widthM, 0.001));
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
  const midCount = Math.max(1, Math.floor(instances.length * DEFAULT_GRASS_SETTINGS.lod.midInstanceFraction));
  return instances.slice(0, midCount).map((instance) => ({
    ...instance,
    height: instance.height * 1.55,
    edgeFade: Math.min(1, instance.edgeFade * 1.15),
  }));
}
