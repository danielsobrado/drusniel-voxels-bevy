import { borderChain } from "../validate.js";
import { ClodPageNode } from "../types.js";

export interface SharedEdge {
  axis: "x" | "z";
  aPlane: number;
  bPlane: number;
}

export interface CrossLodAdjacency {
  a: ClodPageNode;
  b: ClodPageNode;
  edge: SharedEdge;
}

export function sharedEdge(a: ClodPageNode, b: ClodPageNode): SharedEdge | null {
  const fa = a.footprint, fb = b.footprint;
  const overlapZ = fa.minZ < fb.maxZ && fb.minZ < fa.maxZ;
  const overlapX = fa.minX < fb.maxX && fb.minX < fa.maxX;
  if (overlapZ) {
    if (fa.maxX === fb.minX) return { axis: "x", aPlane: fa.maxX, bPlane: fb.minX };
    if (fb.maxX === fa.minX) return { axis: "x", aPlane: fa.minX, bPlane: fb.maxX };
  }
  if (overlapX) {
    if (fa.maxZ === fb.minZ) return { axis: "z", aPlane: fa.maxZ, bPlane: fb.minZ };
    if (fb.maxZ === fa.minZ) return { axis: "z", aPlane: fa.minZ, bPlane: fb.maxZ };
  }
  return null;
}

// Cheap cut-change detector: FNV-1a rolling hash over render-order node ids. selectCut is
// deterministic, so an unchanged cut hashes identically — avoids a per-frame O(R log R)
// sort + giant string join just to detect changes.
export function hashRenderedCut(rendered: readonly ClodPageNode[]): number {
  let h = 2166136261;
  for (const n of rendered) {
    const id = n.id;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
    h = Math.imul(h ^ 0x2c, 16777619); // id separator
  }
  return h >>> 0;
}

export function crossLodAdjacencies(rendered: ClodPageNode[]): CrossLodAdjacency[] {
  const out: CrossLodAdjacency[] = [];
  for (let i = 0; i < rendered.length; i++) {
    for (let j = i + 1; j < rendered.length; j++) {
      const a = rendered[i], b = rendered[j];
      if (a.level === b.level) continue;
      const edge = sharedEdge(a, b);
      if (edge) out.push({ a, b, edge });
    }
  }
  return out;
}

export function appendBorderChainSegments(
  pts: number[],
  node: ClodPageNode,
  axis: "x" | "z",
  plane: number,
  minAlong: number,
  maxAlong: number,
): void {
  const free = axis === "x" ? 2 : 0;
  const chain = borderChain(node.mesh, axis, plane, node.footprint).positions
    .filter((p) => p[free] >= minAlong - 0.001 && p[free] <= maxAlong + 0.001);
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1], b = chain[i];
    pts.push(a[0], a[1] + 0.12, a[2], b[0], b[1] + 0.12, b[2]);
  }
}

export function appendCrossLodBorderSegments(pts: number[], adjacency: CrossLodAdjacency): void {
  const { a, b, edge } = adjacency;
  if (edge.axis === "x") {
    const minZ = Math.max(a.footprint.minZ, b.footprint.minZ);
    const maxZ = Math.min(a.footprint.maxZ, b.footprint.maxZ);
    appendBorderChainSegments(pts, a, edge.axis, edge.aPlane, minZ, maxZ);
    appendBorderChainSegments(pts, b, edge.axis, edge.bPlane, minZ, maxZ);
  } else {
    const minX = Math.max(a.footprint.minX, b.footprint.minX);
    const maxX = Math.min(a.footprint.maxX, b.footprint.maxX);
    appendBorderChainSegments(pts, a, edge.axis, edge.aPlane, minX, maxX);
    appendBorderChainSegments(pts, b, edge.axis, edge.bPlane, minX, maxX);
  }
}
