import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  attribute,
  abs,
  clamp,
  cos,
  dot,
  float,
  floatBitsToUint,
  fract,
  frontFacing,
  max,
  mix,
  normalize,
  sin,
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
import {
  treeFoliageCardKeep,
  type TreeHydrologyWater,
  type TreeRingInstanceBuffers,
} from "./tree_node_material.js";
import {
  treeMorphologyCrownStartNode,
  treeMorphologyDeformationNodes,
  treeMorphologyRecordNodes,
} from "./morphology/node_deformation.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

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
  _lod: TreeLod,
  lighting: EnvironmentLighting = fallbackLighting(),
  hydrology?: TreeHydrologyWater,
): TreeMaterialHandle {
  const uSeed = uniform(settings.seed);
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const materials: MeshBasicNodeMaterial[] = [];
  const prepassNodes = new Map<MeshBasicNodeMaterial, PrepassNodes>();
  let debugColorByLod = settings.render.debugColorByLod;

  const buildMaterial = (albedoFactory: (vertexColor: TslNode, tint: TslNode) => TslNode): MeshBasicNodeMaterial => {
    const aColor: TslNode = attribute("color", "vec3");
    const aFoliageMask: TslNode = attribute("treeFoliageMask", "float");
    const aFoliageCard: TslNode = attribute("treeFoliageCard", "float");
    const aBranchPhase: TslNode = attribute("treeBranchPhase", "float");
    const aVariant: TslNode = attribute("treeVariant", "float");
    const record = treeMorphologyRecordNodes(buffers);
    const worldXZ: TslNode = record.positionScale.xz;
    const height: TslNode = record.positionScale.y;
    const scale: TslNode = max(record.positionScale.w, float(0.001));
    const yaw: TslNode = record.rotationNormalY.x;
    const tint: TslNode = treeRingHash(worldXZ, uSeed, 1901);
    const variantKeep: TslNode = abs(aVariant.sub(record.rotationNormalY.z)).lessThan(0.5).select(float(1), float(0));
    const deformation = treeMorphologyDeformationNodes(
      record.morphology0,
      record.morphology1,
      record.morphology2,
      treeMorphologyCrownStartNode(settings),
    );
    const localPosition: TslNode = deformation.position.mul(scale).mul(variantKeep);
    const c: TslNode = cos(yaw);
    const s: TslNode = sin(yaw);
    const rotX: TslNode = c.mul(localPosition.x).add(s.mul(localPosition.z));
    const rotZ: TslNode = s.mul(localPosition.x).negate().add(c.mul(localPosition.z));
    const positionNode: TslNode = vec3(worldXZ.x.add(rotX), height.add(localPosition.y), worldXZ.y.add(rotZ));

    const healthyAlbedo: TslNode = albedoFactory(aColor, tint);
    const stressedTint: TslNode = mix(vec3(0.82, 0.76, 0.68), vec3(1.02, 0.72, 0.42), aFoliageMask);
    const albedo: TslNode = mix(healthyAlbedo.mul(stressedTint), healthyAlbedo, clamp(record.morphology0.w, 0, 1));
    const localNormal: TslNode = deformation.normal;
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
    const cardKeep: TslNode = treeFoliageCardKeep(
      aFoliageCard,
      deformation.foliageRetention,
      aBranchPhase,
      record.rotationNormalY.w,
      floatBitsToUint(record.identityBits.zw),
    );
    const aboveWater: TslNode | null = treeAboveWaterKeep(hydrology, worldXZ);
    const maskNode: TslNode = aboveWater ? cardKeep.and(aboveWater) : cardKeep;
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
    setFadeCenter() {
      // GPU ring LOD selection is resolved by compute; render materials do not dither LODs.
    },
    prepassNodesFor(prepassLod: TreeLod) {
      const material = debugColorByLod ? debugMaterials[prepassLod] : regularMaterial;
      return prepassNodes.get(material as MeshBasicNodeMaterial);
    },
    updateSettings(next: TreeSettings) {
      debugColorByLod = next.render.debugColorByLod;
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
