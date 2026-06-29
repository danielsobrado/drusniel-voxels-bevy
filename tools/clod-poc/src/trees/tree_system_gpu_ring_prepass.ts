import * as THREE from "three";
import { depthPrepassTwin } from "../rendering/veg_prepass.js";
import type { TreeLod } from "./tree_config.js";
import type { TreeMaterialHandle } from "./tree_material.js";

export function treeSystemUsesGpuRingPrepass(useTreePrepass: boolean, lod: TreeLod): boolean {
  return useTreePrepass && lod !== "impostor";
}

export interface AddTreeGpuRingPrepassTwinInput {
  root: THREE.Object3D;
  twins: THREE.Mesh[];
  lod: TreeLod;
  mesh: THREE.Mesh;
  materialHandle: TreeMaterialHandle;
  useTreePrepass: boolean;
}

export function addTreeGpuRingPrepassTwin(input: AddTreeGpuRingPrepassTwinInput): THREE.Mesh | null {
  if (!treeSystemUsesGpuRingPrepass(input.useTreePrepass, input.lod)) return null;
  const nodes = input.materialHandle.prepassNodesFor?.(input.lod);
  if (!nodes) return null;
  const twin = depthPrepassTwin(input.mesh, nodes);
  input.twins.push(twin);
  input.root.add(twin);
  return twin;
}
