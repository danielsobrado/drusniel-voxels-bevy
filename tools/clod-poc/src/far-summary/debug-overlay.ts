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
  private gridMeshes: THREE.Object3D[] = [];
  private tileMeshes: THREE.Object3D[] = [];

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
    this.updateTileMeshes();
    this.updateStatsText(stats);
  }

  private updateGrid(): void {
    this.clearMeshList(this.gridMeshes);
    if (!this.config.debug.showClipmapGrid) return;

    for (const ring of this.config.rings) {
      const color = RING_COLORS[this.config.rings.indexOf(ring) % RING_COLORS.length];
      const grid = this.buildRingGrid(ring.cellM * ring.tileCells, 4, color);
      if (grid) {
        this.gridGroup.add(grid);
        this.gridMeshes.push(grid);
      }
    }
  }

  private updateTileMeshes(): void {
    this.clearMeshList(this.tileMeshes);
    if (!this.config.debug.showTileStates) return;

    for (let ri = 0; ri < this.config.rings.length; ri++) {
      const ring = this.config.rings[ri];
      const tileSize = ring.cellM * ring.tileCells;
      for (let tx = -5; tx <= 5; tx++) {
        for (let tz = -5; tz <= 5; tz++) {
          const cx = (tx + 0.5) * tileSize;
          const cz = (tz + 0.5) * tileSize;
          const color = RING_COLORS[ri % RING_COLORS.length];
          const mesh = this.buildTileQuad(tileSize, color, 0.15);
          mesh.position.set(cx, 0.3, cz);
          mesh.renderOrder = 1000;
          this.gridGroup.add(mesh);
          this.tileMeshes.push(mesh);
        }
      }
    }
  }

  private clearMeshList(list: THREE.Object3D[]): void {
    for (const m of list) {
      if (m instanceof THREE.Mesh || m instanceof THREE.LineSegments) {
        m.geometry?.dispose();
        if (Array.isArray(m.material)) {
          for (const mat of m.material) mat.dispose();
        } else {
          (m.material as THREE.Material)?.dispose();
        }
      }
      this.gridGroup.remove(m);
    }
    list.length = 0;
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
    return new THREE.LineSegments(geometry, material);
  }

  private buildTileQuad(size: number, color: number, opacity: number): THREE.Mesh {
    const half = size / 2;
    const positions = new Float32Array([
      -half, 0, -half,
      half, 0, -half,
      -half, 0, half,
      half, 0, half,
    ]);
    const indices = [0, 1, 2, 2, 1, 3];
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    return new THREE.Mesh(geometry, material);
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
    this.clearMeshList(this.gridMeshes);
    this.clearMeshList(this.tileMeshes);
    this.gridGroup.removeFromParent?.();
    this.statsElement?.remove();
  }
}
