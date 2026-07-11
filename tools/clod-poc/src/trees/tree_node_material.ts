// WebGPU tree material: TSL port of the classic
// MeshStandardMaterial + onBeforeCompile path in tree_material.ts. The classic path
// relies on GLSL `onBeforeCompile` (#include <begin_vertex>, <map_fragment>) which
// WebGPURenderer silently drops, leaving the trees as solid black silhouettes. This
// reauthors the same look as a node graph: vertex-colour albedo, wind sway/flutter,
// and the same hemispheric + sun lighting as the grass/stone node materials.
// Geometry/LOD/scatter stays in TreeSystem.

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
  normalWorld,
  normalize,
  positionGeometry,
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
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import { TREE_LODS, type TreeLod, type TreeSettings } from "./tree_config.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import { barkTrunkAlbedo, sharedBarkTexture } from "./tree_node_bark_texture.js";
import {
  TREE_RING_CELL_SIZE_M,
  TREE_RING_JITTER_X_SALT,
  TREE_RING_JITTER_Z_SALT,
  TREE_RING_YAW_SALT,
} from "./tree_ring_placement.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);
const TREE_VARIANT_HASH_SALT = 1103;
const FOLIAGE_CARD_RADIUS_X = 0.48;
const FOLIAGE_CARD_RADIUS_Y = 0.50;
const FOLIAGE_CARD_EDGE_START = 0.72;
const FOLIAGE_CARD_KEEP_THRESHOLD = 0.22;

const LOD_COLORS: Record<TreeLod, THREE.Color> = {
  near: new THREE.Color(0x2e7d32),
  mid: new THREE.Color(0xd98032),
  far: new THREE.Color(0x3a6ea5),
  impostor: new THREE.Color(0x7755aa),
};

function fallbackLighting(): EnvironmentLighting {
  return {
    sunDirection: new THREE.Vector3(0.4, 0.85, 0.3).normalize(),
    sunColor: new THREE.Color(1.0, 0.96, 0.88),
    skyLight: new THREE.Color(0x6b7a94),
    groundLight: new THREE.Color(0x2e2921),
  };
}

interface TreeWindNodeUniforms {
  uTime: TslNode;
  uWindDir: TslNode;
  uWindStrength: TslNode;
  uWindSpeed: TslNode;
  uGust: TslNode;
  uTrunkSway: TslNode;
  uLeafFlutter: TslNode;
}

export interface TreeRingInstanceBuffers {
  cell: THREE.BufferAttribute;
  capacity: number;
}

export interface TreeHydrologyWater {
  /** RGBA32F hydrology field; G channel = wet mask (1 inside a water body). */
  texture: THREE.Texture | null;
  /** World size (worldCells) mapping instance XZ → hydrology UV. */
  worldSize: number;
}

function treeAboveWaterKeep(hydrology: TreeHydrologyWater | undefined, worldXZ: TslNode): TslNode | null {
  if (!hydrology?.texture) return null;
  const wetUv: TslNode = worldXZ.div(float(hydrology.worldSize || 1));
  return texture(hydrology.texture, wetUv).y.lessThan(0.5);
}

export function treeFoliageCardCoverageAt(u: number, v: number): number {
  const localU = ((u * 2) % 1 + 1) % 1;
  const localV = ((v * 2) % 1 + 1) % 1;
  const dx = (localU - 0.5) / FOLIAGE_CARD_RADIUS_X;
  const dy = (localV - 0.5) / FOLIAGE_CARD_RADIUS_Y;
  const distanceSquared = dx * dx + dy * dy;
  if (distanceSquared <= FOLIAGE_CARD_EDGE_START) return 1;
  if (distanceSquared >= 1) return 0;
  const t = (distanceSquared - FOLIAGE_CARD_EDGE_START) / (1 - FOLIAGE_CARD_EDGE_START);
  const smooth = t * t * (3 - 2 * t);
  return 1 - smooth;
}

function treeFoliageCardKeep(cardTag: TslNode): TslNode {
  const localUv: TslNode = fract(uv().mul(2));
  const centered: TslNode = localUv.sub(vec2(0.5, 0.5));
  const dx: TslNode = centered.x.div(FOLIAGE_CARD_RADIUS_X);
  const dy: TslNode = centered.y.div(FOLIAGE_CARD_RADIUS_Y);
  const distanceSquared: TslNode = dx.mul(dx).add(dy.mul(dy));
  const coverage: TslNode = float(1).sub(smoothstep(FOLIAGE_CARD_EDGE_START, 1, distanceSquared));
  return mix(float(1), coverage, clamp(cardTag, 0, 1)).greaterThan(FOLIAGE_CARD_KEEP_THRESHOLD);
}

