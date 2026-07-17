import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import {
  footprintFromBox,
  resolveCapsuleAgainstBvhEntries,
  type CapsuleBvhFootprint,
} from "../collision/capsule_bvh_resolve.js";
import type { CapsuleCollisionConfig, CapsuleCollisionResult } from "../terrain/terrain_collider.js";
import type { ConstructionPieceDef, PlacedConstructionPiece } from "./types.js";

interface ConstructionColliderEntry {
  footprint: CapsuleBvhFootprint;
  geometry: THREE.BufferGeometry;
  boundsTree: MeshBVH;
}

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _unitScale = new THREE.Vector3(1, 1, 1);

/**
 * Player-collision colliders for placed construction pieces, keyed by piece id and kept
 * in lockstep with the visible mesh: add/remove happen in the same synchronous call as
 * the piece store mutation, so the collider always matches the visible geometry — an
 * unsupported (collapse-deferred) piece stays solid where it is drawn, and a removed
 * piece never leaves a ghost wall. Each collider is a 12-triangle box, so the BVH build
 * cost per placement is microseconds — it does not go through the async terrain
 * collider pipeline.
 */
export class ConstructionColliderSet {
  private readonly entries = new Map<string, ConstructionColliderEntry>();

  activeCount(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  add(placed: PlacedConstructionPiece, piece: ConstructionPieceDef): void {
    this.remove(placed.id);
    const geometry = new THREE.BoxGeometry(piece.dimensionsM[0], piece.dimensionsM[1], piece.dimensionsM[2]);
    _position.set(placed.position[0], placed.position[1], placed.position[2]);
    _quaternion.setFromAxisAngle(_up, placed.rotationQuarterTurns * Math.PI * 0.5);
    _matrix.compose(_position, _quaternion, _unitScale);
    geometry.applyMatrix4(_matrix);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) {
      geometry.dispose();
      return;
    }
    this.entries.set(placed.id, {
      footprint: footprintFromBox(box),
      geometry,
      boundsTree: new MeshBVH(geometry),
    });
  }

  remove(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.geometry.dispose();
    this.entries.delete(id);
    return true;
  }

  resolveCapsule(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    config: CapsuleCollisionConfig,
  ): CapsuleCollisionResult {
    return resolveCapsuleAgainstBvhEntries(this.entries.values(), position, velocity, config);
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.geometry.dispose();
    this.entries.clear();
  }
}
