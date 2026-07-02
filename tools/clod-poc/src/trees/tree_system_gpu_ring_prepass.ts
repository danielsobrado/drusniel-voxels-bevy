import * as THREE from "three";
import { depthPrepassTwin } from "../rendering/veg_prepass.js";
import type { TreeLod } from "./tree_config.js";
import { treeLodWithinDepthPrepass, type TreeDepthPrepassMaxLod } from "./tree_depth_prepass_runtime.js";
import type { TreeMaterialHandle } from "./tree_material.js";

export function treeSystemUsesGpuRingPrepass(
  useTreePrepass: boolean,
  maxLod: TreeDepthPrepassMaxLod,
  lod: TreeLod,
): boolean {
  return useTreePrepass && treeLodWithinDepthPrepass(maxLod, lod);
}

export interface AddTreeGpuRingPrepassTwinInput {
  root: THREE.Object3D;
  twins: THREE.Mesh[];
  lod: TreeLod;
  mesh: THREE.Mesh;
  materialHandle: TreeMaterialHandle;
  useTreePrepass: boolean;
  maxLod: TreeDepthPrepassMaxLod;
}

export function addTreeGpuRingPrepassTwin(input: AddTreeGpuRingPrepassTwinInput): THREE.Mesh | null {
  if (!treeSystemUsesGpuRingPrepass(input.useTreePrepass, input.maxLod, input.lod)) return null;
  const nodes = input.materialHandle.prepassNodesFor?.(input.lod);
  if (!nodes) return null;
  const twin = depthPrepassTwin(input.mesh, nodes, { cloneColorMaterial: false });
  input.twins.push(twin);
  input.root.add(twin);
  return twin;
}
