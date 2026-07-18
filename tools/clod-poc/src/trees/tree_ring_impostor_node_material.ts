import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  floatBitsToUint,
  floor,
  frontFacing,
  max,
  mix,
  normalize,
  positionGeometry,
  sin,
  smoothstep,
  texture,
  uint,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { ForestLightingMaterialState } from "../forest_lighting/index.js";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import type { TreeLod, TreeSettings } from "./tree_config.js";
import { TREE_LODS } from "./tree_config.js";
import type { TreeImpostorAtlas } from "./tree_impostor_baker.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeHydrologyWater, TreeRingInstanceBuffers } from "./tree_node_material.js";
import { treeMorphologyHash01Node, treeMorphologyRecordNodes } from "./morphology/node_deformation.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;
type TreeRingNodeMaterial = MeshBasicNodeMaterial & {
  metalness?: number;
  roughness?: number;
  roughnessNode?: TslNode;
  metalnessNode?: TslNode;
  normalNode?: TslNode;
};

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
const TREE_RING_IMPOSTOR_MIN_COVERAGE = 0.0001;
const TREE_RING_IMPOSTOR_DEFAULT_AMBIENT_FLOOR = 0.025;
const TREE_RING_IMPOSTOR_HDR_MAX = 4.0;
const TREE_RING_IMPOSTOR_AERIAL_TINT_SCALE = 0.15;
const TREE_RING_IMPOSTOR_AERIAL_TINT_MAX = 0.04;
const TREE_RING_IMPOSTOR_SHAFT_HINT = 0.01;

function fallbackLighting(): EnvironmentLighting {
  return {
    sunDirection: new THREE.Vector3(0.4, 0.85, 0.3).normalize(),
    sunColor: new THREE.Color(2.4, 2.3, 2.1),
    skyLight: new THREE.Color(0.075, 0.085, 0.105),
    groundLight: new THREE.Color(0.015, 0.013, 0.01),
    ambientFloor: TREE_RING_IMPOSTOR_DEFAULT_AMBIENT_FLOOR,
  };
}

