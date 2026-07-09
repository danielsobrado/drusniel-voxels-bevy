import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  frontFacing,
  instanceIndex,
  max,
  mix,
  normalize,
  positionGeometry,
  sin,
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
import {
  TREE_RING_CELL_SIZE_M,
  TREE_RING_JITTER_X_SALT,
  TREE_RING_JITTER_Z_SALT,
  TREE_RING_YAW_SALT,
} from "./tree_ring_placement.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const LOD_COLORS: Record<TreeLod, THREE.Color> = {
  near: new THREE.Color(0x2e7d32),
  mid: new THREE.Color(0xd98032),
  far: new THREE.Color(0x3a6ea5),
  impostor: new THREE.Color(0x7755aa),
};

const v3 = (c: THREE.Color): THREE.Vector3 => new THREE.Vector3(c.r, c.g, c.b);
const TREE_RING_IMPOSTOR_LEAF_TRANSMISSION = 0.22;
const TREE_RING_IMPOSTOR_NORMAL_DETAIL_WEIGHT = 0.65;
const TREE_RING_IMPOSTOR_SUN_MAX = 0.85;

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
  const uCellSize = uniform(TREE_RING_CELL_SIZE_M);
  const uSeed = uniform(settings.seed);
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const materials: MeshBasicNodeMaterial[] = [];

  const buildMaterial = (debugColor?: THREE.Color): MeshBasicNodeMaterial => {
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

    const c: TslNode = cos(aYaw);
    const s: TslNode = sin(aYaw);
    const localPosition: TslNode = positionGeometry.mul(aScale);
    const billboardNormal: TslNode = treeRingCylindricalBillboardNormal(aWorldXZ);
    const positionNode: TslNode = treeRingCylindricalBillboardPosition(aWorldXZ, aHeight, localPosition, billboardNormal);

    const dirWorld: TslNode = normalize(vec3(
      cameraPosition.x.sub(aWorldXZ.x),
      cameraPosition.y.sub(aHeight.add(float(atlas.centerY ?? 0).mul(aScale))),
      cameraPosition.z.sub(aWorldXZ.y),
    ));
    const viewDirection: TslNode = normalize(vec3(
      dirWorld.x.mul(c).sub(dirWorld.z.mul(s)),
      dirWorld.y,
      dirWorld.x.mul(s).add(dirWorld.z.mul(c)),
    ));
    const impostor = treeRingImpostorFourFrameSample(atlas, uv(), viewDirection);
    const albedo: TslNode = debugColor
      ? vec3(debugColor.r, debugColor.g, debugColor.b)
      : impostor.albedo;
    const lit: TslNode = atlas.normalDepth && !debugColor
      ? relightTreeRingImpostor(albedo, impostor.normal, billboardNormal, c, s, uLight, uSun, uSky, uGround)
      : albedo;

    const alphaMask: TslNode = impostor.coverage.greaterThan(float(settings.impostors.alphaTest));
    const aboveWater: TslNode | null = treeAboveWaterKeep(hydrology, aWorldXZ);
    const mask: TslNode = aboveWater ? alphaMask.and(aboveWater) : alphaMask;

    const material = new MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = lit;
    (material as unknown as { opacityNode: TslNode }).opacityNode = impostor.coverage;
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
    setFadeCenter() {
      // GPU ring LOD selection is resolved by compute; render materials do not dither LODs.
    },
    updateSettings(next: TreeSettings) {
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

function treeRingCylindricalBillboardNormal(worldXZ: TslNode): TslNode {
  const toCamera: TslNode = vec3(
    cameraPosition.x.sub(worldXZ.x),
    float(0),
    cameraPosition.z.sub(worldXZ.y),
  );
  return dot(toCamera, toCamera)
    .greaterThan(float(0.000001))
    .select(normalize(toCamera), vec3(0, 0, 1));
}

function treeRingCylindricalBillboardPosition(
  worldXZ: TslNode,
  groundY: TslNode,
  localPosition: TslNode,
  billboardNormal: TslNode,
): TslNode {
  const right: TslNode = vec3(billboardNormal.z, float(0), billboardNormal.x.negate());
  return vec3(worldXZ.x, groundY, worldXZ.y)
    .add(right.mul(localPosition.x))
    .add(vec3(0, localPosition.y, 0));
}

function treeRingImpostorFourFrameSample(
  atlas: TreeImpostorAtlas,
  baseUv: TslNode,
  viewDirection: TslNode,
): { albedo: TslNode; coverage: TslNode; normal: TslNode } {
  const encoded: TslNode = treeRingOctEncode(viewDirection);
  const grid = float(Math.max(1, Math.floor(atlas.gridSize)));
  const gridMax = grid.sub(1);
  const scaled: TslNode = encoded.mul(grid).sub(0.5);
  const cell0: TslNode = floor(scaled);
  const fraction: TslNode = clamp(scaled.sub(cell0), vec2(0), vec2(1));
  const x0: TslNode = clamp(cell0.x, 0, gridMax);
  const y0: TslNode = clamp(cell0.y, 0, gridMax);
  const x1: TslNode = clamp(cell0.x.add(1), 0, gridMax);
  const y1: TslNode = clamp(cell0.y.add(1), 0, gridMax);
  const one = float(1);
  const w00: TslNode = one.sub(fraction.x).mul(one.sub(fraction.y));
  const w10: TslNode = fraction.x.mul(one.sub(fraction.y));
  const w01: TslNode = one.sub(fraction.x).mul(fraction.y);
  const w11: TslNode = fraction.x.mul(fraction.y);
  const s00 = treeRingImpostorAtlasSample(atlas, baseUv, x0, y0);
  const s10 = treeRingImpostorAtlasSample(atlas, baseUv, x1, y0);
  const s01 = treeRingImpostorAtlasSample(atlas, baseUv, x0, y1);
  const s11 = treeRingImpostorAtlasSample(atlas, baseUv, x1, y1);
  return {
    albedo: s00.albedo.mul(w00).add(s10.albedo.mul(w10)).add(s01.albedo.mul(w01)).add(s11.albedo.mul(w11)),
    coverage: s00.coverage.mul(w00).add(s10.coverage.mul(w10)).add(s01.coverage.mul(w01)).add(s11.coverage.mul(w11)),
    normal: normalize(
      decodeTreeRingImpostorPackedNormal(s00.normal).mul(w00)
        .add(decodeTreeRingImpostorPackedNormal(s10.normal).mul(w10))
        .add(decodeTreeRingImpostorPackedNormal(s01.normal).mul(w01))
        .add(decodeTreeRingImpostorPackedNormal(s11.normal).mul(w11)),
    ),
  };
}

function treeRingOctEncode(direction: TslNode): TslNode {
  const l1: TslNode = max(abs(direction.x).add(abs(direction.y)).add(abs(direction.z)), float(0.0001));
  const projected: TslNode = direction.xy.div(l1);
  const signX: TslNode = direction.x.greaterThanEqual(float(0)).select(float(1), float(-1));
  const signY: TslNode = direction.y.greaterThanEqual(float(0)).select(float(1), float(-1));
  const folded: TslNode = vec2(
    float(1).sub(abs(projected.y)).mul(signX) as any,
    float(1).sub(abs(projected.x)).mul(signY) as any,
  );
  return direction.z.lessThan(float(0)).select(folded, projected).mul(0.5).add(0.5);
}

function treeRingImpostorAtlasSample(
  atlas: TreeImpostorAtlas,
  baseUv: TslNode,
  frameX: TslNode,
  frameY: TslNode,
): { albedo: TslNode; coverage: TslNode; normal: TslNode } {
  const atlasUv = treeRingImpostorAtlasUv(atlas, baseUv, frameX, frameY);
  const sample: TslNode = texture(atlas.albedo ?? atlas.texture, atlasUv);
  const normalSample: TslNode = atlas.normalDepth ? texture(atlas.normalDepth, atlasUv).xyz : vec3(0.5, 1.0, 0.5);
  return {
    albedo: sample.xyz.mul(sample.xyz),
    coverage: sample.w,
    normal: normalSample,
  };
}

function decodeTreeRingImpostorPackedNormal(packedNormal: TslNode): TslNode {
  return packedNormal.mul(2).sub(1);
}

function treeRingImpostorAtlasUv(
  atlas: TreeImpostorAtlas,
  baseUv: TslNode,
  frameX: TslNode,
  frameY: TslNode,
): TslNode {
  const resolution = float(Math.max(1, Math.floor(atlas.resolutionPx)));
  const atlasSize = float(Math.max(1, Math.floor(atlas.gridSize * atlas.resolutionPx)));
  const padding = float(inferAtlasPaddingPx(atlas));
  const minUv = vec2(
    frameX.mul(resolution).add(padding).div(atlasSize),
    frameY.mul(resolution).add(padding).div(atlasSize),
  );
  const maxUv = vec2(
    frameX.add(1).mul(resolution).sub(padding).div(atlasSize),
    frameY.add(1).mul(resolution).sub(padding).div(atlasSize),
  );
  return minUv.add(baseUv.mul(maxUv.sub(minUv)));
}

function inferAtlasPaddingPx(atlas: TreeImpostorAtlas): number {
  const first = atlas.frames[0];
  if (!first) return 0;
  return Math.max(0, Math.round(first.uvMin[0] * Math.max(1, atlas.gridSize * atlas.resolutionPx)));
}

function relightTreeRingImpostor(
  albedo: TslNode,
  localNormal: TslNode,
  billboardNormal: TslNode,
  yawCos: TslNode,
  yawSin: TslNode,
  uLight: TslNode,
  uSun: TslNode,
  uSky: TslNode,
  uGround: TslNode,
): TslNode {
  const rotatedNormal: TslNode = normalize(vec3(
    localNormal.x.mul(yawCos).add(localNormal.z.mul(yawSin)),
    localNormal.y,
    localNormal.z.mul(yawCos).sub(localNormal.x.mul(yawSin)),
  ));
  const n0: TslNode = normalize((mix as any)(billboardNormal, rotatedNormal, float(TREE_RING_IMPOSTOR_NORMAL_DETAIL_WEIGHT)));
  const n: TslNode = frontFacing.select(n0, n0.negate());
  const sun: TslNode = clamp(max(dot(n, uLight), 0.0), 0.0, TREE_RING_IMPOSTOR_SUN_MAX);
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi: TslNode = mix(uGround, uSky, sky);
  const direct: TslNode = uSun.mul(sun);
  const back: TslNode = max(dot(n.negate(), uLight), 0.0);
  const transmission: TslNode = albedo.mul(uSun).mul(back).mul(TREE_RING_IMPOSTOR_LEAF_TRANSMISSION);
  const lit: TslNode = albedo.mul(0.25).add(albedo.mul(hemi.add(direct))).add(transmission);
  return clamp(lit, 0.0, 1.0);
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
