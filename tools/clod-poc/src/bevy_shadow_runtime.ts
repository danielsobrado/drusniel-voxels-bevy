// Bevy runtime handoff for the Fable-style CLOD shadow path.
//
// PRs 0001-0005 keep the shadow policy, manifest, proxy mesh generation, and
// viewer validation inside clod-poc.  This module is the explicit handoff shape
// consumed by the Rust/Bevy runtime: it flattens manifest + generated shadow
// proxy meshes into deterministic per-page actions.

import type { ShadowManifest, ShadowManifestEntry } from "./shadow_manifest.js";
import type { ShadowMeshAsset, ShadowMeshSet } from "./shadow_mesh.js";

export type BevyShadowRuntimeAction =
  | "UseVisualMeshCaster"
  | "SpawnProxyShadowCaster"
  | "ApplyNotShadowCaster";

export interface BevyShadowRuntimeBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface BevyShadowRuntimePlanEntry {
  nodeId: string;
  level: number;
  action: BevyShadowRuntimeAction;
  visualMeshId: string;
  shadowMeshId: string | null;
  reason: ShadowManifestEntry["reason"];
  visualTriangles: number;
  shadowTriangles: number;
  distance: number | null;
  bounds: ShadowManifestEntry["bounds"];
}

export interface BevyShadowRuntimeMeshPayload {
  shadowMeshId: string;
  nodeId: string;
  positions: number[];
  indices: number[];
  bounds: BevyShadowRuntimeBounds;
  sourceTriangleCount: number;
  triangleCount: number;
}

export interface BevyShadowRuntimeTotals {
  totalPages: number;
  visualCasterPages: number;
  proxyCasterPages: number;
  noCastPages: number;
  visualTriangles: number;
  runtimeShadowTriangles: number;
  savedTriangles: number;
  savingsRatio: number;
  missingProxyMeshes: number;
}

export interface BevyShadowRuntimeSnapshot {
  version: 1;
  generatedBy: "clod-poc-bevy-shadow-runtime";
  plans: BevyShadowRuntimePlanEntry[];
  proxyMeshes: BevyShadowRuntimeMeshPayload[];
  totals: BevyShadowRuntimeTotals;
}

export interface BevyShadowRuntimeOptions {
  /** Include proxy mesh positions/indices in the JSON snapshot. */
  includeMeshPayloads?: boolean;
  /** Throw if a ClodShadowMesh manifest entry has no generated proxy mesh. */
  requireProxyMeshes?: boolean;
}

const DEFAULT_OPTIONS: Required<BevyShadowRuntimeOptions> = {
  includeMeshPayloads: true,
  requireProxyMeshes: true,
};

function actionForEntry(entry: ShadowManifestEntry): BevyShadowRuntimeAction {
  switch (entry.policy) {
    case "VisualMesh":
      return "UseVisualMeshCaster";
    case "ClodShadowMesh":
      return "SpawnProxyShadowCaster";
    case "NoCast":
      return "ApplyNotShadowCaster";
  }
}

function shadowTrianglesForEntry(
  entry: ShadowManifestEntry,
  proxyMesh: ShadowMeshAsset | undefined,
): number {
  if (entry.policy === "NoCast") return 0;
  if (entry.policy === "VisualMesh") return entry.triangleCount;
  return proxyMesh?.triangleCount ?? entry.shadowTriangleBudget;
}

function meshPayload(asset: ShadowMeshAsset): BevyShadowRuntimeMeshPayload {
  return {
    shadowMeshId: asset.shadowMeshId,
    nodeId: asset.nodeId,
    positions: Array.from(asset.mesh.positions),
    indices: Array.from(asset.mesh.indices),
    bounds: asset.bounds,
    sourceTriangleCount: asset.sourceTriangleCount,
    triangleCount: asset.triangleCount,
  };
}

function totals(plans: readonly BevyShadowRuntimePlanEntry[], proxiesById: Map<string, ShadowMeshAsset>): BevyShadowRuntimeTotals {
  let visualCasterPages = 0;
  let proxyCasterPages = 0;
  let noCastPages = 0;
  let visualTriangles = 0;
  let runtimeShadowTriangles = 0;

  for (const plan of plans) {
    visualTriangles += plan.visualTriangles;
    runtimeShadowTriangles += plan.shadowTriangles;
    if (plan.action === "UseVisualMeshCaster") visualCasterPages += 1;
    else if (plan.action === "SpawnProxyShadowCaster") proxyCasterPages += 1;
    else noCastPages += 1;
  }

  const savedTriangles = Math.max(0, visualTriangles - runtimeShadowTriangles);
  return {
    totalPages: plans.length,
    visualCasterPages,
    proxyCasterPages,
    noCastPages,
    visualTriangles,
    runtimeShadowTriangles,
    savedTriangles,
    savingsRatio: visualTriangles > 0 ? savedTriangles / visualTriangles : 0,
    missingProxyMeshes: plans.filter(
      (plan) => plan.action === "SpawnProxyShadowCaster" &&
        (plan.shadowMeshId == null || !proxiesById.has(plan.shadowMeshId)),
    ).length,
  };
}

export function buildBevyShadowRuntimeSnapshot(
  manifest: ShadowManifest,
  meshSet: ShadowMeshSet,
  userOptions: BevyShadowRuntimeOptions = {},
): BevyShadowRuntimeSnapshot {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const proxiesById = new Map(meshSet.meshes.map((asset) => [asset.shadowMeshId, asset]));
  const usedProxyIds = new Set<string>();
  const plans: BevyShadowRuntimePlanEntry[] = [];

  for (const entry of manifest.entries) {
    const action = actionForEntry(entry);
    const proxy = entry.shadowMeshId == null ? undefined : proxiesById.get(entry.shadowMeshId);

    if (action === "SpawnProxyShadowCaster") {
      if (!entry.shadowMeshId) {
        throw new Error(`ClodShadowMesh entry has no shadowMeshId: ${entry.nodeId}`);
      }
      if (!proxy && options.requireProxyMeshes) {
        throw new Error(`Missing generated proxy mesh for ${entry.shadowMeshId} (${entry.nodeId})`);
      }
      usedProxyIds.add(entry.shadowMeshId);
    }

    plans.push({
      nodeId: entry.nodeId,
      level: entry.level,
      action,
      visualMeshId: entry.visualMeshId,
      shadowMeshId: action === "SpawnProxyShadowCaster" ? entry.shadowMeshId : null,
      reason: entry.reason,
      visualTriangles: entry.triangleCount,
      shadowTriangles: shadowTrianglesForEntry(entry, proxy),
      distance: entry.distance,
      bounds: entry.bounds,
    });
  }

  plans.sort((a, b) => a.level - b.level || a.nodeId.localeCompare(b.nodeId));

  const proxyMeshes = options.includeMeshPayloads
    ? meshSet.meshes
      .filter((asset) => usedProxyIds.has(asset.shadowMeshId))
      .sort((a, b) => a.level - b.level || a.nodeId.localeCompare(b.nodeId))
      .map(meshPayload)
    : [];

  return {
    version: 1,
    generatedBy: "clod-poc-bevy-shadow-runtime",
    plans,
    proxyMeshes,
    totals: totals(plans, proxiesById),
  };
}

export function serializeBevyShadowRuntimeSnapshot(snapshot: BevyShadowRuntimeSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
