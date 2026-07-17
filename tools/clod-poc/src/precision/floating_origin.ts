import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PlayerController } from "../player_controller.js";
import type { TerrainColliderSet } from "../terrain/terrain_collider.js";
import { markStreamCursorDiscontinuity } from "../stream/stream_cursor.js";

export interface FloatingOriginConfig {
  enabled: boolean;
  snapMeters: number;
  unboundedWorld: boolean;
  allowBoundedWorld?: boolean;
}

export interface FloatingOriginStats {
  enabled: boolean;
  originX: number;
  originZ: number;
  rebaseCount: number;
  lastRebaseFrame: number;
  lastDeltaX: number;
  lastDeltaZ: number;
}

export interface FloatingOriginRebaseTarget {
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  player: PlayerController;
  terrainColliders?: TerrainColliderSet;
  frameIndex: number;
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Floating origin ${name} must be a positive finite number`);
  }
  return value;
}

function snapDelta(value: number, snapMeters: number): number {
  if (Math.abs(value) < snapMeters) return 0;
  return Math.trunc(value / snapMeters) * snapMeters;
}

export function resolveFloatingOriginEnabled(config: FloatingOriginConfig): boolean {
  return config.enabled && (config.unboundedWorld || config.allowBoundedWorld === true);
}

export class FloatingOriginController {
  private readonly worldCamera = new THREE.PerspectiveCamera();
  private readonly statsState: FloatingOriginStats;
  private readonly effectiveEnabled: boolean;
  private readonly snapMeters: number;

  constructor(
    private readonly scene: THREE.Scene,
    config: FloatingOriginConfig,
  ) {
    this.snapMeters = finitePositive(config.snapMeters, "snapMeters");
    this.effectiveEnabled = resolveFloatingOriginEnabled(config);
    this.statsState = {
      enabled: this.effectiveEnabled,
      originX: 0,
      originZ: 0,
      rebaseCount: 0,
      lastRebaseFrame: -1,
      lastDeltaX: 0,
      lastDeltaZ: 0,
    };
  }

  rebaseIfNeeded(target: FloatingOriginRebaseTarget): boolean {
    if (!this.effectiveEnabled) {
      this.syncWorldCamera(target.camera);
      return false;
    }

    const dx = snapDelta(target.camera.position.x, this.snapMeters);
    const dz = snapDelta(target.camera.position.z, this.snapMeters);
    if (dx === 0 && dz === 0) {
      this.syncWorldCamera(target.camera);
      return false;
    }

    this.applyRenderShift(dx, dz, target);
    this.statsState.originX += dx;
    this.statsState.originZ += dz;
    this.statsState.rebaseCount++;
    this.statsState.lastRebaseFrame = target.frameIndex;
    this.statsState.lastDeltaX = dx;
    this.statsState.lastDeltaZ = dz;
    markStreamCursorDiscontinuity();
    this.syncWorldCamera(target.camera);
    return true;
  }

  getWorldCamera(renderCamera: THREE.PerspectiveCamera): THREE.PerspectiveCamera {
    this.syncWorldCamera(renderCamera);
    return this.worldCamera;
  }

  renderToWorldPosition(position: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(
      position.x + this.statsState.originX,
      position.y,
      position.z + this.statsState.originZ,
    );
  }

  stats(): FloatingOriginStats {
    return { ...this.statsState };
  }

  private applyRenderShift(dx: number, dz: number, target: FloatingOriginRebaseTarget): void {
    const shiftX = -dx;
    const shiftZ = -dz;
    for (const child of this.scene.children) {
      if (child === target.camera) continue;
      child.position.x += shiftX;
      child.position.z += shiftZ;
    }

    target.camera.position.x += shiftX;
    target.camera.position.z += shiftZ;
    target.controls.target.x += shiftX;
    target.controls.target.z += shiftZ;
    target.controls.update();

    target.player.position.x += shiftX;
    target.player.position.z += shiftZ;
    target.player.lastSafePosition.x += shiftX;
    target.player.lastSafePosition.z += shiftZ;
    target.terrainColliders?.translateHorizontal(shiftX, shiftZ);
  }

  private syncWorldCamera(renderCamera: THREE.PerspectiveCamera): void {
    this.worldCamera.copy(renderCamera, false);
    this.worldCamera.position.x = renderCamera.position.x + this.statsState.originX;
    this.worldCamera.position.y = renderCamera.position.y;
    this.worldCamera.position.z = renderCamera.position.z + this.statsState.originZ;
    this.worldCamera.updateMatrixWorld(true);
  }
}
