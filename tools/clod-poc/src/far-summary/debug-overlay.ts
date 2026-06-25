import * as THREE from "three";
import type { FarSummaryConfig } from "./config.js";
import type { FarSummaryCache } from "./summary-cache.js";
import type { FarSummaryStats } from "./types.js";

const RING_COLORS: number[] = [
  0x00ff88,
  0x0088ff,
  0x8800ff,
  0xff8800,
];

export class FarSummaryDebugOverlay {
  private readonly config: FarSummaryConfig;

  private readonly gridGroup: THREE.Group;
  private readonly statsElement: HTMLPreElement | null = null;
  private gridMeshes: THREE.LineSegments[] = [];

  constructor(
    config: FarSummaryConfig,
    _cache: FarSummaryCache,
    scene?: THREE.Scene,
  ) {
    this.config = config;
    this.gridGroup = new THREE.Group();
    this.gridGroup.frustumCulled = false;
    scene?.add(this.gridGroup);

    this.statsElement = document.createElement("pre");
    this.statsElement.style.cssText = `
      position: fixed;
      bottom: 8px;
      right: 8px;
      background: rgba(0,0,0,0.75);
      color: #9fef9f;
      font: 11px/1.4 monospace;
      padding: 6px 10px;
      border-radius: 4px;
      pointer-events: none;
      z-index: 101;
      margin: 0;
      max-width: 350px;
      white-space: pre-wrap;
    `;
    document.body.appendChild(this.statsElement);
  }

  update(
    _frameIndex: number,
    stats: FarSummaryStats,
  ): void {
    this.updateGrid();
    this.updateStatsText(stats);
  }

  private updateGrid(): void {
    this.clearMeshes();

    if (!this.config.debug.showClipmapGrid) {
      return;
    }

    for (const ring of this.config.rings) {
      const color = RING_COLORS[this.config.rings.indexOf(ring) % RING_COLORS.length];
      const grid = this.buildRingGrid(ring.cellM * ring.tileCells, 4, color);
      if (grid) this.gridMeshes.push(grid);
    }
  }

  private clearMeshes(): void {
    for (const m of this.gridMeshes) {
      this.gridGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.gridMeshes = [];
  }

  private buildRingGrid(tileSize: number, subdivisions: number, color: number): THREE.LineSegments | null {
    const half = tileSize / 2;
    const step = tileSize / subdivisions;

    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= subdivisions; i++) {
      const p = -half + i * step;
      points.push(new THREE.Vector3(p, 0.5, -half));
      points.push(new THREE.Vector3(p, 0.5, half));
      points.push(new THREE.Vector3(-half, 0.5, p));
      points.push(new THREE.Vector3(half, 0.5, p));
    }

    const positions = new Float32Array(points.length * 3);
    for (let i = 0; i < points.length; i++) {
      positions[i * 3] = points[i].x;
      positions[i * 3 + 1] = points[i].y;
      positions[i * 3 + 2] = points[i].z;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 });
    const lines = new THREE.LineSegments(geometry, material);
    return lines;
  }

  private updateStatsText(stats: FarSummaryStats): void {
    if (!this.statsElement) return;

    const lines = [
      "Far Summary:",
      `  req: ${stats.requestedTiles}`,
      `  bld: ${stats.buildingTiles}`,
      `  rdy: ${stats.readyTiles}`,
      `  stl: ${stats.staleTiles}`,
      `  evt: ${stats.evictedTiles}`,
      `  hit: ${this.cacheHitsPercent(stats)}%`,
      `  prc: ${stats.proceduralFallbacks}`,
      `  lwr: ${stats.lowerRingFallbacks}`,
      `  blt: ${stats.tilesBuiltThisFrame}`,
      `  ms:  ${stats.buildTimeMs.toFixed(1)}`,
      `  max: ${stats.maxBuildTimeMs.toFixed(1)}`,
    ];
    this.statsElement.textContent = lines.join("\n");
  }

  private cacheHitsPercent(stats: FarSummaryStats): string {
    const total = stats.cacheHits + stats.cacheMisses;
    if (total === 0) return "---";
    return ((stats.cacheHits / total) * 100).toFixed(0);
  }

  dispose(): void {
    this.clearMeshes();
    this.gridGroup.removeFromParent?.();
    this.statsElement?.remove();
  }
}
