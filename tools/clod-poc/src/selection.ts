// DAG-cut over the quadtree each frame: render a node when its screen-space error is
// within budget, else recurse. Monotone error_world (from the builder) guarantees a clean
// cut. Adds hysteresis (split/merge band) and the 2:1 restricted-quadtree pass.

import { ClodPageNode } from "./types.js";
import { emitAudio } from "./audio/index.js";

export interface SelectionParams {
  thresholdPx: number;
  hysteresisMergeFactor: number;
  enforce21: boolean;
  nearField?: {
    enabled: boolean;
    centerX: number;
    centerZ: number;
    radius: number;
    boundaryPadding: number;
  };
  viewportH: number;
  fovY: number; // radians (vertical)
  camPos: [number, number, number];
  forcedMaxLevel?: number | null;
}

export interface SelectionState {
  split: Set<string>; // node ids currently split (recursed) — carries hysteresis frame to frame
}

/** error_world -> error_px. distance = camera to bounding-sphere surface. */
export function errorPx(node: ClodPageNode, p: SelectionParams): number {
  const c = node.bounds.center;
  const d = Math.hypot(p.camPos[0] - c[0], p.camPos[1] - c[1], p.camPos[2] - c[2]);
  const dist = Math.max(0.001, d - node.bounds.radius);
  const base = (node.errorWorld * p.viewportH) / (2 * dist * Math.tan(p.fovY / 2));
  // LV-1: relief bias — nodes with more vertical extent split earlier.
  // The boost is applied to screen-space error only, NOT to stored errorWorld (which must
  // stay monotonic for the DAG-cut invariant).  Relief bias from height-range / page-span ratio.
  const pageSpan = node.footprint.maxX - node.footprint.minX;
  const heightRange = node.bounds.maxY - node.bounds.minY;
  const reliefBoost = pageSpan > 0
    ? Math.min(1.8, Math.max(1, 1 + (heightRange / pageSpan) * 0.8))
    : 1;
  return base * reliefBoost;
}

const kids = (n: ClodPageNode): ClodPageNode[] => n.children.filter((c): c is ClodPageNode => !!c);
const missingForcedChildrenWarnings = new Set<string>();

export interface SelectionResult {
  rendered: ClodPageNode[];
  state: SelectionState;
  forcedSplits: number; // how many nodes the 2:1 pass split
  nearFieldForcedSplits: number; // how many nodes the near-field bubble forced to LOD0
}

export interface SelectionOptions {
  errorPxLookup?: (node: ClodPageNode) => number | undefined;
  forceSplitIds?: ReadonlySet<string>;
}

function rectDistance2ToPoint(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  x: number,
  z: number,
): number {
  const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
  const dz = z < minZ ? minZ - z : z > maxZ ? z - maxZ : 0;
  return dx * dx + dz * dz;
}

function nearFieldForcesSplit(node: ClodPageNode, params: SelectionParams): boolean {
  const nf = params.nearField;
  if (!nf?.enabled) return false;
  const r = nf.radius + nf.boundaryPadding;
  return (
    rectDistance2ToPoint(
      node.footprint.minX,
      node.footprint.minZ,
      node.footprint.maxX,
      node.footprint.maxZ,
      nf.centerX,
      nf.centerZ,
    ) <= r * r
  );
}

export function selectCut(
  roots: ClodPageNode[],
  params: SelectionParams,
  prev: SelectionState,
  options: SelectionOptions = {},
): SelectionResult {
  const newSplit = new Set<string>();
  const rendered: ClodPageNode[] = [];
  let nearFieldForcedSplits = 0;

  const visit = (node: ClodPageNode) => {
    const children = kids(node);
    if (children.length === 0) {
      if (params.forcedMaxLevel != null && node.level > params.forcedMaxLevel && !missingForcedChildrenWarnings.has(node.id)) {
        console.warn(`force max level ${params.forcedMaxLevel} could not split ${node.id}; no children available`);
        missingForcedChildrenWarnings.add(node.id);
        emitAudio("clod.validation.warning");
      }
      rendered.push(node); // LOD0 leaf — finest available
      return;
    }
    if (params.forcedMaxLevel != null && node.level > params.forcedMaxLevel) {
      newSplit.add(node.id);
      for (const c of children) visit(c);
      return;
    }
    if (options.forceSplitIds?.has(node.id)) {
      newSplit.add(node.id);
      for (const c of children) visit(c);
      return;
    }
    const epx = options.errorPxLookup?.(node) ?? errorPx(node, params);
    const wasSplit = prev.split.has(node.id);
    const forcedByNearField = nearFieldForcesSplit(node, params);
    // Hysteresis: split at threshold, only merge back once under threshold / mergeFactor.
    const shouldSplit = wasSplit
      ? epx > params.thresholdPx / params.hysteresisMergeFactor
      : epx > params.thresholdPx;
    if (forcedByNearField || shouldSplit) {
      newSplit.add(node.id);
      if (forcedByNearField && !shouldSplit) nearFieldForcedSplits++;
      for (const c of children) visit(c);
    } else {
      rendered.push(node);
    }
  };
  for (const r of roots) visit(r);

  let forcedSplits = 0;
  const finalRendered = params.enforce21
    ? enforce21(rendered, newSplit, () => forcedSplits++)
    : rendered;

  return { rendered: finalRendered, state: { split: newSplit }, forcedSplits, nearFieldForcedSplits };
}

interface EdgeEntry {
  node: ClodPageNode;
  side: -1 | 1;
  start: number;
  end: number;
}

function addEdge(index: Map<number, EdgeEntry[]>, plane: number, entry: EdgeEntry): void {
  let entries = index.get(plane);
  if (!entries) {
    entries = [];
    index.set(plane, entries);
  }
  entries.push(entry);
}

function find21Violation(nodes: readonly ClodPageNode[]): ClodPageNode | null {
  const xEdges = new Map<number, EdgeEntry[]>();
  const zEdges = new Map<number, EdgeEntry[]>();
  for (const node of nodes) {
    const f = node.footprint;
    addEdge(xEdges, f.minX, { node, side: -1, start: f.minZ, end: f.maxZ });
    addEdge(xEdges, f.maxX, { node, side: 1, start: f.minZ, end: f.maxZ });
    addEdge(zEdges, f.minZ, { node, side: -1, start: f.minX, end: f.maxX });
    addEdge(zEdges, f.maxZ, { node, side: 1, start: f.minX, end: f.maxX });
  }

  const scan = (entries: EdgeEntry[]): ClodPageNode | null => {
    entries.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      for (let j = i + 1; j < entries.length && entries[j].start < a.end; j++) {
        const b = entries[j];
        if (a.side === b.side || b.end <= a.start || Math.abs(a.node.level - b.node.level) <= 1) continue;
        const coarser = a.node.level > b.node.level ? a.node : b.node;
        if (kids(coarser).length > 0) return coarser;
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

/**
 * 2:1 restricted-quadtree pass: force-split any rendered node whose edge
 * neighbor is more than one level apart, until stable. Bounds the visual density gradient;
 * locked borders already keep seams watertight, so this is about appearance, not cracks.
 */
function enforce21(
  rendered: ClodPageNode[],
  split: Set<string>,
  onSplit: () => void,
): ClodPageNode[] {
  let work = [...rendered];
  for (let guard = 0; guard < 64; guard++) {
    const coarser = find21Violation(work);
    if (!coarser) break;
    const children = kids(coarser);
    split.add(coarser.id);
    onSplit();
    work = work.filter((n) => n !== coarser).concat(children);
  }
  return work;
}
