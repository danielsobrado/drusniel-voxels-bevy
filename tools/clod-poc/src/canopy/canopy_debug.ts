import * as THREE from "three";
import type { CanopyShellConfig } from "./canopy_types_internal.js";
import type { CanopyMetrics, CanopySummaryTile } from "./canopy_types.js";
import { trackedMeshBasicMaterial } from "../rendering/material_churn/tracked_material_factory.js";

export interface CanopyDebugState {
  showTileBounds: boolean;
  showCoverageHeatmap: boolean;
  showShellWireframe: boolean;
  showFadeZone: boolean;
  freezeClipCenter: boolean;
  forceSyntheticSource: boolean;
  syntheticFallbackActive: boolean;
  statsLine: string;
}

export function createCanopyDebugState(config: CanopyShellConfig): CanopyDebugState {
  return {
    showTileBounds: config.debug.showTileBounds,
    showCoverageHeatmap: config.debug.showCoverageHeatmap,
    showShellWireframe: config.debug.showShellWireframe,
    showFadeZone: config.debug.showFadeZone,
    freezeClipCenter: config.debug.freezeClipCenter,
    forceSyntheticSource: config.debug.forceSyntheticSource,
    syntheticFallbackActive: false,
    statsLine: "canopy: pending",
  };
}

export function canopyDebugStateToConfig(
  state: CanopyDebugState,
  base: CanopyShellConfig,
): CanopyShellConfig {
  return {
    ...base,
    debug: {
      ...base.debug,
      showTileBounds: state.showTileBounds,
      showCoverageHeatmap: state.showCoverageHeatmap,
      showShellWireframe: state.showShellWireframe,
      showFadeZone: state.showFadeZone,
      freezeClipCenter: state.freezeClipCenter,
      forceSyntheticSource: state.forceSyntheticSource,
    },
  };
}

export function applyConfigToCanopyDebugState(
  state: CanopyDebugState,
  config: CanopyShellConfig,
): void {
  state.showTileBounds = config.debug.showTileBounds;
  state.showCoverageHeatmap = config.debug.showCoverageHeatmap;
  state.showShellWireframe = config.debug.showShellWireframe;
  state.showFadeZone = config.debug.showFadeZone;
  state.freezeClipCenter = config.debug.freezeClipCenter;
  state.forceSyntheticSource = config.debug.forceSyntheticSource;
}

export function formatCanopyStatsLine(
  metrics: CanopyMetrics,
  syntheticFallback: boolean,
): string {
  const warn = syntheticFallback ? " SYNTHETIC" : "";
  const impostors = metrics.gpuImpostorEnabled ? ` imp ${metrics.gpuImpostorInstances}` : "";
  return `tiles ${metrics.visibleTiles} q${metrics.queuedTiles} cov ${metrics.averageCoverage.toFixed(2)}${impostors}${warn}`;
}

export interface CanopyDebugOverlays {
  tileBoundsGroup: THREE.Group;
  fadeZoneGroup: THREE.Group;
  materialForFadeZone(color: number): THREE.MeshBasicMaterial;
  dispose(): void;
}

function disposeGroupGeometry(group: THREE.Group): void {
  for (const child of group.children) {
    if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) child.geometry.dispose();
  }
  group.clear();
}

export function createCanopyDebugOverlays(scene: THREE.Scene): CanopyDebugOverlays {
  const tileBoundsGroup = new THREE.Group();
  tileBoundsGroup.name = "CanopyTileBounds";
  const fadeZoneGroup = new THREE.Group();
  fadeZoneGroup.name = "CanopyFadeZone";
  const fadeZoneMaterials = new Map<number, THREE.MeshBasicMaterial>();
  scene.add(tileBoundsGroup);
  scene.add(fadeZoneGroup);

  return {
    tileBoundsGroup,
    fadeZoneGroup,
    materialForFadeZone(color: number): THREE.MeshBasicMaterial {
      const existing = fadeZoneMaterials.get(color);
      if (existing) return existing;
      const material = trackedMeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.25 }, `canopy-fade-zone:${color.toString(16)}`);
      fadeZoneMaterials.set(color, material);
      return material;
    },
    dispose() {
      scene.remove(tileBoundsGroup);
      scene.remove(fadeZoneGroup);
      disposeGroupGeometry(tileBoundsGroup);
      disposeGroupGeometry(fadeZoneGroup);
      for (const material of fadeZoneMaterials.values()) material.dispose();
      fadeZoneMaterials.clear();
    },
  };
}

export function updateCanopyDebugOverlays(
  overlays: CanopyDebugOverlays,
  tiles: CanopySummaryTile[],
  config: CanopyShellConfig,
  centerX: number,
  centerZ: number,
  state: CanopyDebugState,
): void {
  disposeGroupGeometry(overlays.tileBoundsGroup);
  disposeGroupGeometry(overlays.fadeZoneGroup);

  if (state.showTileBounds) {
    for (const tile of tiles) {
      const sizeX = tile.resolution * tile.cellSizeM;
      const sizeZ = sizeX;
      const box = new THREE.Box3(
        new THREE.Vector3(tile.originX, -50, tile.originZ),
        new THREE.Vector3(tile.originX + sizeX, 200, tile.originZ + sizeZ),
      );
      overlays.tileBoundsGroup.add(new THREE.Box3Helper(box, state.syntheticFallbackActive ? 0xff6600 : 0x44ff88));
    }
  }

  if (state.showFadeZone) {
    const { shellStartM, shellFullM, shellEndM, fadeBandM } = config.distances;
    for (const [radius, color] of [
      [shellStartM, 0x00ffff],
      [shellFullM, 0x0088ff],
      [shellEndM, 0xff0088],
      [shellEndM - fadeBandM, 0xffaa00],
    ] as const) {
      const ring = new THREE.RingGeometry(radius - 2, radius + 2, 64);
      const mesh = new THREE.Mesh(ring, overlays.materialForFadeZone(color));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(centerX, 4, centerZ);
      overlays.fadeZoneGroup.add(mesh);
    }
  }
}
