// Phase 2 runtime selection. Plan §4.1.
//
// DAG-cut over the quadtree each frame: render a node when its screen-space error is
// within budget, else recurse. Monotone error_world (from the builder) guarantees a clean
// cut. Adds hysteresis (split/merge band) and the 2:1 restricted-quadtree pass.

import { ClodPageNode } from "./types.js";

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

/** error_world -> error_px. Plan §2 formula. distance = camera to bounding-sphere surface. */
export function errorPx(node: ClodPageNode, p: SelectionParams): number {
  const c = node.bounds.center;
  const d = Math.hypot(p.camPos[0] - c[0], p.camPos[1] - c[1], p.camPos[2] - c[2]);
  const dist = Math.max(0.001, d - node.bounds.radius);
  return (node.errorWorld * p.viewportH) / (2 * dist * Math.tan(p.fovY / 2));
}

const kids = (n: ClodPageNode): ClodPageNode[] => n.children.filter((c): c is ClodPageNode => !!c);
const missingForcedChildrenWarnings = new Set<string>();

export interface SelectionResult {
  rendered: ClodPageNode[];
  state: SelectionState;
  forcedSplits: number; // how many nodes the 2:1 pass split
  nearFieldForcedSplits: number; // how many nodes the near-field bubble forced to LOD0
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
      }
      rendered.push(node); // LOD0 leaf — finest available
      return;
    }
    if (params.forcedMaxLevel != null && node.level > params.forcedMaxLevel) {
      newSplit.add(node.id);
      for (const c of children) visit(c);
      return;
    }
    const epx = errorPx(node, params);
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

/** Two footprints share an edge (touch on a side with overlapping perpendicular range). */
function adjacent(a: ClodPageNode, b: ClodPageNode): boolean {
  const fa = a.footprint, fb = b.footprint;
  const overlapZ = fa.minZ < fb.maxZ && fb.minZ < fa.maxZ;
  const overlapX = fa.minX < fb.maxX && fb.minX < fa.maxX;
  const touchX = (fa.maxX === fb.minX || fb.maxX === fa.minX) && overlapZ;
  const touchZ = (fa.maxZ === fb.minZ || fb.maxZ === fa.minZ) && overlapX;
  return touchX || touchZ;
}

/**
 * 2:1 restricted-quadtree pass (plan §4.1): force-split any rendered node whose edge
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
    let didSplit = false;
    outer: for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const a = work[i], b = work[j];
        if (Math.abs(a.level - b.level) <= 1 || !adjacent(a, b)) continue;
        const coarser = a.level > b.level ? a : b;
        const children = kids(coarser);
        if (children.length === 0) continue; // can't refine further
        split.add(coarser.id);
        onSplit();
        work = work.filter((n) => n !== coarser).concat(children);
        didSplit = true;
        break outer;
      }
    }
    if (!didSplit) break;
  }
  return work;
}
