import type { ClodPageNode } from "../types.js";

export const CLOD_NODE_RECORD_FLOATS = 12;
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
  // LV-1: per-node height range + horizontal page span for the relief bias in the GPU shader.
  // Layout matches clod_common.wgsl ClodNodeGpu struct:
  //   error_level_min_y = [errorWorld, level, minY(idx6), maxY(idx7)]
  //   page_span_reserved = [pageSpan(idx8), 0, 0, 0]
  target[offset + 6] = node.bounds.minY;
  target[offset + 7] = node.bounds.maxY;
  target[offset + 8] = node.footprint.maxX - node.footprint.minX; // pageSpan
  target[offset + 9] = 0;
  target[offset + 10] = 0;
  target[offset + 11] = 0;
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
