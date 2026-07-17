import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { MeshBVH } from "three-mesh-bvh";
import {
  footprintFromBox,
  resolveCapsuleAgainstBvhEntries,
  type CapsuleBvhFootprint,
} from "../collision/capsule_bvh_resolve.js";
import type { CapsuleCollisionConfig, CapsuleCollisionResult } from "../terrain/terrain_collider.js";
import { constructionPlacementBoxes } from "./construction_proxy.js";
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

function createProxyGeometry(piece: ConstructionPieceDef): THREE.BufferGeometry {
  const parts = constructionPlacementBoxes(piece).map((proxy) => {
    const geometry = new THREE.BoxGeometry(proxy.dimensionsM[0], proxy.dimensionsM[1], proxy.dimensionsM[2]);
    geometry.rotateY(THREE.MathUtils.degToRad(proxy.rotationYDegrees ?? 0));
    geometry.translate(proxy.center[0], proxy.center[1], proxy.center[2]);
    return geometry;
  });
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!merged) throw new Error(`Failed to create placement proxy geometry for ${piece.id}`);
  return merged;
}

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
    const geometry = createProxyGeometry(piece);
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
