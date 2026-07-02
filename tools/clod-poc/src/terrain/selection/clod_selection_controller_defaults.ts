import * as THREE from "three";
import { LOD_COLORS } from "../../app/clod_constants.js";
import type { ClodPageNode } from "../../types.js";
import type { ClodSelectionDebugOverlays } from "./clod_selection_controller_types.js";
import type { ClodSelectionSettings } from "./clod_selection_controller_types.js";
import type { ClodErrorPxStats } from "../../gpu/clod_error_px_compute.js";
import type { WebGpuReadbackMode } from "../../core/webgpu_readback_mode.js";
import type { CrossLodAdjacency } from "../geometry/cross_lod_adjacency.js";
import { borderChain } from "../../clod/validate.js";
import { sharedEdge, appendCrossLodBorderSegments } from "../geometry/cross_lod_adjacency.js";

export function emptyWebGpuStats(
  webgpuSelectionEnabled: boolean,
  allNodesLength: number,
  webGpuUnavailableReason: string | null,
  readbackMode: WebGpuReadbackMode,
): ClodErrorPxStats {
  return {
    enabled: webgpuSelectionEnabled,
    available: false,
    status: webgpuSelectionEnabled ? "unavailable" : "disabled",
    reason: webGpuUnavailableReason ?? (webgpuSelectionEnabled ? "not initialized" : undefined),
    nodeCount: allNodesLength,
    version: 0,
    latestAgeFrames: null,
    submitMs: null,
    readbackMs: null,
    skippedDispatches: 0,
    parity: "unchecked",
    parityMaxDelta: null,
    readbackMode,
    dispatchOnlyFrames: 0,
    readbackFrames: 0,
  };
}

export function rebuildDebugOverlays(
  rendered: ClodPageNode[],
  xLodAdjacencies: CrossLodAdjacency[],
  settings: ClodSelectionSettings,
  overlays: ClodSelectionDebugOverlays,
): void {
  const { boundaryGroup, seamGroup, crossLodBorderGroup } = overlays;
  boundaryGroup.clear();
  if (settings.showBounds) {
    for (const n of rendered) {
      const box = new THREE.Box3(
        new THREE.Vector3(n.footprint.minX, n.bounds.center[1] - n.bounds.radius, n.footprint.minZ),
        new THREE.Vector3(n.footprint.maxX, n.bounds.center[1] + n.bounds.radius, n.footprint.maxZ),
      );
      boundaryGroup.add(new THREE.Box3Helper(box, new THREE.Color(LOD_COLORS[Math.min(n.level, 3)])));
    }
  }

  seamGroup.clear();
  if (settings.showSeamPoints) {
    const pts: number[] = [];
    for (let i = 0; i < rendered.length; i++) {
      for (let j = i + 1; j < rendered.length; j++) {
        const a = rendered[i], b = rendered[j];
        if (a.level !== b.level) continue;
        const edge = sharedEdge(a, b);
        if (!edge) continue;
        const ca = borderChain(a.mesh, edge.axis, edge.aPlane, a.footprint);
        const cb = borderChain(b.mesh, edge.axis, edge.bPlane, b.footprint);
        for (const p of ca.positions) pts.push(p[0], p[1], p[2]);
        for (const p of cb.positions) pts.push(p[0], p[1], p[2]);
      }
    }
    if (pts.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
      const mat = new THREE.PointsMaterial({
        color: 0xff2448,
        size: 4,
        sizeAttenuation: false,
        depthTest: false,
      });
      const pointCloud = new THREE.Points(geom, mat);
      pointCloud.renderOrder = 20;
      seamGroup.add(pointCloud);
    }
  }

  crossLodBorderGroup.clear();
  if (!settings.showCrossLodBorders) return;
  const borderPts: number[] = [];
  for (const adjacency of xLodAdjacencies) appendCrossLodBorderSegments(borderPts, adjacency);
  if (borderPts.length > 0) {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(new Float32Array(borderPts), 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffff,
      depthTest: false,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geom, mat);
    lines.renderOrder = 21;
    crossLodBorderGroup.add(lines);
  }
}
