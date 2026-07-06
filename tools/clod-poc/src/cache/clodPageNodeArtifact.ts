import type { ClodPageNode } from "../types.js";
import type { ClodPageNodeArtifact } from "./artifactSerializer.js";

export function clodPageNodeFromArtifact(
  artifact: ClodPageNodeArtifact,
  children: ClodPageNode[] = [],
): ClodPageNode {
  return {
    id: artifact.nodeId,
    level: artifact.level,
    children,
    mesh: {
      positions: artifact.positions,
      normals: artifact.normals,
      paintSlots: artifact.paintSlots,
      materialWeights: artifact.materialWeights,
      materialWeightStride: artifact.materialWeightStride,
      indices: artifact.indices,
    },
    footprint: artifact.footprint,
    bounds: artifact.bounds,
    errorWorld: artifact.errorWorld,
    lowBenefit: artifact.lowBenefit,
  };
}

export function clodPageNodeToArtifact(node: ClodPageNode): ClodPageNodeArtifact {
  return {
    nodeId: node.id,
    level: node.level,
    positions: node.mesh.positions,
    normals: node.mesh.normals,
    paintSlots: node.mesh.paintSlots,
    materialWeights: node.mesh.materialWeights,
    materialWeightStride: node.mesh.materialWeightStride,
    indices: node.mesh.indices,
    errorWorld: node.errorWorld,
    boundingSphere: [
      node.bounds.center[0],
      node.bounds.center[1],
      node.bounds.center[2],
      node.bounds.radius,
    ],
    lowBenefit: node.lowBenefit,
    footprint: node.footprint,
    bounds: node.bounds,
  };
}
