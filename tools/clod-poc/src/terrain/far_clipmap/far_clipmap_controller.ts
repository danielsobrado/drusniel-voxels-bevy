import * as THREE from "three";
import type { FarClipmapConfig, FarClipmapDebugMode } from "./far_clipmap_config.js";
import { farClipmapRingRange, farClipmapSnap } from "./far_clipmap_keys.js";
import { createFarClipmapGridGeometry } from "./far_clipmap_geometry.js";

export interface FarClipmapStats {
  enabled: number;
  visible: number;
  ringCount: number;
  activeTiles: number;
  readyTiles: number;
  pendingTiles: number;
  rebuiltTilesThisFrame: number;
  innerRadiusM: number;
  outerRadiusM: number;
  snapSizeM: number;
  gpuOwnedCells: number;
  gpuOwnershipHoles: number;
}

export interface FarClipmapOwnershipSnapshot {
  enabled: boolean;
  innerRadiusM: number;
  outerRadiusM: number;
  centerX: number;
  centerZ: number;
  snapX: number;
  snapZ: number;
  ready: boolean;
}

export interface FarClipmapController {
  update(cameraPosition: THREE.Vector3): FarClipmapStats;
  setDebugMode(mode: FarClipmapDebugMode): void;
  setVisible(visible: boolean): void;
  dispose(): void;
  ownershipSnapshot(): FarClipmapOwnershipSnapshot;
}

interface RingMesh {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  innerRadiusM: number;
  outerRadiusM: number;
  readySnapX: number;
  readySnapZ: number;
}

const DEBUG_COLORS: Record<FarClipmapDebugMode, number> = Object.freeze({
  final: 0x33442d,
  biome: 0x2f6f4e,
  height: 0x606060,
  ownership: 0x2f70aa,
});

function makeStats(config: FarClipmapConfig, visible: boolean, readyTiles: number, rebuilt: number): FarClipmapStats {
  const pendingTiles = Math.max(0, config.ringCount - readyTiles);
  return {
    enabled: config.enabled ? 1 : 0,
    visible: visible && config.enabled ? 1 : 0,
    ringCount: config.ringCount,
    activeTiles: visible && config.enabled ? config.ringCount : 0,
    readyTiles,
    pendingTiles,
    rebuiltTilesThisFrame: rebuilt,
    innerRadiusM: config.innerRadiusM,
    outerRadiusM: config.outerRadiusM,
    snapSizeM: config.snapSizeM,
    gpuOwnedCells: readyTiles,
    gpuOwnershipHoles: pendingTiles,
  };
}

export function createFarClipmapController(scene: THREE.Scene, config: FarClipmapConfig): FarClipmapController {
  return new FarClipmapControllerImpl(scene, config);
}

class FarClipmapControllerImpl implements FarClipmapController {
  private readonly geometry: THREE.BufferGeometry;
  private readonly rings: RingMesh[] = [];
  private visible = true;
  private centerX = 0;
  private centerZ = 0;
  private snapX = Number.NaN;
  private snapZ = Number.NaN;
  private lastStats: FarClipmapStats;

  constructor(private readonly scene: THREE.Scene, private readonly config: FarClipmapConfig) {
    this.geometry = createFarClipmapGridGeometry({ gridResolution: config.gridResolution });
    this.lastStats = makeStats(config, false, 0, 0);
    for (let ring = 0; ring < config.ringCount; ring++) {
      const range = farClipmapRingRange(config, ring);
      const material = new THREE.MeshBasicMaterial({
        color: DEBUG_COLORS[config.materialDebugMode],
        depthTest: true,
        depthWrite: true,
        transparent: false,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.name = "far-clipmap-ring-" + String(ring);
      mesh.frustumCulled = false;
      mesh.visible = config.enabled;
      mesh.position.y = config.yOffset;
      mesh.scale.set(range.outerRadiusM * 2, 1, range.outerRadiusM * 2);
      scene.add(mesh);
      this.rings.push({
        mesh,
        material,
        innerRadiusM: range.innerRadiusM,
        outerRadiusM: range.outerRadiusM,
        readySnapX: Number.NaN,
        readySnapZ: Number.NaN,
      });
    }
  }

  update(cameraPosition: THREE.Vector3): FarClipmapStats {
    if (!this.config.enabled) {
      this.lastStats = makeStats(this.config, false, 0, 0);
      return this.lastStats;
    }
    this.centerX = cameraPosition.x;
    this.centerZ = cameraPosition.z;
    const snap = farClipmapSnap(cameraPosition.x, cameraPosition.z, this.config.snapSizeM);
    this.snapX = snap.snapX;
    this.snapZ = snap.snapZ;
    let rebuilt = 0;
    let ready = 0;
    for (const ring of this.rings) {
      const stale = ring.readySnapX !== snap.snapX || ring.readySnapZ !== snap.snapZ;
      if (stale && rebuilt < this.config.maxRebuildsPerFrame) {
        ring.mesh.position.set(snap.snapX, this.config.yOffset, snap.snapZ);
        ring.readySnapX = snap.snapX;
        ring.readySnapZ = snap.snapZ;
        rebuilt++;
      }
      ring.mesh.visible = this.visible;
      if (ring.readySnapX === snap.snapX && ring.readySnapZ === snap.snapZ) ready++;
    }
    this.lastStats = makeStats(this.config, this.visible, ready, rebuilt);
    return this.lastStats;
  }

  setDebugMode(mode: FarClipmapDebugMode): void {
    for (const ring of this.rings) ring.material.color.setHex(DEBUG_COLORS[mode]);
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    for (const ring of this.rings) ring.mesh.visible = visible && this.config.enabled;
  }

  ownershipSnapshot(): FarClipmapOwnershipSnapshot {
    return {
      enabled: this.config.enabled,
      innerRadiusM: this.config.innerRadiusM,
      outerRadiusM: this.config.outerRadiusM,
      centerX: this.centerX,
      centerZ: this.centerZ,
      snapX: Number.isFinite(this.snapX) ? this.snapX : this.centerX,
      snapZ: Number.isFinite(this.snapZ) ? this.snapZ : this.centerZ,
      ready: this.lastStats.readyTiles === this.config.ringCount && this.lastStats.pendingTiles === 0,
    };
  }

  dispose(): void {
    for (const ring of this.rings) {
      this.scene.remove(ring.mesh);
      ring.material.dispose();
    }
    this.geometry.dispose();
    this.rings.length = 0;
  }
}
