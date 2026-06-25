import * as THREE from "three";
import type { ClodNodeId, ClodFadeState } from "./clodCrossfade.js";
import { updateDitherUniforms } from "./clodDitherMaterial.js";

export interface NodeMeshMap {
  meshes: Map<ClodNodeId, THREE.Mesh>;
  ditherMaterials: Map<ClodNodeId, THREE.ShaderMaterial>;
}

export function createNodeMeshMap(): NodeMeshMap {
  return {
    meshes: new Map(),
    ditherMaterials: new Map(),
  };
}

export function applyFadeStates(
  meshes: Map<ClodNodeId, THREE.Mesh>,
  ditherMaterials: Map<ClodNodeId, THREE.ShaderMaterial>,
  fadeStates: Map<ClodNodeId, ClodFadeState>,
  useDither: boolean,
): void {
  for (const [nodeId, fadeState] of fadeStates) {
    const mesh = meshes.get(nodeId);
    if (!mesh) continue;

    if (!fadeState.visible) {
      mesh.visible = false;
      continue;
    }

    mesh.visible = true;

    if (useDither && fadeState.ditherRole !== "stable") {
      const ditherMat = ditherMaterials.get(nodeId);
      if (ditherMat) {
        mesh.material = ditherMat;
        updateDitherUniforms(ditherMat, fadeState.fadeAlpha, fadeState.ditherRole);
      }
    }
  }

  for (const [nodeId, mesh] of meshes) {
    if (!fadeStates.has(nodeId)) {
      mesh.visible = false;
    }
  }
}

export function hideAllMeshes(meshes: Map<ClodNodeId, THREE.Mesh>): void {
  for (const mesh of meshes.values()) {
    mesh.visible = false;
  }
}
