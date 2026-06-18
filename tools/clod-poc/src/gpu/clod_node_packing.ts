import type { ClodPageNode } from "../types.js";

export const CLOD_NODE_RECORD_FLOATS = 8;
export const CLOD_NODE_RECORD_BYTES = CLOD_NODE_RECORD_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export interface PackedClodNodes {
  data: Float32Array;
  nodeIndexById: Map<string, number>;
}

export function packClodNodeInto(target: Float32Array, nodeIndex: number, node: ClodPageNode): void {
  const offset = nodeIndex * CLOD_NODE_RECORD_FLOATS;
  target[offset] = node.bounds.center[0];
  target[offset + 1] = node.bounds.center[1];
  target[offset + 2] = node.bounds.center[2];
  target[offset + 3] = node.bounds.radius;
  target[offset + 4] = node.errorWorld;
  target[offset + 5] = node.level;
  target[offset + 6] = 0;
  target[offset + 7] = 0;
}

export function packClodNodes(nodes: readonly ClodPageNode[]): PackedClodNodes {
  const data = new Float32Array(nodes.length * CLOD_NODE_RECORD_FLOATS);
  const nodeIndexById = new Map<string, number>();
  nodes.forEach((node, index) => {
    nodeIndexById.set(node.id, index);
    packClodNodeInto(data, index, node);
  });
  return { data, nodeIndexById };
}
