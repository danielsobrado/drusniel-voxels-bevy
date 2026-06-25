import type { ClodPageNode } from "../types.js";

export interface DebugHierarchyNode {
  id: string;
  level: number;
  childIds: string[];
  triangleCount: number;
  vertexCount: number;
  errorWorld: number;
  lowBenefit: boolean;
  bounds: { center: [number, number, number]; radius: number; minY: number; maxY: number };
}

export interface DebugHierarchySummary {
  worldPagesX: number;
  worldPagesZ: number;
  totalNodes: number;
  maxLevel: number;
  nodes: DebugHierarchyNode[];
}

export function buildDebugSummary(nodesByLevel: Map<number, ClodPageNode[]>): DebugHierarchySummary {
  const nodes: DebugHierarchyNode[] = [];
  let maxLevel = 0;
  for (const [level, levelNodes] of nodesByLevel) {
    maxLevel = Math.max(maxLevel, level);
    for (const node of levelNodes) {
      nodes.push({
        id: node.id,
        level: node.level,
        childIds: node.children.filter((c): c is ClodPageNode => c !== null).map((c) => c.id),
        triangleCount: node.mesh.indices.length / 3,
        vertexCount: node.mesh.positions.length / 3,
        errorWorld: node.errorWorld,
        lowBenefit: node.lowBenefit,
        bounds: node.bounds,
      });
    }
  }
  return {
    worldPagesX: 0,
    worldPagesZ: 0,
    totalNodes: nodes.length,
    maxLevel,
    nodes,
  };
}

export function debugHierarchyToJson(summary: DebugHierarchySummary): string {
  return JSON.stringify(summary, null, 2);
}

export function nodeToObj(node: ClodPageNode): string {
  const lines: string[] = [];
  const pos = node.mesh.positions;
  const nrm = node.mesh.normals;
  const idx = node.mesh.indices;

  for (let i = 0; i < pos.length; i += 3) {
    lines.push(`v ${pos[i].toFixed(6)} ${pos[i + 1].toFixed(6)} ${pos[i + 2].toFixed(6)}`);
  }
  for (let i = 0; i < nrm.length; i += 3) {
    lines.push(`vn ${nrm[i].toFixed(6)} ${nrm[i + 1].toFixed(6)} ${nrm[i + 2].toFixed(6)}`);
  }
  lines.push(`g ${node.id}`);
  for (let i = 0; i < idx.length; i += 3) {
    lines.push(`f ${idx[i] + 1}/${idx[i] + 1} ${idx[i + 1] + 1}/${idx[i + 1] + 1} ${idx[i + 2] + 1}/${idx[i + 2] + 1}`);
  }
  return lines.join("\n");
}
