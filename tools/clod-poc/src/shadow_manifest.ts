// Runtime/export contract for the Fable-style CLOD shadow cut.
//
// shadow_clod.ts decides which pages cast this frame.  This module turns that
// decision into stable metadata that the viewer, exporter, and later Bevy port
// can consume without depending on Three.js or Bevy component types.

import type { ClodPageNode } from "./types.js";
import type { ShadowCaster, ShadowCutResult } from "./shadow_clod.js";

export type RuntimeShadowPolicy = "VisualMesh" | "ClodShadowMesh" | "NoCast";

export interface ShadowManifestBounds {
  center: [number, number, number];
  radius: number;
}

export interface ShadowManifestFootprint {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface ShadowManifestEntry {
  nodeId: string;
  level: number;
  childIds: string[];
  visualMeshId: string;
  shadowMeshId: string | null;
  policy: RuntimeShadowPolicy;
  reason: ShadowCaster["reason"] | "not-selected";
  distance: number | null;
  errorPx: number | null;
  triangleCount: number;
  shadowTriangleBudget: number;
  footprint: ShadowManifestFootprint;
  bounds: ShadowManifestBounds;
}

export interface ShadowManifestTotals {
  totalPages: number;
  casterPages: number;
  visualPages: number;
  proxyPages: number;
  noCastPages: number;
  visualTriangles: number;
  shadowTrianglesBudgeted: number;
  maxCasterDistance: number;
}

export interface ShadowManifest {
  version: 1;
  generatedBy: "clod-poc-shadow-manifest";
  entries: ShadowManifestEntry[];
  totals: ShadowManifestTotals;
}

export interface ShadowManifestOptions {
  /** Prefix used by the renderer/exporter for normal page meshes. */
  visualMeshPrefix?: string;
  /** Prefix used by the renderer/exporter for CLOD shadow proxy meshes. */
  shadowMeshPrefix?: string;
  /** Multiplier estimating the target proxy budget versus the visual mesh. */
  proxyTriangleRatio?: number;
}

const DEFAULT_OPTIONS: Required<ShadowManifestOptions> = {
  visualMeshPrefix: "visual:",
  shadowMeshPrefix: "shadow:",
  proxyTriangleRatio: 0.35,
};

function childrenOf(node: ClodPageNode): ClodPageNode[] {
  return node.children.filter((c): c is ClodPageNode => !!c);
}

export function flattenClodNodes(roots: readonly ClodPageNode[]): ClodPageNode[] {
  const out: ClodPageNode[] = [];
  const visit = (node: ClodPageNode) => {
    out.push(node);
    for (const child of childrenOf(node)) visit(child);
  };
  for (const root of roots) visit(root);
  return out;
}

export function meshTriangleCount(node: ClodPageNode): number {
  return Math.floor(node.mesh.indices.length / 3);
}

function runtimePolicy(caster: ShadowCaster | undefined): RuntimeShadowPolicy {
  if (!caster) return "NoCast";
  return caster.policy === "visual" ? "VisualMesh" : "ClodShadowMesh";
}

function entryForNode(
  node: ClodPageNode,
  caster: ShadowCaster | undefined,
  options: Required<ShadowManifestOptions>,
): ShadowManifestEntry {
  const triangles = meshTriangleCount(node);
  const policy = runtimePolicy(caster);
  const usesProxy = policy === "ClodShadowMesh";
  const casts = policy !== "NoCast";

  return {
    nodeId: node.id,
    level: node.level,
    childIds: childrenOf(node).map((child) => child.id),
    visualMeshId: `${options.visualMeshPrefix}${node.id}`,
    shadowMeshId: !casts
      ? null
      : usesProxy
        ? `${options.shadowMeshPrefix}${node.id}`
        : `${options.visualMeshPrefix}${node.id}`,
    policy,
    reason: caster?.reason ?? "not-selected",
    distance: caster?.distance ?? null,
    errorPx: caster?.errorPx ?? null,
    triangleCount: triangles,
    shadowTriangleBudget: !casts
      ? 0
      : usesProxy
        ? Math.max(1, Math.ceil(triangles * options.proxyTriangleRatio))
        : triangles,
    footprint: { ...node.footprint },
    bounds: {
      center: [...node.bounds.center] as [number, number, number],
      radius: node.bounds.radius,
    },
  };
}

function totals(entries: readonly ShadowManifestEntry[]): ShadowManifestTotals {
  let visualPages = 0;
  let proxyPages = 0;
  let noCastPages = 0;
  let visualTriangles = 0;
  let shadowTrianglesBudgeted = 0;
  let maxCasterDistance = 0;

  for (const entry of entries) {
    visualTriangles += entry.triangleCount;
    shadowTrianglesBudgeted += entry.shadowTriangleBudget;
    if (entry.policy === "VisualMesh") visualPages++;
    else if (entry.policy === "ClodShadowMesh") proxyPages++;
    else noCastPages++;
    if (entry.distance != null) maxCasterDistance = Math.max(maxCasterDistance, entry.distance);
  }

  return {
    totalPages: entries.length,
    casterPages: visualPages + proxyPages,
    visualPages,
    proxyPages,
    noCastPages,
    visualTriangles,
    shadowTrianglesBudgeted,
    maxCasterDistance,
  };
}

/**
 * Build a deterministic manifest for the current shadow cut.
 *
 * The manifest is intentionally conservative: every CLOD node gets an entry, but
 * only nodes selected by the shadow cut receive a shadow mesh id.  The Bevy port
 * can map these entries directly to `NotShadowCaster` for NoCast pages and to a
 * proxy-mesh entity for ClodShadowMesh pages.
 */
export function buildShadowManifest(
  roots: readonly ClodPageNode[],
  shadowCut: ShadowCutResult,
  userOptions: ShadowManifestOptions = {},
): ShadowManifest {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const casters = new Map(shadowCut.casters.map((caster) => [caster.node.id, caster]));
  const entries = flattenClodNodes(roots)
    .map((node) => entryForNode(node, casters.get(node.id), options))
    .sort((a, b) => a.level - b.level || a.nodeId.localeCompare(b.nodeId));

  return {
    version: 1,
    generatedBy: "clod-poc-shadow-manifest",
    entries,
    totals: totals(entries),
  };
}

export function serializeShadowManifest(manifest: ShadowManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
