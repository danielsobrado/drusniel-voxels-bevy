import type { ClodPageNodeRuntime, ClodCut, ClodSelectedNode, ClodNodeId } from "./clodRuntimeTypes.js";
import { logger } from "./clodLogger.js";

interface EdgeEntry {
  nodeId: ClodNodeId;
  level: number;
  side: -1 | 1;
  start: number;
  end: number;
}

export function enforceRestrictedQuadtree(params: {
  cut: ClodCut;
  nodes: ReadonlyMap<ClodNodeId, ClodPageNodeRuntime>;
  maxLevelDelta: number;
}): {
  cut: ClodCut;
  forcedSplits: number;
  blockedSplits: number;
} {
  let forcedSplits = 0;
  let blockedSplits = 0;
  let work = new Map(params.cut.nodes);
  const blockedNodes = new Set<ClodNodeId>();
  const newSplit = new Set(params.cut.split ?? []);

  for (let iteration = 0; iteration < 64; iteration++) {
    const selected = [...work.values()].filter((s) => !blockedNodes.has(s.nodeId));
    const coarser = findLevelDeltaViolation(selected, params.nodes, params.maxLevelDelta);
    if (!coarser) break;

    const coarseNode = params.nodes.get(coarser);
    if (!coarseNode) break;

    const readyChildren = coarseNode.childIds
      .map((cid) => params.nodes.get(cid))
      .filter((c): c is ClodPageNodeRuntime => !!c && c.ready);

    if (readyChildren.length === coarseNode.childIds.length && coarseNode.childIds.length > 0) {
      work.delete(coarser);
      newSplit.add(coarser);
      for (const child of readyChildren) {
        work.set(child.id, {
          nodeId: child.id,
          level: child.level,
          errorPx: 0,
          distanceToCamera: 0,
          reason: "restricted-forced-split",
        });
      }
      forcedSplits++;
    } else {
      blockedNodes.add(coarser);
      blockedSplits++;
      logger.warn(
        `restricted split blocked for ${coarser}: not all children ready`,
      );
    }
  }

  const resultCut: ClodCut = {
    frame: params.cut.frame,
    nodes: work,
    split: newSplit,
  };

  return { cut: resultCut, forcedSplits, blockedSplits };
}

function findLevelDeltaViolation(
  selected: ClodSelectedNode[],
  nodes: ReadonlyMap<ClodNodeId, ClodPageNodeRuntime>,
  maxLevelDelta: number,
): ClodNodeId | null {
  const xEdges = new Map<number, EdgeEntry[]>();
  const zEdges = new Map<number, EdgeEntry[]>();

  for (const sel of selected) {
    const node = nodes.get(sel.nodeId);
    if (!node) continue;
    const f = node.footprint;
    addEdge(xEdges, f.minX, { nodeId: node.id, level: node.level, side: -1, start: f.minZ, end: f.maxZ });
    addEdge(xEdges, f.maxX, { nodeId: node.id, level: node.level, side: 1, start: f.minZ, end: f.maxZ });
    addEdge(zEdges, f.minZ, { nodeId: node.id, level: node.level, side: -1, start: f.minX, end: f.maxX });
    addEdge(zEdges, f.maxZ, { nodeId: node.id, level: node.level, side: 1, start: f.minX, end: f.maxX });
  }

  const scan = (entries: EdgeEntry[]): ClodNodeId | null => {
    entries.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      for (let j = i + 1; j < entries.length && entries[j].start < a.end; j++) {
        const b = entries[j];
        if (a.side === b.side || b.end <= a.start) continue;
        const delta = Math.abs(a.level - b.level);
        if (delta <= maxLevelDelta) continue;
        const coarser = a.level > b.level ? a.nodeId : b.nodeId;
        return coarser;
      }
    }
    return null;
  };

  for (const entries of xEdges.values()) {
    const violation = scan(entries);
    if (violation) return violation;
  }
  for (const entries of zEdges.values()) {
    const violation = scan(entries);
    if (violation) return violation;
  }
  return null;
}

function addEdge(index: Map<number, EdgeEntry[]>, plane: number, entry: EdgeEntry): void {
  let entries = index.get(plane);
  if (!entries) {
    entries = [];
    index.set(plane, entries);
  }
  entries.push(entry);
}
