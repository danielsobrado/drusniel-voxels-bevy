import * as THREE from "three";
import type { FarSummaryConfig } from "./config.js";
import type { FarSummaryCache } from "./summary-cache.js";
import type { FarSummaryStats } from "./types.js";
import { attachDebugPanelChrome } from "../ui/debug_panel_chrome.js";

const TILE_STATE_COLORS: Record<string, number> = {
  requested: 0xffff00,
  building: 0xff8800,
  ready: 0x00ff00,
  stale: 0x0000ff,
  cooling: 0x888888,
  evicted: 0x440000,
  missing: 0xff0000,
};

const RING_COLORS: number[] = [
  0x00ff88,
  0x0088ff,
  0x8800ff,
  0xff8800,
];

export class FarSummaryDebugOverlay {
  private readonly config: FarSummaryConfig;
  private readonly cache: FarSummaryCache;
  private readonly statsHost: HTMLElement;
  private readonly statsElement: HTMLPreElement;

  private readonly gridGroup: THREE.Group;
  private gridMeshes: THREE.Object3D[] = [];
  private tileMeshes: THREE.Object3D[] = [];
  private lastStateRevision = -1;
  private meshRebuildFrameSkips = 0;

  constructor(
    config: FarSummaryConfig,
    cache: FarSummaryCache,
    scene?: THREE.Scene,
  ) {
    this.config = config;
    this.cache = cache;
    this.gridGroup = new THREE.Group();
    this.gridGroup.frustumCulled = false;
    scene?.add(this.gridGroup);

    this.statsHost = document.createElement("div");
    document.body.appendChild(this.statsHost);

    this.statsElement = document.createElement("pre");
    this.statsElement.style.cssText = `
      color: #9fef9f;
      font: 11px/1.4 monospace;
      margin: 0;
      max-width: 350px;
      white-space: pre-wrap;
    `;
    this.statsHost.appendChild(this.statsElement);

    const chrome = attachDebugPanelChrome(this.statsHost, {
      panelId: "far-summary",
      title: "Far Summary",
      floating: true,
      defaultPosition: {
        left: Math.max(12, window.innerWidth - 370),
        top: Math.max(12, window.innerHeight - 220),
      },
      onClose: () => this.statsHost.remove(),
    });
    chrome.body.style.padding = "6px 10px";
  }

  update(
    _frameIndex: number,
    stats: FarSummaryStats,
  ): void {
    const currentRev = this.cache.stateRevisionAt();
    this.meshRebuildFrameSkips++;
    if (currentRev !== this.lastStateRevision && this.meshRebuildFrameSkips >= 5) {
      this.rebuildMeshes();
      this.lastStateRevision = currentRev;
      this.meshRebuildFrameSkips = 0;
    }
    this.updateStatsText(stats);
  }

  private rebuildMeshes(): void {
    this.clearAllMeshes();

    if (this.config.debug.showClipmapGrid) {
      this.buildGridLines();
    }

    if (this.config.debug.showTileStates) {
      this.buildTileQuads();
    }
  }

  private buildGridLines(): void {
    for (const ring of this.config.rings) {
      const color = RING_COLORS[this.config.rings.indexOf(ring) % RING_COLORS.length];
      const tileSize = ring.cellM * ring.tileCells;
      const half = tileSize / 2;
      const positions: number[] = [];
      for (let i = 0; i <= 4; i++) {
        const p = -half + i * (tileSize / 4);
        positions.push(p, 0.5, -half, p, 0.5, half);
        positions.push(-half, 0.5, p, half, 0.5, p);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3 });
      const lines = new THREE.LineSegments(geo, mat);
      this.gridGroup.add(lines);
      this.gridMeshes.push(lines);
    }
  }

  private buildTileQuads(): void {
    this.cache.forEachTile((tile) => {
      const color = TILE_STATE_COLORS[tile.state] ?? 0xff00ff;
      const tileSize = tile.cellSizeM * tile.tileCells;
      const cx = tile.originX + tileSize / 2;
      const cz = tile.originZ + tileSize / 2;
      const quad = this.buildQuad(tileSize, color, 0.25);
      quad.position.set(cx, 0.2, cz);
      quad.renderOrder = 1000;
      this.gridGroup.add(quad);
      this.tileMeshes.push(quad);
    });
  }

  private buildQuad(size: number, color: number, opacity: number): THREE.Mesh {
    const half = size / 2;
    const positions = new Float32Array([
      -half, 0, -half, half, 0, -half, -half, 0, half, half, 0, half,
    ]);
    const indices = [0, 1, 2, 2, 1, 3];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(indices);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity,
      depthWrite: false, side: THREE.DoubleSide,
    });
    return new THREE.Mesh(geo, mat);
  }

  private clearAllMeshes(): void {
    for (const m of this.gridMeshes) {
      if (m instanceof THREE.Mesh || m instanceof THREE.LineSegments) {
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) for (const m2 of mat) m2.dispose();
        else (mat as THREE.Material)?.dispose();
      }
      this.gridGroup.remove(m);
    }
    this.gridMeshes.length = 0;
    for (const m of this.tileMeshes) {
      if (m instanceof THREE.Mesh) {
        m.geometry?.dispose();
        (m.material as THREE.Material)?.dispose();
      }
      this.gridGroup.remove(m);
    }
    this.tileMeshes.length = 0;
  }

  private updateStatsText(stats: FarSummaryStats): void {
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
      `  cns: ${stats.conservativeFallbacks}`,
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
    this.clearAllMeshes();
    this.gridGroup.removeFromParent?.();
    this.statsHost.remove();
  }
}
