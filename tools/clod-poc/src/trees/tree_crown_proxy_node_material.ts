import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  clamp,
  cos,
  dot,
  float,
  floatBitsToUint,
  floor,
  max,
  mix,
  positionGeometry,
  sin,
  smoothstep,
  uint,
  uniform,
  vec2,
  vec3,
} from "three/tsl";
import { TREE_LODS, type TreeLod, type TreeSettings, type TreeSpeciesId } from "./tree_config.js";
import { treeCrownProxyDimensions } from "./tree_crown_proxy_math.js";
import type { TreeMaterialHandle } from "./tree_material.js";
import type { TreeRingInstanceBuffers } from "./tree_node_material.js";
import { treeMorphologyHash01Node, treeMorphologyRecordNodes } from "./morphology/node_deformation.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

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
  const uImpostorDistance = uniform(settings.lod.impostorEndM);
  const uBandDistance = uniform(settings.lod.crossfadeEnabled ? settings.lod.crossfadeBandM : 0);
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
      uImpostorDistance.value = next.lod.impostorEndM;
      uBandDistance.value = next.lod.crossfadeEnabled ? next.lod.crossfadeBandM : 0;
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
  uLodIndex: TslNode,
  debug: boolean,
): MeshBasicNodeMaterial {
  const record = treeMorphologyRecordNodes(buffers);
  const baseWorldXZ: TslNode = record.positionScale.xz;
  const treeScale: TslNode = max(record.positionScale.w, float(0.001));
  const ageHeightScale: TslNode = mix(0.72, 1.08, smoothstep(0, 1, clamp(record.morphology0.x, 0, 1)));
  const crownWidth: TslNode = clamp(record.morphology1.z, 0.82, 1.18);
  const crownFlattening: TslNode = clamp(record.morphology1.w, 0.82, 1.2);
  const radius: TslNode = vec3(
    uRadius.x.mul(crownWidth),
    uRadius.y.mul(crownFlattening).mul(ageHeightScale),
    uRadius.z.mul(crownWidth),
  ).mul(treeScale);
  const yaw: TslNode = record.rotationNormalY.x;
  const c: TslNode = cos(yaw);
  const s: TslNode = sin(yaw);
  const localCrownOffset: TslNode = record.morphology1.xy.mul(uRadius.x)
    .add(record.morphology0.yz.mul(uCenterY).mul(0.49));
  const worldCrownOffset: TslNode = vec2(
    c.mul(localCrownOffset.x).add(s.mul(localCrownOffset.y)),
    s.mul(localCrownOffset.x).negate().add(c.mul(localCrownOffset.y)),
  ).mul(treeScale);
  const worldXZ: TslNode = baseWorldXZ.add(worldCrownOffset);
  const centerY: TslNode = record.positionScale.y.add(uCenterY.mul(ageHeightScale).mul(treeScale));
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
  const localCell: TslNode = vec3(
    uint(floor(clamp(local.x.mul(0.5).add(0.5), 0, 1).mul(31))),
    uint(floor(clamp(local.y.mul(0.5).add(0.5), 0, 1).mul(31))),
    uint(floor(clamp(local.z.mul(0.5).add(0.5), 0, 1).mul(31))),
  );
  const proxyChannel: TslNode = uint(0x1109).bitXor(
    localCell.x.add(localCell.y.mul(uint(32))).add(localCell.z.mul(uint(1024))),
  );
  const noise: TslNode = treeMorphologyHash01Node(
    floatBitsToUint(record.identityBits.zw),
    proxyChannel,
  );
  const retention: TslNode = clamp(record.morphology2.y.mul(mix(0.72, 1, record.morphology0.w)), 0, 1);
  const keep: TslNode = noise.lessThan(clamp(edge.mul(uDensity).mul(retention).mul(fade), 0.0, 1.0));
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
