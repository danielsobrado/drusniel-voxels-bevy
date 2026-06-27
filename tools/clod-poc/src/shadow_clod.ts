// Fable-style CLOD terrain shadow planning for the PoC.
//
// This is deliberately separate from selection.ts.  The visual cut decides what
// the camera sees; the shadow cut decides what the sun-shadow pass is allowed to
// rasterize.  Fable's key optimisation is the same separation: dense terrain is
// visible, but coarse terrain/proxy geometry is what casts far CSM shadows.

import type { ClodPageNode } from "./types.js";
import { errorPx, type SelectionParams } from "./clod/selection.js";

export type ShadowCasterPolicy = "visual" | "proxy";

export interface ShadowCaster {
  node: ClodPageNode;
  policy: ShadowCasterPolicy;
  distance: number;
  errorPx: number;
  reason: "near" | "near-field" | "proxy";
}

export interface ShadowCutStats {
  visualPages: number;
  proxyPages: number;
  nonePages: number;
  budgetDroppedPages: number;
  nearFieldForcedVisualPages: number;
  maxDistance: number;
}

export interface ShadowCutResult {
  casters: ShadowCaster[];
  stats: ShadowCutStats;
}

export interface ShadowCutParams extends Pick<
  SelectionParams,
  "viewportH" | "fovY" | "camPos" | "nearField"
> {
  /** Horizontal distance where CLOD terrain may cast from the visual page mesh. */
  nearVisualDistance: number;
  /** Horizontal distance where terrain may still cast through a CLOD proxy page. */
  proxyDistance: number;
  /** Hard budget after sorting nearest/most detailed pages first. */
  maxCasterPages: number;
  /** Finest level allowed to cast as the visual mesh.  Drusniel default: LOD0 only. */
  visualMaxLevel: number;
  /** Coarsest useful proxy minimum.  Drusniel default: LOD1+ for proxy casters. */
  proxyMinLevel: number;
  /** Optional screen-space quality guard for proxy choice. */
  proxyErrorThresholdPx: number;
}

export const DEFAULT_SHADOW_CUT_PARAMS: Omit<
  ShadowCutParams,
  "viewportH" | "fovY" | "camPos" | "nearField"
> = {
  nearVisualDistance: 64,
  proxyDistance: 192,
  maxCasterPages: 64,
  visualMaxLevel: 0,
  proxyMinLevel: 1,
  proxyErrorThresholdPx: 24,
};

const kids = (n: ClodPageNode): ClodPageNode[] => n.children.filter((c): c is ClodPageNode => !!c);

/**
 * Horizontal distance from a point to a page footprint.  Shadows are budgeted by
 * ground-plane distance, not sphere distance, so tall mountains do not keep
 * remote pages in the near visual shadow tier.
 */
