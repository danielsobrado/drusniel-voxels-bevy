import type { ClodPageNode } from "../../types.js";

export interface WorldBuildNodeLists {
  lod0Nodes: ClodPageNode[];
  allNodes: ClodPageNode[];
}

/**
 * Split a CLOD world build into LOD0-only pages and the flattened all-LOD list.
 *
 * lod0Nodes: vegetation, colliders, terrain summary (LOD0 page envelope).
 * allNodes: terrain view meshes, CLOD selection, diagnostics (every active LOD).
 */
export function splitWorldBuildNodes(
  nodesByLevel: Map<number, ClodPageNode[]>,
): WorldBuildNodeLists {
  const lod0Nodes = nodesByLevel.get(0) ?? [];
  const allNodes = [...nodesByLevel.values()].flat();
  return { lod0Nodes, allNodes };
}
