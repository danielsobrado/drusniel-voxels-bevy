// Viewer model for generated CLOD shadow proxy meshes.
//
// shadow_overlay.ts shows policy boxes from the manifest.  This module shows
// the actual proxy geometry produced by shadow_mesh.ts so clod-poc can validate
// silhouette quality and real triangle savings before the Bevy runtime bridge.

import type { ShadowMeshAsset, ShadowMeshSet } from "./shadow_mesh.js";
import type { RuntimeShadowPolicy } from "./shadow_manifest.js";
import { shadowPolicyColor } from "./shadow_overlay.js";

export type ShadowProxyViewerMode = "off" | "proxy-meshes";

export interface ShadowProxyViewerOptions {
  mode?: ShadowProxyViewerMode;
  wireframe?: boolean;
  showBounds?: boolean;
  opacity?: number;
}

export interface ShadowProxyViewerMeshEntry {
  nodeId: string;
  level: number;
  policy: RuntimeShadowPolicy;
  shadowMeshId: string;
  visualMeshId: string;
  label: string;
  color: number;
  opacity: number;
  wireframe: boolean;
  showBounds: boolean;
  sourceTriangleCount: number;
  triangleCount: number;
  savedTriangles: number;
  savingsRatio: number;
  bounds: ShadowMeshAsset["bounds"];
  footprint: ShadowMeshAsset["footprint"];
  positions: Float32Array;
  indices: Uint32Array;
}

export interface ShadowProxyViewerSummary {
  mode: ShadowProxyViewerMode;
  meshCount: number;
  sourceTriangles: number;
  proxyTriangles: number;
  savedTriangles: number;
  savingsRatio: number;
  maxReductionRatio: number;
  minReductionRatio: number;
}

export interface ShadowProxyViewerModel {
  mode: ShadowProxyViewerMode;
  meshes: ShadowProxyViewerMeshEntry[];
  summary: ShadowProxyViewerSummary;
}

const DEFAULT_OPTIONS: Required<ShadowProxyViewerOptions> = {
  mode: "proxy-meshes",
  wireframe: true,
  showBounds: false,
  opacity: 0.55,
};

function savedTriangles(asset: ShadowMeshAsset): number {
  return Math.max(0, asset.sourceTriangleCount - asset.triangleCount);
}

function savingsRatio(asset: ShadowMeshAsset): number {
  return asset.sourceTriangleCount > 0 ? savedTriangles(asset) / asset.sourceTriangleCount : 0;
}

function labelFor(asset: ShadowMeshAsset): string {
  return [
    asset.shadowMeshId,
    `L${asset.level}`,
    `${asset.triangleCount}/${asset.sourceTriangleCount} tris`,
    `${(savingsRatio(asset) * 100).toFixed(1)}% saved`,
  ].join(" · ");
}

function meshEntry(asset: ShadowMeshAsset, options: Required<ShadowProxyViewerOptions>): ShadowProxyViewerMeshEntry {
  return {
    nodeId: asset.nodeId,
    level: asset.level,
    policy: "ClodShadowMesh",
    shadowMeshId: asset.shadowMeshId,
    visualMeshId: asset.visualMeshId,
    label: labelFor(asset),
    color: shadowPolicyColor("ClodShadowMesh"),
    opacity: options.opacity,
    wireframe: options.wireframe,
    showBounds: options.showBounds,
    sourceTriangleCount: asset.sourceTriangleCount,
    triangleCount: asset.triangleCount,
    savedTriangles: savedTriangles(asset),
    savingsRatio: savingsRatio(asset),
    bounds: {
      min: [...asset.bounds.min] as [number, number, number],
      max: [...asset.bounds.max] as [number, number, number],
    },
    footprint: { ...asset.footprint },
    positions: asset.mesh.positions,
    indices: asset.mesh.indices,
  };
}

function summary(mode: ShadowProxyViewerMode, meshes: readonly ShadowProxyViewerMeshEntry[]): ShadowProxyViewerSummary {
  const meshCount = meshes.length;
  const sourceTriangles = meshes.reduce((sum, mesh) => sum + mesh.sourceTriangleCount, 0);
  const proxyTriangles = meshes.reduce((sum, mesh) => sum + mesh.triangleCount, 0);
  const saved = Math.max(0, sourceTriangles - proxyTriangles);
  const ratios = meshes.map((mesh) => mesh.triangleCount / Math.max(1, mesh.sourceTriangleCount));

  return {
    mode,
    meshCount,
    sourceTriangles,
    proxyTriangles,
    savedTriangles: saved,
    savingsRatio: sourceTriangles > 0 ? saved / sourceTriangles : 0,
    maxReductionRatio: ratios.length > 0 ? Math.max(...ratios) : 0,
    minReductionRatio: ratios.length > 0 ? Math.min(...ratios) : 0,
  };
}

export function buildShadowProxyViewerModel(
  meshSet: ShadowMeshSet,
  userOptions: ShadowProxyViewerOptions = {},
): ShadowProxyViewerModel {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const meshes = options.mode === "off"
    ? []
    : meshSet.meshes
      .map((asset) => meshEntry(asset, options))
      .sort((a, b) => a.level - b.level || a.nodeId.localeCompare(b.nodeId));

  return {
    mode: options.mode,
    meshes,
    summary: summary(options.mode, meshes),
  };
}

export function shadowProxyViewerSummaryLine(summary: ShadowProxyViewerSummary): string {
  if (summary.mode === "off") return "proxy view: off";
  return `proxy view: meshes ${summary.meshCount} ` +
    `source ${summary.sourceTriangles.toLocaleString()} tris ` +
    `proxy ${summary.proxyTriangles.toLocaleString()} tris ` +
    `saved ${(summary.savingsRatio * 100).toFixed(1)}% ` +
    `ratio ${summary.minReductionRatio.toFixed(2)}-${summary.maxReductionRatio.toFixed(2)}`;
}