export function shadowDistanceToPage(node: ClodPageNode, camPos: [number, number, number]): number {
  const x = camPos[0];
  const z = camPos[2];
  const f = node.footprint;
  const dx = x < f.minX ? f.minX - x : x > f.maxX ? x - f.maxX : 0;
  const dz = z < f.minZ ? f.minZ - z : z > f.maxZ ? z - f.maxZ : 0;
  return Math.hypot(dx, dz);
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

function nearFieldTouches(node: ClodPageNode, params: ShadowCutParams): boolean {
  const nf = params.nearField;
  if (!nf?.enabled) return false;
  const r = nf.radius + nf.boundaryPadding;
  return rectDistance2ToPoint(
    node.footprint.minX,
    node.footprint.minZ,
    node.footprint.maxX,
    node.footprint.maxZ,
    nf.centerX,
    nf.centerZ,
  ) <= r * r;
}

function casterSort(a: ShadowCaster, b: ShadowCaster): number {
  if (a.distance !== b.distance) return a.distance - b.distance;
  if (a.policy !== b.policy) return a.policy === "visual" ? -1 : 1;
  if (a.node.level !== b.node.level) return a.node.level - b.node.level;
  return a.node.id.localeCompare(b.node.id);
}

function makeCaster(node: ClodPageNode, params: ShadowCutParams, policy: ShadowCasterPolicy, reason: ShadowCaster["reason"]): ShadowCaster {
  return {
    node,
    policy,
    distance: shadowDistanceToPage(node, params.camPos),
    errorPx: errorPx(node, {
      thresholdPx: params.proxyErrorThresholdPx,
      hysteresisMergeFactor: 1,
      enforce21: false,
      viewportH: params.viewportH,
      fovY: params.fovY,
      camPos: params.camPos,
      nearField: params.nearField,
    }),
    reason,
  };
}

function collectVisualLeaves(node: ClodPageNode, params: ShadowCutParams, out: ShadowCaster[], reason: "near" | "near-field"): void {
  const children = kids(node);
  if (children.length === 0 || node.level <= params.visualMaxLevel) {
    out.push(makeCaster(node, params, "visual", reason));
    return;
  }
  for (const child of children) collectVisualLeaves(child, params, out, reason);
}

function collectProxy(node: ClodPageNode, params: ShadowCutParams, out: ShadowCaster[]): void {
  const children = kids(node);
  const dist = shadowDistanceToPage(node, params.camPos);
  if (dist > params.proxyDistance) return;

  // Prefer a page-level proxy once it is coarse enough and has acceptable
  // projected error.  If it is still too detailed, walk children until a useful
  // proxy is found.  This keeps shadow caster count tied to the shadow budget,
  // not the current visual split state.
  const epx = errorPx(node, {
    thresholdPx: params.proxyErrorThresholdPx,
    hysteresisMergeFactor: 1,
    enforce21: false,
    viewportH: params.viewportH,
    fovY: params.fovY,
    camPos: params.camPos,
    nearField: params.nearField,
  });
  if (node.level >= params.proxyMinLevel && (children.length === 0 || epx <= params.proxyErrorThresholdPx)) {
    out.push(makeCaster(node, params, "proxy", "proxy"));
    return;
  }
  if (children.length === 0) {
    out.push(makeCaster(node, params, "proxy", "proxy"));
    return;
  }
  for (const child of children) collectProxy(child, params, out);
}

/**
 * Select the terrain pages that should cast shadows for the current camera.
 *
 * Unlike selectCut(), this intentionally does not take a previous hysteresis
 * state.  Shadows are sorted/budgeted deterministically, so the output remains
 * stable unless camera distance bands or the CLOD proxy error cross a threshold.
 *
 * Precondition: `roots` should be page-sized clipmap tiles (one root per LOD1+
 * tile), not a single world-spanning root.  The near/proxy/none band decision is
 * made per-root: a root whose footprint clips the near-field bubble forces its
 * entire subtree to visual casters.  With page-sized roots this is correct; with
 * a monolithic root the whole world would be forced visual.
 */
export function selectShadowCut(roots: ClodPageNode[], params: ShadowCutParams): ShadowCutResult {
  const candidates: ShadowCaster[] = [];
  let nonePages = 0;
  const preBudgetNearFieldForcedPages: number[] = [];

  const visit = (node: ClodPageNode) => {
    const dist = shadowDistanceToPage(node, params.camPos);
    const forcedNearField = nearFieldTouches(node, params);

    if (forcedNearField) {
      const before = candidates.length;
      collectVisualLeaves(node, params, candidates, "near-field");
      preBudgetNearFieldForcedPages.push(candidates.length - before);
      return;
    }

    if (dist <= params.nearVisualDistance) {
      collectVisualLeaves(node, params, candidates, "near");
      return;
    }

    if (dist <= params.proxyDistance) {
      collectProxy(node, params, candidates);
      return;
    }

    nonePages++;
  };

  for (const root of roots) visit(root);

  candidates.sort(casterSort);
  const casters = candidates.slice(0, params.maxCasterPages);
  const budgetDroppedPages = Math.max(0, candidates.length - casters.length);

  // Recompute nearFieldForcedVisualPages from the final casters slice so the
  // stat is consistent with visualPages (both reflect the budgeted output).
  let nearFieldForcedVisualPages = 0;
  for (const c of casters) {
    if (c.reason === "near-field") nearFieldForcedVisualPages++;
  }

  const baseStats = shadowCutStats(casters);

  return {
    casters,
    stats: {
      ...baseStats,
      nonePages,
      budgetDroppedPages,
      nearFieldForcedVisualPages,
      maxDistance: casters.reduce((m, c) => Math.max(m, c.distance), 0),
    },
  };
}

export function shadowCutStats(casters: readonly ShadowCaster[]): Pick<ShadowCutStats, "visualPages" | "proxyPages" | "nonePages"> {
  let visualPages = 0;
  let proxyPages = 0;
  for (const caster of casters) {
    if (caster.policy === "visual") visualPages++;
    else proxyPages++;
  }
  return { visualPages, proxyPages, nonePages: 0 };
}