export function createTreeNodeMaterialHandle(
  settings: TreeSettings,
  lighting: EnvironmentLighting = fallbackLighting(),
  hydrology?: TreeHydrologyWater,
): TreeMaterialHandle {
  const wind: TreeWindNodeUniforms = {
    uTime: uniform(0),
    uWindDir: uniform(new THREE.Vector2(1, 0)),
    uWindStrength: uniform(0),
    uWindSpeed: uniform(0),
    uGust: uniform(0),
    uTrunkSway: uniform(0),
    uLeafFlutter: uniform(0),
  };
  applyWindUniforms(wind, settings);
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const neutralForestData = new Uint8Array([0, 0, 0, 0]);
  const neutralForestTexture = new THREE.DataTexture(neutralForestData, 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  neutralForestTexture.needsUpdate = true;
  const uForestEnabled = uniform(0);
  const uForestWorldSize = uniform(1);
  const uForestAoStrength = uniform(1);
  const uForestShadowStrength = uniform(1);
  const uForestFogStrength = uniform(1);
  const uForestFogColor = uniform(new THREE.Vector3(0.72, 0.78, 0.81));
  const uVariantSeed = uniform(settings.seed);

  const forestMapNodes: TslNode[] = [];
  const materials: MeshBasicNodeMaterial[] = [];
  const prepassNodes = new Map<MeshBasicNodeMaterial, PrepassNodes>();

  const barkTexture = sharedBarkTexture(settings.seed);
  const buildMaterial = (albedoFactory: (vertexColor: TslNode) => TslNode, withBark: boolean): MeshBasicNodeMaterial => {
    const aColor: TslNode = attribute("color", "vec3");
    const aFoliageMask: TslNode = attribute("treeFoliageMask", "float");
    const aFoliageCard: TslNode = attribute("treeFoliageCard", "float");
    const aVariant: TslNode = attribute("treeVariant", "float");
    const aWind: TslNode = attribute("treeWind", "vec3");
    const aWindWeight: TslNode = aWind.x;
    const aFlutterWeight: TslNode = aWind.y;
    const aWorldXZ: TslNode = attribute("treeWorldXZ", "vec2");
    const variantKeep: TslNode = treeVariantKeep(aVariant, aWorldXZ, uVariantSeed);

    const forestUv: TslNode = clamp(aWorldXZ.div(uForestWorldSize), vec2(0), vec2(1));
    const forestPacked: TslNode = texture(neutralForestTexture, forestUv);
    forestMapNodes.push(forestPacked);
    const foliageAlbedo: TslNode = albedoFactory(aColor);
    const albedo: TslNode = withBark
      ? mix(barkTrunkAlbedo(aColor, barkTexture), foliageAlbedo, aFoliageMask)
      : foliageAlbedo;
    const opacity: TslNode = float(1);

    const phase: TslNode = fract(sin(dot(aWorldXZ, vec2(127.1, 311.7))).mul(43758.5453123));
    const t: TslNode = wind.uTime.mul(wind.uWindSpeed);
    const waveArg: TslNode = t.add(phase.mul(6.2831853)).add(dot(aWorldXZ, wind.uWindDir).mul(0.035));
    const sway: TslNode = sin(waveArg).mul(wind.uWindStrength)
      .add(sin(t.mul(0.37).add(phase.mul(12.9898))).mul(wind.uGust))
      .mul(aWindWeight).mul(wind.uTrunkSway);
    const flutter: TslNode = sin(t.mul(7.0).add(phase.mul(19.19)).add(positionGeometry.y.mul(2.3)))
      .mul(wind.uWindStrength).mul(wind.uLeafFlutter).mul(aFlutterWeight);
    const disp: TslNode = sway.add(flutter);
    const positionNode: TslNode = positionGeometry.mul(variantKeep).add(
      vec3(wind.uWindDir.x.mul(disp), float(0), wind.uWindDir.y.mul(disp)).mul(variantKeep),
    );

    const n0: TslNode = normalize(normalWorld);
    const n: TslNode = frontFacing.select(n0, n0.negate());
    const sun: TslNode = max(dot(n, uLight), 0.0);
    const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
    const hemi: TslNode = mix(uGround, uSky, sky);
    const direct: TslNode = uSun.mul(sun);
    const back: TslNode = max(dot(n.negate(), uLight), 0.0);
    const transmission: TslNode = albedo.mul(uSun).mul(back).mul(aFoliageMask).mul(0.5);
    const litBase: TslNode = albedo.mul(0.25).add(albedo.mul(hemi.add(direct))).add(transmission);
    const forestDarken: TslNode = clamp(
      forestPacked.x.mul(uForestAoStrength).add(forestPacked.y.mul(uForestShadowStrength)),
      0.0,
      0.72,
    ).mul(uForestEnabled);
    const forestFog: TslNode = clamp(forestPacked.z.mul(uForestFogStrength).mul(uForestEnabled), 0.0, 0.35);
    const lit: TslNode = mix(litBase.mul(float(1).sub(forestDarken)), uForestFogColor, forestFog)
      .add(vec3(forestPacked.w.mul(0.05).mul(uForestEnabled)));

    const aLodFade: TslNode = attribute("treeLodFade", "float");
    const ign: TslNode = fract(
      fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189),
    );

    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = lit;
    (material as unknown as { opacityNode: TslNode }).opacityNode = opacity;
    const lodMask: TslNode = ign.lessThan(aLodFade);
    const cardKeep: TslNode = treeFoliageCardKeep(aFoliageCard);
    const aboveWater: TslNode | null = treeAboveWaterKeep(hydrology, aWorldXZ);
    const maskNode: TslNode = aboveWater ? lodMask.and(cardKeep).and(aboveWater) : lodMask.and(cardKeep);
    (material as unknown as { maskNode: TslNode }).maskNode = maskNode;
    material.alphaTest = 0;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    materials.push(material);
    prepassNodes.set(material, { positionNode, maskNode, side: material.side });
    return material;
  };

  const regularMaterial = buildMaterial((vertexColor) => vertexColor, true);

  const debugMaterials = {} as Record<TreeLod, THREE.Material>;
  for (const lod of TREE_LODS) {
    const color = LOD_COLORS[lod];
    debugMaterials[lod] = buildMaterial(() => vec3(color.r, color.g, color.b), false);
  }

  return {
    regularMaterial,
    debugMaterials,
    prepassNodesFor() {
      return prepassNodes.get(regularMaterial);
    },
    setTime(timeSeconds: number) {
      wind.uTime.value = timeSeconds;
    },
    updateSettings(next: TreeSettings) {
      applyWindUniforms(wind, next);
      uVariantSeed.value = next.seed;
      for (const material of materials) {
        material.alphaTest = 0;
        material.transparent = false;
        material.depthWrite = true;
        material.needsUpdate = true;
      }
    },
    updateLighting(next: EnvironmentLighting) {
      uLight.value.copy(next.sunDirection).normalize();
      uSun.value.copy(v3(next.sunColor));
      uSky.value.copy(v3(next.skyLight));
      uGround.value.copy(v3(next.groundLight));
    },
    updateForestLighting(state: ForestLightingMaterialState | null) {
      if (!state) {
        uForestEnabled.value = 0;
        return;
      }
      const settings = state.settings;
      uForestEnabled.value = settings.enabled && settings.materialIntegration.treeEnabled ? 1 : 0;
      uForestWorldSize.value = Math.max(1, state.worldCells);
      uForestAoStrength.value = settings.ambientOcclusion.strength;
      uForestShadowStrength.value = settings.shadowProxy.strength;
      uForestFogStrength.value = settings.atmosphere.forestFogStrength + settings.atmosphere.aerialTintStrength;
      for (const mapNode of forestMapNodes) mapNode.value = state.textureHandle.texture;
    },
    dispose() {
      neutralForestTexture.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

export function createTreeRingNodeMaterialHandle(
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  _lod: TreeLod,
  lighting: EnvironmentLighting = fallbackLighting(),
  hydrology?: TreeHydrologyWater,
): TreeMaterialHandle {
  const wind: TreeWindNodeUniforms = {
    uTime: uniform(0),
    uWindDir: uniform(new THREE.Vector2(1, 0)),
    uWindStrength: uniform(0),
    uWindSpeed: uniform(0),
    uGust: uniform(0),
    uTrunkSway: uniform(0),
    uLeafFlutter: uniform(0),
  };
  applyWindUniforms(wind, settings);
  const uCellSize = uniform(TREE_RING_CELL_SIZE_M);
  const uSeed = uniform(settings.seed);
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const barkTexture = sharedBarkTexture(settings.seed);
  const materials: MeshBasicNodeMaterial[] = [];
  let debugColorByLod = settings.render.debugColorByLod;
  const prepassNodes = new Map<MeshBasicNodeMaterial, PrepassNodes>();

  const buildMaterial = (albedoFactory: (vertexColor: TslNode, tint: TslNode) => TslNode, withBark: boolean): MeshBasicNodeMaterial => {
    const aColor: TslNode = attribute("color", "vec3");
    const aFoliageMask: TslNode = attribute("treeFoliageMask", "float");
    const aFoliageCard: TslNode = attribute("treeFoliageCard", "float");
    const aVariant: TslNode = attribute("treeVariant", "float");
    const aWind: TslNode = attribute("treeWind", "vec3");
    const aWindWeight: TslNode = aWind.x;
    const aFlutterWeight: TslNode = aWind.y;
    const cellStore: TslNode = storage(buffers.cell, "vec4", buffers.capacity).toReadOnly();
    const aCell: TslNode = cellStore.element(instanceIndex);
    const worldCell: TslNode = aCell.xy;
    const jitter: TslNode = vec2(
      treeRingHash(worldCell, uSeed, TREE_RING_JITTER_X_SALT),
      treeRingHash(worldCell, uSeed, TREE_RING_JITTER_Z_SALT),
    );
    const aWorldXZ: TslNode = worldCell.add(jitter).mul(uCellSize);
    const aHeight: TslNode = aCell.z;
    const aScale: TslNode = max(aCell.w, float(0.001));
    const aYaw: TslNode = treeRingHash(worldCell, uSeed, TREE_RING_YAW_SALT).mul(6.28318530718);
    const aTint: TslNode = treeRingHash(worldCell, uSeed, 1901);
    const variantKeep: TslNode = treeVariantKeep(aVariant, aWorldXZ, uSeed);

    const foliageAlbedo: TslNode = albedoFactory(aColor, aTint);
    const albedo: TslNode = withBark
      ? mix(barkTrunkAlbedo(aColor, barkTexture), foliageAlbedo, aFoliageMask)
      : foliageAlbedo;
    const opacity: TslNode = float(1);

    const phase: TslNode = fract(sin(dot(aWorldXZ, vec2(127.1, 311.7))).mul(43758.5453123));
    const t: TslNode = wind.uTime.mul(wind.uWindSpeed);
    const waveArg: TslNode = t.add(phase.mul(6.2831853)).add(dot(aWorldXZ, wind.uWindDir).mul(0.035));
    const sway: TslNode = sin(waveArg).mul(wind.uWindStrength)
      .add(sin(t.mul(0.37).add(phase.mul(12.9898))).mul(wind.uGust))
      .mul(aWindWeight).mul(wind.uTrunkSway).mul(aScale);
    const flutter: TslNode = sin(t.mul(7.0).add(phase.mul(19.19)).add(positionGeometry.y.mul(2.3)))
      .mul(wind.uWindStrength).mul(wind.uLeafFlutter).mul(aFlutterWeight).mul(aScale);
    const disp: TslNode = sway.add(flutter);
    const localPosition: TslNode = positionGeometry.mul(aScale).mul(variantKeep).add(
      vec3(wind.uWindDir.x.mul(disp), float(0), wind.uWindDir.y.mul(disp)).mul(variantKeep),
    );

    const c: TslNode = cos(aYaw);
    const s: TslNode = sin(aYaw);
    const rotX: TslNode = c.mul(localPosition.x).add(s.mul(localPosition.z));
    const rotZ: TslNode = s.mul(localPosition.x).negate().add(c.mul(localPosition.z));
    const positionNode: TslNode = vec3(aWorldXZ.x.add(rotX), aHeight.add(localPosition.y), aWorldXZ.y.add(rotZ));

    const localNormal: TslNode = normalize(normalGeometry);
    const rotatedNormal: TslNode = normalize(
      vec3(c.mul(localNormal.x).add(s.mul(localNormal.z)), localNormal.y, s.mul(localNormal.x).negate().add(c.mul(localNormal.z))),
    );
    const n: TslNode = frontFacing.select(rotatedNormal, rotatedNormal.negate());
    const sun: TslNode = max(dot(n, uLight), 0.0);
    const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
    const hemi: TslNode = mix(uGround, uSky, sky);
    const direct: TslNode = uSun.mul(sun);
    const back: TslNode = max(dot(n.negate(), uLight), 0.0);
    const transmission: TslNode = albedo.mul(uSun).mul(back).mul(aFoliageMask).mul(0.5);
    const lit: TslNode = albedo.mul(0.25).add(albedo.mul(hemi.add(direct))).add(transmission);

    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = lit;
    (material as unknown as { opacityNode: TslNode }).opacityNode = opacity;
    const cardKeep: TslNode = treeFoliageCardKeep(aFoliageCard);
    const aboveWater: TslNode | null = treeAboveWaterKeep(hydrology, aWorldXZ);
    const maskNode: TslNode = aboveWater ? cardKeep.and(aboveWater) : cardKeep;
    (material as unknown as { maskNode: TslNode }).maskNode = maskNode;
    material.alphaTest = 0;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    materials.push(material);
    prepassNodes.set(material, {
      positionNode,
      maskNode,
      side: material.side,
    });
    return material;
  };

  const regularMaterial = buildMaterial((vertexColor, tint) =>
    vertexColor.mul(mix(vec3(0.88, 0.93, 0.82), vec3(1.08, 1.02, 0.9), tint)),
    true,
  );
  const debugMaterials = {} as Record<TreeLod, THREE.Material>;
  for (const lod of TREE_LODS) {
    const color = LOD_COLORS[lod];
    debugMaterials[lod] = buildMaterial(() => vec3(color.r, color.g, color.b), false);
  }

  return {
    regularMaterial,
    debugMaterials,
    setTime(timeSeconds: number) {
      wind.uTime.value = timeSeconds;
    },
    setFadeCenter() {
      // GPU ring LOD selection is resolved by compute; render materials do not dither LODs.
    },
    prepassNodesFor(prepassLod: TreeLod) {
      const material = debugColorByLod ? debugMaterials[prepassLod] : regularMaterial;
      return prepassNodes.get(material as MeshBasicNodeMaterial);
    },
    updateSettings(next: TreeSettings) {
      debugColorByLod = next.render.debugColorByLod;
      applyWindUniforms(wind, next);
      uSeed.value = next.seed;
      for (const material of materials) {
        material.alphaTest = 0;
        material.transparent = false;
        material.depthWrite = true;
        material.needsUpdate = true;
      }
    },
    updateLighting(next: EnvironmentLighting) {
      uLight.value.copy(next.sunDirection).normalize();
      uSun.value.copy(v3(next.sunColor));
      uSky.value.copy(v3(next.skyLight));
      uGround.value.copy(v3(next.groundLight));
    },
    updateForestLighting() {
      // Ring forest lighting is attached by tree_material_parity.
    },
    dispose() {
      for (const material of materials) material.dispose();
    },
  };
}

function treeRingHash(cell: TslNode, seed: TslNode, saltValue: number): TslNode {
  const salt = float(saltValue);
  return fract(
    sin(dot(cell.add(vec2(seed.add(salt), seed.mul(0.37).add(salt.mul(1.17)))), vec2(41.3, 289.1))).mul(43758.5453),
  );
}

function treeVariantPhase(worldXZ: TslNode, seed: TslNode): TslNode {
  return fract(
    sin(dot(
      worldXZ.add(vec2(seed.mul(0.013).add(TREE_VARIANT_HASH_SALT), seed.mul(0.037).sub(TREE_VARIANT_HASH_SALT))),
      vec2(127.1, 311.7),
    )).mul(43758.5453123),
  );
}

function treeVariantKeep(aVariant: TslNode, worldXZ: TslNode, seed: TslNode): TslNode {
  const phase = treeVariantPhase(worldXZ, seed);
  const v0 = phase.lessThan(0.25).and(aVariant.lessThan(0.5));
  const v1 = phase.greaterThanEqual(0.25).and(phase.lessThan(0.5))
    .and(aVariant.greaterThanEqual(0.5)).and(aVariant.lessThan(1.5));
  const v2 = phase.greaterThanEqual(0.5).and(phase.lessThan(0.75))
    .and(aVariant.greaterThanEqual(1.5)).and(aVariant.lessThan(2.5));
  const v3 = phase.greaterThanEqual(0.75)
    .and(aVariant.greaterThanEqual(2.5)).and(aVariant.lessThan(3.5));
  return v0.or(v1).or(v2).or(v3).select(float(1), float(0));
}

function applyWindUniforms(wind: TreeWindNodeUniforms, settings: TreeSettings): void {
  const direction = new THREE.Vector2(settings.wind.direction[0], settings.wind.direction[1]);
  if (direction.lengthSq() <= 1e-8) direction.set(1, 0);
  else direction.normalize();
  wind.uWindDir.value.copy(direction);
  const enabled = settings.wind.enabled ? 1 : 0;
  wind.uWindStrength.value = settings.wind.strength * enabled;
  wind.uWindSpeed.value = settings.wind.speed;
  wind.uGust.value = settings.wind.gustStrength * enabled;
  wind.uTrunkSway.value = settings.wind.trunkSwayStrength * enabled;
  wind.uLeafFlutter.value = settings.wind.leafFlutterStrength * enabled;
}
