import type { ClodPageNode } from "../types.js";
import { deriveParentPage, type ClodDerivationConfig } from "./parent_page_derivation.js";

export interface DerivedClodTree {
  roots: ClodPageNode[];
  nodesByLevel: Map<number, ClodPageNode[]>;
  leafNodes: number;
  parentNodes: number;
  maxLevel: number;
  maxErrorWorld: number;
  borderChainsChecked: number;
}

export function buildDerivedClodTree(
  leafNodes: readonly ClodPageNode[],
  worldPages: number,
  config: ClodDerivationConfig & { maxParentLevel: number },
): DerivedClodTree {
  const nodesByLevel = new Map<number, ClodPageNode[]>();
  const index: Map<string, ClodPageNode>[] = [];
  const lod0 = [...leafNodes].sort((a, b) =>
    a.footprint.minZ - b.footprint.minZ ||
    a.footprint.minX - b.footprint.minX ||
    a.id.localeCompare(b.id)
  );
  nodesByLevel.set(0, lod0);
  index[0] = indexLevel(lod0);

  let parentNodes = 0;
  let borderChainsChecked = 0;
  let maxErrorWorld = 0;
  let prevCount = Math.max(1, Math.floor(worldPages));
  for (let level = 1; level <= config.maxParentLevel && prevCount > 1; level++) {
    const count = Math.ceil(prevCount / 2);
    const levelNodes: ClodPageNode[] = [];
    for (let nz = 0; nz < count; nz++) {
      for (let nx = 0; nx < count; nx++) {
        const children = childrenFor(index[level - 1], nx, nz);
        if (children.length === 0) continue;
        const derived = deriveParentPage(level, nx, nz, children, config);
        levelNodes.push(derived.node);
        parentNodes++;
        borderChainsChecked += derived.borderChainsChecked;
        maxErrorWorld = Math.max(maxErrorWorld, derived.node.errorWorld);
      }
    }
    nodesByLevel.set(level, levelNodes);
    index[level] = indexLevel(levelNodes);
    prevCount = count;
  }

  const maxLevel = Math.max(...nodesByLevel.keys());
  const roots = nodesByLevel.get(maxLevel) ?? [];
  for (const node of lod0) maxErrorWorld = Math.max(maxErrorWorld, node.errorWorld);
  return {
    roots,
    nodesByLevel,
    leafNodes: lod0.length,
    parentNodes,
    maxLevel,
    maxErrorWorld,
    borderChainsChecked,
  };
}

function indexLevel(nodes: readonly ClodPageNode[]): Map<string, ClodPageNode> {
  const out = new Map<string, ClodPageNode>();
  for (const node of nodes) {
    const match = /^L\d+:(\d+),(\d+)$/.exec(node.id);
    if (match) out.set(`${match[1]},${match[2]}`, node);
  }
  return out;
}

function childrenFor(index: Map<string, ClodPageNode>, nx: number, nz: number): ClodPageNode[] {
  const children: ClodPageNode[] = [];
  for (let dz = 0; dz < 2; dz++) {
    for (let dx = 0; dx < 2; dx++) {
      const child = index.get(`${nx * 2 + dx},${nz * 2 + dz}`);
      if (child) children.push(child);
    }
  }
  return children;
}