export function createTreeRingImpostorNodeMaterialHandle(
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  atlas: TreeImpostorAtlas,
  lighting: EnvironmentLighting = fallbackLighting(),
  hydrology?: TreeHydrologyWater,
): TreeMaterialHandle {
  const uLight = uniform(lighting.sunDirection.clone().normalize());
  const uSun = uniform(v3(lighting.sunColor));
  const uSky = uniform(v3(lighting.skyLight));
  const uGround = uniform(v3(lighting.groundLight));
  const uAmbientFloor = uniform(lighting.ambientFloor ?? TREE_RING_IMPOSTOR_DEFAULT_AMBIENT_FLOOR);
  const neutralForestTexture = new THREE.DataTexture(
    new Uint8Array([0, 0, 0, 0]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  neutralForestTexture.needsUpdate = true;
  const uForestEnabled = uniform(0);
  const uForestWorldSize = uniform(1);
  const uForestAoStrength = uniform(1);
  const uForestShadowStrength = uniform(1);
  const uForestFogStrength = uniform(0);
  const uForestFogColor = uniform(new THREE.Vector3(0.40, 0.45, 0.43));
  const forestMapNodes: TslNode[] = [];
  const materials: TreeRingNodeMaterial[] = [];
  const prepassNodes = new Map<TreeRingNodeMaterial, PrepassNodes>();

  const buildMaterial = (debugColor?: THREE.Color): TreeRingNodeMaterial => {
    const record = treeMorphologyRecordNodes(buffers);
    const aWorldXZ: TslNode = record.positionScale.xz;
    const aHeight: TslNode = record.positionScale.y;
    const aScale: TslNode = max(record.positionScale.w, float(0.001));
    const aYaw: TslNode = record.rotationNormalY.x;
    const aVariant: TslNode = clamp(record.rotationNormalY.z, 0, Math.max(0, (atlas.variantCount ?? 1) - 1));

    const c: TslNode = cos(aYaw);
    const s: TslNode = sin(aYaw);
    const billboardNormal: TslNode = treeRingCylindricalBillboardNormal(aWorldXZ);
    const billboardRight: TslNode = vec2(billboardNormal.z, billboardNormal.x.negate());
    const topWeight: TslNode = clamp(attribute("treeHeight01", "float"), 0, 1);
    const age: TslNode = clamp(record.morphology0.x, 0, 1);
    const health: TslNode = clamp(record.morphology0.w, 0, 1);
    const heightScale: TslNode = mix(0.72, 1.08, smoothstep(0, 1, age));
    const radiusScale: TslNode = mix(0.78, 1.12, age);
    const widthScale: TslNode = clamp(record.morphology1.z, 0.82, 1.18).mul(radiusScale);
    const flattening: TslNode = clamp(record.morphology1.w, 0.82, 1.2);
    const cYaw: TslNode = cos(aYaw);
    const sYaw: TslNode = sin(aYaw);
    const localOffset: TslNode = record.morphology0.yz.mul(topWeight)
      .add(record.morphology1.xy.mul(smoothstep(0.4, 1, topWeight)));
    const worldOffset: TslNode = vec2(
      cYaw.mul(localOffset.x).add(sYaw.mul(localOffset.y)),
      sYaw.mul(localOffset.x).negate().add(cYaw.mul(localOffset.y)),
    );
    const projectedOffset: TslNode = dot(worldOffset, billboardRight).mul(float(atlas.radius ?? 1));
    const impostorX: TslNode = positionGeometry.x.mul(widthScale).add(projectedOffset);
    const impostorY: TslNode = positionGeometry.y.mul(heightScale).mul(mix(1, flattening, topWeight));
    const impostorZ: TslNode = positionGeometry.z;
    const localPosition: TslNode = vec3(impostorX, impostorY, impostorZ).mul(aScale);
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
    const impostor = treeRingImpostorAgeSample(atlas, uv(), viewDirection, aVariant, age);
    const sampledAlbedo: TslNode = debugColor
      ? vec3(debugColor.r, debugColor.g, debugColor.b)
      : impostor.albedo;
    const albedo: TslNode = debugColor
      ? sampledAlbedo
      : mix(sampledAlbedo.mul(vec3(1.05, 0.78, 0.52)), sampledAlbedo, health);
    const normalNode: TslNode = atlas.normalDepth && !debugColor
      ? treeRingImpostorSurfaceNormal(impostor.normal, billboardNormal, c, s)
      : billboardNormal;
    const litBase: TslNode = atlas.normalDepth && !debugColor
      ? relightTreeRingImpostor(
          albedo,
          impostor.normal,
          billboardNormal,
          c,
          s,
          uLight,
          uSun,
          uSky,
          uGround,
          uAmbientFloor,
        )
      : albedo;

    const forestUv: TslNode = clamp(aWorldXZ.div(uForestWorldSize), vec2(0), vec2(1));
    const forestPacked: TslNode = texture(neutralForestTexture, forestUv);
    forestMapNodes.push(forestPacked);
    const forestDarken: TslNode = clamp(
      forestPacked.x.mul(uForestAoStrength).add(forestPacked.y.mul(uForestShadowStrength)),
      0,
      0.72,
    ).mul(uForestEnabled);
    const forestFog: TslNode = clamp(
      forestPacked.z.mul(uForestFogStrength).mul(uForestEnabled),
      0,
      TREE_RING_IMPOSTOR_AERIAL_TINT_MAX,
    );
    const lit: TslNode = debugColor
      ? litBase
      : mix(litBase.mul(float(1).sub(forestDarken)), uForestFogColor, forestFog)
        .add(vec3(forestPacked.w.mul(TREE_RING_IMPOSTOR_SHAFT_HINT).mul(uForestEnabled)));

    const retention: TslNode = clamp(record.morphology2.y.mul(mix(0.72, 1, health)), 0, 1);
    const retentionCell: TslNode = uint(floor(uv().x.mul(8))).add(uint(floor(uv().y.mul(8))).mul(8));
    const retentionNoise: TslNode = treeMorphologyHash01Node(
      floatBitsToUint(record.identityBits.zw),
      uint(0x1109).bitXor(retentionCell),
    );
    const alphaMask: TslNode = impostor.coverage
      .greaterThan(float(settings.impostors.alphaTest))
      .and(retentionNoise.lessThan(retention));
    const aboveWater: TslNode | null = treeAboveWaterKeep(hydrology, aWorldXZ);
    const mask: TslNode = aboveWater ? alphaMask.and(aboveWater) : alphaMask;

    const material = createTreeRingUnlitImpostorNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = lit;
    material.normalNode = normalNode;
    (material as unknown as { opacityNode: TslNode }).opacityNode = impostor.coverage;
    (material as unknown as { maskNode: TslNode }).maskNode = mask;
    material.alphaTest = 0;
    material.side = THREE.DoubleSide;
    material.transparent = false;
    material.depthWrite = true;
    materials.push(material);
    prepassNodes.set(material, { positionNode, maskNode: mask, side: material.side });
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
      // GPU ring LOD fading is attached by the shared crossfade decorator.
    },
    prepassNodesFor() {
      return prepassNodes.get(regularMaterial);
    },
    updateSettings(_next: TreeSettings) {
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
      uAmbientFloor.value = next.ambientFloor ?? TREE_RING_IMPOSTOR_DEFAULT_AMBIENT_FLOOR;
    },
    updateForestLighting(state: ForestLightingMaterialState | null) {
      if (!state) {
        uForestEnabled.value = 0;
        return;
      }
      const next = state.settings;
      uForestEnabled.value = next.enabled && next.materialIntegration.treeEnabled ? 1 : 0;
      uForestWorldSize.value = Math.max(1, state.worldCells);
      uForestAoStrength.value = next.ambientOcclusion.strength;
      uForestShadowStrength.value = next.shadowProxy.strength;
      uForestFogStrength.value = next.atmosphere.aerialTintStrength * TREE_RING_IMPOSTOR_AERIAL_TINT_SCALE;
      for (const mapNode of forestMapNodes) mapNode.value = state.textureHandle.texture;
    },
    dispose() {
      neutralForestTexture.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

function createTreeRingUnlitImpostorNodeMaterial(): TreeRingNodeMaterial {
  return new MeshBasicNodeMaterial() as TreeRingNodeMaterial;
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
  variantIndex: TslNode,
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
  const s00 = treeRingImpostorAtlasSample(atlas, baseUv, x0, y0, variantIndex);
  const s10 = treeRingImpostorAtlasSample(atlas, baseUv, x1, y0, variantIndex);
  const s01 = treeRingImpostorAtlasSample(atlas, baseUv, x0, y1, variantIndex);
  const s11 = treeRingImpostorAtlasSample(atlas, baseUv, x1, y1, variantIndex);
  const coverage: TslNode = s00.coverage.mul(w00)
    .add(s10.coverage.mul(w10))
    .add(s01.coverage.mul(w01))
    .add(s11.coverage.mul(w11));
  const safeCoverage: TslNode = max(coverage, float(TREE_RING_IMPOSTOR_MIN_COVERAGE));
  return {
    albedo: s00.albedo.mul(s00.coverage).mul(w00)
      .add(s10.albedo.mul(s10.coverage).mul(w10))
      .add(s01.albedo.mul(s01.coverage).mul(w01))
      .add(s11.albedo.mul(s11.coverage).mul(w11))
      .div(safeCoverage),
    coverage,
    normal: normalize(
      decodeTreeRingImpostorPackedNormal(s00.normal).mul(s00.coverage).mul(w00)
        .add(decodeTreeRingImpostorPackedNormal(s10.normal).mul(s10.coverage).mul(w10))
        .add(decodeTreeRingImpostorPackedNormal(s01.normal).mul(s01.coverage).mul(w01))
        .add(decodeTreeRingImpostorPackedNormal(s11.normal).mul(s11.coverage).mul(w11))
        .div(safeCoverage),
    ),
  };
}

function treeRingImpostorAgeSample(
  atlas: TreeImpostorAtlas,
  baseUv: TslNode,
  viewDirection: TslNode,
  variantIndex: TslNode,
  age: TslNode,
): { albedo: TslNode; coverage: TslNode; normal: TslNode } {
  const ageLayerCount = atlas.ageBuckets?.length ?? 0;
  if (ageLayerCount !== 3 || (atlas.layerCount ?? 0) < (atlas.variantCount ?? 1) * ageLayerCount) {
    return treeRingImpostorFourFrameSample(atlas, baseUv, viewDirection, variantIndex);
  }
  const young = age.lessThanEqual(float(0.20));
  const mature = age.lessThanEqual(float(0.60));
  const old = age.lessThan(float(0.92));
  const lowerBucket: TslNode = young.select(float(0), mature.select(float(0), old.select(float(1), float(2))));
  const upperBucket: TslNode = young.select(float(0), mature.select(float(1), old.select(float(2), float(2))));
  const layerBlend: TslNode = young.select(
    float(0),
    mature.select(
      clamp(age.sub(0.20).div(0.40), 0, 1),
      old.select(clamp(age.sub(0.60).div(0.32), 0, 1), float(0)),
    ),
  );
  const variantBase: TslNode = variantIndex.mul(ageLayerCount);
  const lower = treeRingImpostorFourFrameSample(atlas, baseUv, viewDirection, variantBase.add(lowerBucket));
  const upper = treeRingImpostorFourFrameSample(atlas, baseUv, viewDirection, variantBase.add(upperBucket));
  return {
    albedo: mix(lower.albedo, upper.albedo, layerBlend),
    coverage: mix(lower.coverage, upper.coverage, layerBlend),
    normal: normalize(mix(lower.normal, upper.normal, layerBlend)),
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
  variantIndex: TslNode,
): { albedo: TslNode; coverage: TslNode; normal: TslNode } {
  const atlasUv = treeRingImpostorAtlasUv(atlas, baseUv, frameX, frameY, variantIndex);
  const sample: TslNode = texture(atlas.albedo ?? atlas.texture, atlasUv);
  const encoded: TslNode = clamp(
    sample.xyz.div(max(sample.w, float(TREE_RING_IMPOSTOR_MIN_COVERAGE))),
    0.0,
    1.0,
  );
  const normalSample: TslNode = atlas.normalDepth
    ? texture(atlas.normalDepth, atlasUv).xyz
    : vec3(0.5, 1.0, 0.5);
  return {
    albedo: encoded.mul(encoded),
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
  variantIndex: TslNode,
): TslNode {
  const resolution = float(Math.max(1, Math.floor(atlas.resolutionPx)));
  const pageSize = float(Math.max(1, Math.floor(atlas.gridSize * atlas.resolutionPx)));
  const atlasWidth = float(Math.max(1, Math.floor(atlas.atlasWidthPx ?? atlas.gridSize * atlas.resolutionPx)));
  const atlasHeight = float(Math.max(1, Math.floor(atlas.atlasHeightPx ?? atlas.gridSize * atlas.resolutionPx)));
  const pageCount = float(Math.max(1, Math.floor(atlas.layerCount ?? atlas.variantCount ?? 1)));
  const safePage = clamp(variantIndex, 0, pageCount.sub(1));
  const yOffset = safePage.mul(pageSize);
  const padding = float(inferAtlasPaddingPx(atlas));
  const minUv = vec2(
    frameX.mul(resolution).add(padding).div(atlasWidth),
    yOffset.add(frameY.mul(resolution)).add(padding).div(atlasHeight),
  );
  const maxUv = vec2(
    frameX.add(1).mul(resolution).sub(padding).div(atlasWidth),
    yOffset.add(frameY.add(1).mul(resolution)).sub(padding).div(atlasHeight),
  );
  return minUv.add(baseUv.mul(maxUv.sub(minUv)));
}

function inferAtlasPaddingPx(atlas: TreeImpostorAtlas): number {
  const first = atlas.frames[0];
  if (!first) return 0;
  return Math.max(0, Math.round(first.uvMin[0] * Math.max(1, atlas.gridSize * atlas.resolutionPx)));
}

function treeRingImpostorSurfaceNormal(
  localNormal: TslNode,
  billboardNormal: TslNode,
  yawCos: TslNode,
  yawSin: TslNode,
): TslNode {
  const rotatedNormal: TslNode = normalize(vec3(
    localNormal.x.mul(yawCos).add(localNormal.z.mul(yawSin)),
    localNormal.y,
    localNormal.z.mul(yawCos).sub(localNormal.x.mul(yawSin)),
  ));
  return normalize((mix as any)(billboardNormal, rotatedNormal, float(TREE_RING_IMPOSTOR_NORMAL_DETAIL_WEIGHT)));
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
  uAmbientFloor: TslNode,
): TslNode {
  const n0: TslNode = treeRingImpostorSurfaceNormal(localNormal, billboardNormal, yawCos, yawSin);
  const n: TslNode = frontFacing.select(n0, n0.negate());
  const sun: TslNode = clamp(max(dot(n, uLight), 0.0), 0.0, TREE_RING_IMPOSTOR_SUN_MAX);
  const sky: TslNode = clamp(n.y.mul(0.5).add(0.5), 0.0, 1.0);
  const hemi: TslNode = mix(uGround, uSky, sky);
  const direct: TslNode = uSun.mul(sun);
  const back: TslNode = max(dot(n.negate(), uLight), 0.0);
  const transmission: TslNode = albedo.mul(uSun).mul(back).mul(TREE_RING_IMPOSTOR_LEAF_TRANSMISSION);
  const lit: TslNode = albedo.mul(hemi.add(direct).add(uAmbientFloor)).add(transmission);
  return clamp(lit, 0.0, TREE_RING_IMPOSTOR_HDR_MAX);
}

function treeAboveWaterKeep(hydrology: TreeHydrologyWater | undefined, worldXZ: TslNode): TslNode | null {
  if (!hydrology?.texture) return null;
  const wetUv: TslNode = worldXZ.div(float(hydrology.worldSize || 1));
  return texture(hydrology.texture, wetUv).y.lessThan(0.5);
}
