import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  clamp,
  cos,
  dot,
  float,
  fract,
  frontFacing,
  instanceIndex,
  max,
  mix,
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
import type { TreeLod, TreeSettings } from "./tree_config.js";
import { TREE_LODS } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeHydrologyWater, TreeRingInstanceBuffers } from "./tree_node_material.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const LOD_COLORS: Record<TreeLod, THREE.Color> = {
  near: new THREE.Color(0x2e7d32),
  mid: new THREE.Color(0xd98032),
  far: new THREE.Color(0x3a6ea5),
  impostor: new THREE.Color(0x7755aa),
};

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);

function fallbackLighting(): EnvironmentLighting {
  return {
    sunDirection: new THREE.Vector3(0.4, 0.85, 0.3).normalize(),
    sunColor: new THREE.Color(1.0, 0.96, 0.88),
    skyLight: new THREE.Color(0x6b7a94),
    groundLight: new THREE.Color(0x2e2921),
  };
}

export function createTreeRingImpostorNodeMaterialHandle(
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  atlas: TreeImpostorAtlas,
  lighting: EnvironmentLighting = fallbackLighting(),
  hydrology?: TreeHydrologyWater,
): TreeMaterialHandle {
  const uFadeCenter = uniform(new THREE.Vector2());
  const uNearDistance = uniform(settings.distanceM * settings.lod.nearFraction);
  const uMidDistance = uniform(settings.distanceM * settings.lod.midFraction);
  const uFarDistance = uniform(settings.distanceM * settings.lod.farFraction);
  const uBandDistance = uniform(settings.lod.crossfadeEnabled ? settings.lod.crossfadeBandM : 0);
  const uCellSize = uniform(3.4);
  const uSeed = uniform(settings.seed);
  const uLodIndex = uniform(TREE_LODS.indexOf("impostor"));
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const materials: MeshBasicNodeMaterial[] = [];

  const buildMaterial = (debugColor?: THREE.Color): MeshBasicNodeMaterial => {
    const cellStore: TslNode = storage(buffers.cell, "vec4", buffers.capacity).toReadOnly();
    const aCell: TslNode = cellStore.element(instanceIndex);
    const worldCell: TslNode = aCell.xy;
    const jitter: TslNode = vec2(treeRingHash(worldCell, uSeed, 1103), treeRingHash(worldCell, uSeed, 1200));
    const aWorldXZ: TslNode = worldCell.add(jitter).mul(uCellSize);
    const aHeight: TslNode = aCell.z;
    const aScale: TslNode = max(aCell.w, float(0.001));
    const aYaw: TslNode = treeRingHash(worldCell, uSeed, 701).mul(6.28318530718);

    const c: TslNode = cos(aYaw);
    const s: TslNode = sin(aYaw);
    const localPosition: TslNode = positionGeometry.mul(aScale);
    const rotX: TslNode = c.mul(localPosition.x).add(s.mul(localPosition.z));
    const rotZ: TslNode = s.mul(localPosition.x).negate().add(c.mul(localPosition.z));
    const positionNode: TslNode = vec3(aWorldXZ.x.add(rotX), aHeight.add(localPosition.y), aWorldXZ.y.add(rotZ));

    const albedoSample: TslNode = texture(atlas.albedo ?? atlas.texture, uv());
    const coverage: TslNode = albedoSample.w;
    const albedo: TslNode = debugColor
      ? vec3(debugColor.r, debugColor.g, debugColor.b)
      : albedoSample.xyz.mul(albedoSample.xyz);
    const lit: TslNode = atlas.normalDepth && !debugColor
      ? relightTreeRingImpostor(albedo, texture(atlas.normalDepth, uv()).xyz, uLight, uSun, uSky, uGround)
      : albedo;

    const lodMask: TslNode = treeRingLodMask(
      uLodIndex,
      aWorldXZ.sub(uFadeCenter).length(),
      uNearDistance,
      uMidDistance,
      uFarDistance,
      uBandDistance,
    );
    const alphaMask: TslNode = coverage.greaterThan(float(settings.impostors.alphaTest));
    const aboveWater: TslNode | null = treeAboveWaterKeep(hydrology, aWorldXZ);
    const mask: TslNode = aboveWater ? lodMask.and(alphaMask).and(aboveWater) : lodMask.and(alphaMask);

    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = lit;
    (material as unknown as { opacityNode: TslNode }).opacityNode = coverage;
    (material as unknown as { maskNode: TslNode }).maskNode = mask;
    material.alphaTest = 0;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    materials.push(material);
    return material;
  };

  const regularMaterial = buildMaterial();
  const debugMaterials = {} as Record<TreeLod, THREE.Material>;
  for (const lod of TREE_LODS) debugMaterials[lod] = buildMaterial(LOD_COLORS[lod]);

  return {
    regularMaterial,
    debugMaterials,
    setTime() {},
    setFadeCenter(x: number, z: number) {
      uFadeCenter.value.set(x, z);
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
    updateForestLighting() {},
    dispose() {
      for (const material of materials) material.dispose();
    },
  };
}

function relightTreeRingImpostor(
  albedo: TslNode,
  packedNormal: TslNode,
  uLight: TslNode,
  uSun: TslNode,
  uSky: TslNode,
  uGround: TslNode,
): TslNode {
  const n0: TslNode = normalize(packedNormal.mul(2).sub(1));
  const n: TslNode = frontFacing.select(n0, n0.negate());
  const sun: TslNode = max(dot(n, uLight), 0.0);
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi: TslNode = mix(uGround, uSky, sky);
  return albedo.mul(0.25).add(albedo.mul(hemi.add(uSun.mul(sun))));
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
  const passIn = (fade: TslNode): TslNode => ign.greaterThanEqual(float(1).sub(fade));
  const impostorPass = lodIndex.greaterThanEqual(2.5).and(noBand.or(passIn(fadeIn(farDistance))));
  return impostorPass;
}
