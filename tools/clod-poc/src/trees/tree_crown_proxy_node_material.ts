import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  clamp,
  dot,
  float,
  fract,
  instanceIndex,
  max,
  positionGeometry,
  screenCoordinate,
  sin,
  smoothstep,
  storage,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { TREE_LODS, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { treeCrownProxyDimensions } from "./tree_crown_proxy_math.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeRingInstanceBuffers } from "./tree_node_material.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

const TREE_RING_CELL = 3.4;
const DEBUG_COLOR = new THREE.Color(0x2f7d32);

export function createTreeCrownProxyNodeMaterialHandle(
  settings: TreeSettings,
  buffers: TreeRingInstanceBuffers,
  species: TreeSpeciesId,
  lod: Extract<TreeLod, "far" | "impostor">,
): TreeMaterialHandle {
  const dims = treeCrownProxyDimensions(settings, species);
  const uRadius = uniform(new THREE.Vector3(dims.radiusX, dims.height * 0.5, dims.radiusZ));
  const uCenterY = uniform(dims.centerY);
  const uDensity = uniform(dims.density);
  const uFadeCenter = uniform(new THREE.Vector2());
  const uFarDistance = uniform(settings.distanceM * settings.lod.farFraction);
  const uImpostorDistance = uniform(settings.distanceM * settings.lod.impostorFraction);
  const uBandDistance = uniform(settings.lod.crossfadeEnabled ? settings.lod.crossfadeBandM : 0);
  const uCellSize = uniform(TREE_RING_CELL);
  const uSeed = uniform(settings.seed);
  const uLodIndex = uniform(TREE_LODS.indexOf(lod));
  const regularMaterial = buildMaterial(
    buffers,
    uRadius,
    uCenterY,
    uDensity,
    uFadeCenter,
    uFarDistance,
    uImpostorDistance,
    uBandDistance,
    uCellSize,
    uSeed,
    uLodIndex,
    false,
  );
  const debugMaterial = buildMaterial(
    buffers,
    uRadius,
    uCenterY,
    uDensity,
    uFadeCenter,
    uFarDistance,
    uImpostorDistance,
    uBandDistance,
    uCellSize,
    uSeed,
    uLodIndex,
    true,
  );

  return {
    regularMaterial,
    debugMaterials: { near: debugMaterial, mid: debugMaterial, far: debugMaterial, impostor: debugMaterial },
    setTime() {},
    setFadeCenter(x: number, z: number) {
      uFadeCenter.value.set(x, z);
    },
    updateSettings(next: TreeSettings) {
      const nextDims = treeCrownProxyDimensions(next, species);
      uRadius.value.set(nextDims.radiusX, nextDims.height * 0.5, nextDims.radiusZ);
      uCenterY.value = nextDims.centerY;
      uDensity.value = nextDims.density;
      uFarDistance.value = next.distanceM * next.lod.farFraction;
      uImpostorDistance.value = next.distanceM * next.lod.impostorFraction;
      uBandDistance.value = next.lod.crossfadeEnabled ? next.lod.crossfadeBandM : 0;
      uSeed.value = next.seed;
    },
    dispose() {
      regularMaterial.dispose();
      debugMaterial.dispose();
    },
  } as TreeMaterialHandle;
}

function buildMaterial(
  buffers: TreeRingInstanceBuffers,
  uRadius: TslNode,
  uCenterY: TslNode,
  uDensity: TslNode,
  uFadeCenter: TslNode,
  uFarDistance: TslNode,
  uImpostorDistance: TslNode,
  uBandDistance: TslNode,
  uCellSize: TslNode,
  uSeed: TslNode,
  uLodIndex: TslNode,
  debug: boolean,
): MeshBasicNodeMaterial {
  const cellStore: TslNode = storage(buffers.cell, "vec4", buffers.capacity).toReadOnly();
  const aCell: TslNode = cellStore.element(instanceIndex);
  const worldCell: TslNode = aCell.xy;
  const jitter: TslNode = vec2(proxyHash(worldCell, uSeed, 1103), proxyHash(worldCell, uSeed, 1200));
  const worldXZ: TslNode = worldCell.add(jitter).mul(uCellSize);
  const treeScale: TslNode = max(aCell.w, float(0.001));
  const radius: TslNode = uRadius.mul(treeScale);
  const centerY: TslNode = aCell.z.add(uCenterY.mul(treeScale));
  const local: TslNode = positionGeometry;
  const positionNode: TslNode = vec3(
    worldXZ.x.add(local.x.mul(radius.x)),
    centerY.add(local.y.mul(radius.y)),
    worldXZ.y.add(local.z.mul(radius.z)),
  );
  const radial: TslNode = clamp(dot(local, local), 0.0, 1.0);
  const edge: TslNode = float(1).sub(smoothstep(float(0.70), float(1.0), radial));
  const distanceM: TslNode = worldXZ.sub(uFadeCenter).length();
  const fade: TslNode = proxyFade(distanceM, uFarDistance, uImpostorDistance, uBandDistance, uLodIndex);
  const noise: TslNode = proxyScreenHash(screenCoordinate.xy, worldCell, uSeed);
  const keep: TslNode = noise.lessThan(clamp(edge.mul(uDensity).mul(fade), 0.0, 1.0));
  const material = new MeshBasicNodeMaterial();
  material.positionNode = positionNode;
  material.colorNode = debug ? vec3(DEBUG_COLOR.r, DEBUG_COLOR.g, DEBUG_COLOR.b) : vec3(0, 0, 0);
  (material as unknown as { maskNode: TslNode }).maskNode = keep;
  material.alphaTest = 0;
  material.depthWrite = true;
  material.colorWrite = false;
  material.side = THREE.DoubleSide;
  material.transparent = false;
  return material;
}

function proxyFade(distanceM: TslNode, farDistance: TslNode, impostorDistance: TslNode, bandDistance: TslNode, lodIndex: TslNode): TslNode {
  const band: TslNode = max(bandDistance, float(0));
  const start: TslNode = max(farDistance, impostorDistance.sub(band));
  const fadeWithBand: TslNode = float(1).sub(smoothstep(start, impostorDistance, distanceM));
  const hardFade: TslNode = distanceM.lessThanEqual(impostorDistance).select(float(1), float(0));
  const fade: TslNode = band.lessThanEqual(float(0.001)).select(hardFade, fadeWithBand);
  return lodIndex.greaterThanEqual(float(TREE_LODS.indexOf("impostor") - 0.5)).select(fade, float(1));
}

function proxyHash(worldCell: TslNode, seed: TslNode, salt: number): TslNode {
  return fract(sin(dot(worldCell.add(vec2(seed.add(float(salt)), seed.mul(0.37).add(float(salt * 1.17)))), vec2(41.3, 289.1))).mul(43758.5453));
}

function proxyScreenHash(screenXY: TslNode, worldCell: TslNode, seed: TslNode): TslNode {
  return fract(sin(dot(screenXY.add(worldCell.mul(0.017)).add(vec2(seed.mul(0.013), seed.mul(0.021))), vec2(12.9898, 78.233))).mul(43758.5453));
}
