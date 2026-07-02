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
  screenCoordinate,
  sin,
  smoothstep,
  storage,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import type { TreeLod, TreeSettings } from "./tree_config.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeHydrologyWater, TreeRingInstanceBuffers } from "./tree_node_material.js";
import {
  TREE_RING_CELL_SIZE_M,
  TREE_RING_JITTER_X_SALT,
  TREE_RING_JITTER_Z_SALT,
  TREE_RING_YAW_SALT,
} from "./tree_ring_placement.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const TREE_VARIANT_HASH_SALT = 1103;
const FAR_LOD_COLORS: Record<TreeLod, THREE.Color> = {
  near: new THREE.Color(0x2e7d32),
  mid: new THREE.Color(0xd98032),
  far: new THREE.Color(0x3a6ea5),
  impostor: new THREE.Color(0x7755aa),
};

function v3(color: THREE.Color): THREE.Vector3 {
  return new THREE.Vector3(color.r, color.g, color.b);
}

function fallbackLighting(): EnvironmentLighting {
  return {
    sunDirection: new THREE.Vector3(0.4, 0.85, 0.3).normalize(),
    sunColor: new THREE.Color(1.0, 0.96, 0.88),
    skyLight: new THREE.Color(0x6b7a94),
    groundLight: new THREE.Color(0x2e2921),
  };
}

export function treeRingUsesFarMaterial(lod: TreeLod): boolean {
  return lod === "far" || lod === "impostor";
}

