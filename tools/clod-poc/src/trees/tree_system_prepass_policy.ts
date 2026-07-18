import * as THREE from "three";
import type { PrepassNodes } from "../rendering/veg_prepass.js";
import type { TreeLod } from "./tree_config.js";

interface NodeMaterialShape {
  positionNode?: unknown;
  maskNode?: unknown;
}

export interface TreeCpuPrepassSelectionInput {
  lod: TreeLod;
  bakedImpostor: boolean;
  impostorMaterial?: THREE.Material;
  baseNodes?: PrepassNodes;
}

export function selectTreeCpuPrepassNodes(input: TreeCpuPrepassSelectionInput): PrepassNodes | undefined {
  if (input.lod !== "impostor" || !input.bakedImpostor) return input.baseNodes;
  if (!input.impostorMaterial) return undefined;

  const material = input.impostorMaterial as THREE.Material & NodeMaterialShape;
  if (material.positionNode === undefined) return undefined;
  return {
    positionNode: material.positionNode,
    maskNode: material.maskNode,
    side: material.side,
  };
}