export function createTreeRingFarNodeMaterialHandle(
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  lod: TreeLod,
  lighting: EnvironmentLighting = fallbackLighting(),
  hydrology?: TreeHydrologyWater,
): TreeMaterialHandle {
  const uFadeCenter = uniform(new THREE.Vector2());
  const uNearDistance = uniform(settings.distanceM * settings.lod.nearFraction);
  const uMidDistance = uniform(settings.distanceM * settings.lod.midFraction);
  const uFarDistance = uniform(settings.distanceM * settings.lod.farFraction);
  const uBandDistance = uniform(settings.lod.crossfadeEnabled ? settings.lod.crossfadeBandM : 0);
  const uCellSize = uniform(TREE_RING_CELL_SIZE_M);
  const uSeed = uniform(settings.seed);
  const uLodIndex = uniform(treeLodIndex(lod));
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const materials: MeshBasicNodeMaterial[] = [];
  const prepassNodes = new Map<MeshBasicNodeMaterial, PrepassNodes>();

  const buildMaterial = (albedoFactory: (vertexColor: TslNode, tint: TslNode) => TslNode): MeshBasicNodeMaterial => {
    const aColor: TslNode = attribute("color", "vec3");
    const aVariant: TslNode = attribute("treeVariant", "float");
    const cellStore: TslNode = storage(buffers.cell, "vec4", buffers.capacity).toReadOnly();
    const aCell: TslNode = cellStore.element(instanceIndex);
    const worldCell: TslNode = aCell.xy;
    const jitter: TslNode = vec2(
      treeRingHash(worldCell, uSeed, TREE_RING_JITTER_X_SALT),
      treeRingHash(worldCell, uSeed, TREE_RING_JITTER_Z_SALT),
    );
    const worldXZ: TslNode = worldCell.add(jitter).mul(uCellSize);
    const height: TslNode = aCell.z;
    const scale: TslNode = max(aCell.w, float(0.001));
    const yaw: TslNode = treeRingHash(worldCell, uSeed, TREE_RING_YAW_SALT).mul(6.28318530718);
    const tint: TslNode = treeRingHash(worldCell, uSeed, 1901);
    const variantKeep: TslNode = treeVariantKeep(aVariant, worldXZ, uSeed);
    const localPosition: TslNode = positionGeometry.mul(scale).mul(variantKeep);
    const c: TslNode = cos(yaw);
    const s: TslNode = sin(yaw);
    const rotX: TslNode = c.mul(localPosition.x).add(s.mul(localPosition.z));
    const rotZ: TslNode = s.mul(localPosition.x).negate().add(c.mul(localPosition.z));
    const positionNode: TslNode = vec3(worldXZ.x.add(rotX), height.add(localPosition.y), worldXZ.y.add(rotZ));

    const albedo: TslNode = albedoFactory(aColor, tint);
    const localNormal: TslNode = normalize(normalGeometry);
    const rotatedNormal: TslNode = normalize(
      vec3(c.mul(localNormal.x).add(s.mul(localNormal.z)), localNormal.y, s.mul(localNormal.x).negate().add(c.mul(localNormal.z))),
    );
    const n: TslNode = frontFacing.select(rotatedNormal, rotatedNormal.negate());
    const sun: TslNode = max(dot(n, uLight), 0.0);
    const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
    const lit: TslNode = albedo.mul(mix(uGround, uSky, sky).mul(0.85).add(uSun.mul(sun).mul(0.55)).add(0.2));

    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = lit;
    const lodMask: TslNode = treeRingLodMask(
      uLodIndex,
      worldXZ.sub(uFadeCenter).length(),
      uNearDistance,
      uMidDistance,
      uFarDistance,
      uBandDistance,
    );
    const aboveWater: TslNode | null = treeAboveWaterKeep(hydrology, worldXZ);
    const maskNode: TslNode = aboveWater ? lodMask.and(aboveWater) : lodMask;
    (material as unknown as { maskNode: TslNode }).maskNode = maskNode;
    material.alphaTest = 0;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    materials.push(material);
    prepassNodes.set(material, { positionNode, maskNode, side: material.side });
    return material;
  };

  const regularMaterial = buildMaterial((vertexColor, tint) =>
    vertexColor.mul(mix(vec3(0.9, 0.96, 0.86), vec3(1.05, 1.0, 0.88), tint)),
  );
  const debugMaterials = {} as Record<TreeLod, THREE.Material>;
  for (const debugLod of ["near", "mid", "far", "impostor"] as const) {
    const color = FAR_LOD_COLORS[debugLod];
    debugMaterials[debugLod] = buildMaterial(() => vec3(color.r, color.g, color.b));
  }

  return {
    regularMaterial,
    debugMaterials,
    setTime() {
      // Far ring material is intentionally static to avoid per-vertex wind cost.
    },
    setFadeCenter(x: number, z: number) {
      uFadeCenter.value.set(x, z);
    },
    prepassNodesFor(prepassLod: TreeLod) {
      const material = settings.render.debugColorByLod ? debugMaterials[prepassLod] : regularMaterial;
      return prepassNodes.get(material as MeshBasicNodeMaterial);
    },
    updateSettings(next: TreeSettings) {
      uNearDistance.value = next.distanceM * next.lod.nearFraction;
      uMidDistance.value = next.distanceM * next.lod.midFraction;
      uFarDistance.value = next.distanceM * next.lod.farFraction;
      uBandDistance.value = next.lod.crossfadeEnabled ? next.lod.crossfadeBandM : 0;
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
    updateForestLighting(_state: ForestLightingMaterialState | null) {
      // Far trees keep only direct + hemispheric lighting; near/mid own forest effects.
    },
    dispose() {
      for (const material of materials) material.dispose();
    },
  };
}

function treeLodIndex(lod: TreeLod): number {
  if (lod === "near") return 0;
  if (lod === "mid") return 1;
  if (lod === "far") return 2;
  return 3;
}

function treeAboveWaterKeep(hydrology: TreeHydrologyWater | undefined, worldXZ: TslNode): TslNode | null {
  if (!hydrology?.texture) return null;
  const wetUv: TslNode = worldXZ.div(float(hydrology.worldSize || 1));
  return texture(hydrology.texture, wetUv).y.lessThan(0.5);
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

function treeRingLodMask(
  lodIndex: TslNode,
  dist: TslNode,
  nearDistance: TslNode,
  midDistance: TslNode,
  farDistance: TslNode,
  bandDistance: TslNode,
): TslNode {
  const ign: TslNode = fract(
    fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189),
  );
  const noBand = bandDistance.lessThan(0.0001);
  const fadeIn = (distance: TslNode): TslNode => smoothstep(distance.sub(bandDistance), distance.add(bandDistance), dist);
  const fadeOut = (distance: TslNode): TslNode => float(1).sub(fadeIn(distance));
  const passIn = (fade: TslNode): TslNode => ign.greaterThanEqual(float(1).sub(fade));
  const passOut = (fade: TslNode): TslNode => ign.lessThan(fade);
  const nearPass = lodIndex.lessThan(0.5).and(noBand.or(passOut(fadeOut(nearDistance))));
  const midPass = lodIndex.greaterThanEqual(0.5).and(lodIndex.lessThan(1.5))
    .and(noBand.or(passIn(fadeIn(nearDistance)).and(passOut(fadeOut(midDistance)))));
  const farPass = lodIndex.greaterThanEqual(1.5).and(lodIndex.lessThan(2.5))
    .and(noBand.or(passIn(fadeIn(midDistance)).and(passOut(fadeOut(farDistance)))));
  const impostorPass = lodIndex.greaterThanEqual(2.5).and(noBand.or(passIn(fadeIn(farDistance))));
  return nearPass.or(midPass).or(farPass).or(impostorPass);
}
