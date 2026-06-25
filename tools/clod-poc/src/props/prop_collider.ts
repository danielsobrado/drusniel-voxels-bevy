import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { CapsuleCollisionConfig, CapsuleCollisionResult } from "../terrain/terrain_collider.js";
import type { CollisionMode, PropAssetMetadata } from "./prop_types.js";
import type { LoadedPropAsset } from "./prop_asset_loader.js";

export interface PropColliderInstanceInput {
  key: string;
  mode: CollisionMode;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  asset: LoadedPropAsset;
}

interface ColliderEntry {
  key: string;
  footprint: { minX: number; minZ: number; maxX: number; maxZ: number };
  geometry: THREE.BufferGeometry;
  boundsTree: MeshBVH;
}

const tempBox = new THREE.Box3();
const tempSegment = new THREE.Line3();
const trianglePoint = new THREE.Vector3();
const capsulePoint = new THREE.Vector3();
const pushDirection = new THREE.Vector3();
const triangleNormal = new THREE.Vector3();
const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function footprintFromBox(box: THREE.Box3): ColliderEntry["footprint"] {
  return { minX: box.min.x, minZ: box.min.z, maxX: box.max.x, maxZ: box.max.z };
}

function overlapsFootprint(box: THREE.Box3, footprint: ColliderEntry["footprint"]): boolean {
  return box.max.x >= footprint.minX
    && box.min.x <= footprint.maxX
    && box.max.z >= footprint.minZ
    && box.min.z <= footprint.maxZ;
}

function boxGeometryFromMetadata(metadata: PropAssetMetadata, scale: number): THREE.BufferGeometry {
  const min = metadata.localBounds.min;
  const max = metadata.localBounds.max;
  const size = new THREE.Vector3(
    (max[0] - min[0]) * scale,
    (max[1] - min[1]) * scale,
    (max[2] - min[2]) * scale,
  );
  const center = new THREE.Vector3(
    ((min[0] + max[0]) * 0.5) * scale,
    ((min[1] + max[1]) * 0.5) * scale,
    ((min[2] + max[2]) * 0.5) * scale,
  );
  const geom = new THREE.BoxGeometry(Math.max(size.x, 0.05), Math.max(size.y, 0.05), Math.max(size.z, 0.05));
  geom.translate(center.x, center.y, center.z);
  return geom;
}

function meshGeometryForAsset(asset: LoadedPropAsset): THREE.BufferGeometry | null {
  const lod0 = asset.lodChain?.levels[0]?.geometry;
  if (lod0) return lod0.clone();
  let found: THREE.Mesh | null = null;
  asset.root.traverse((obj) => {
    if (!found && obj instanceof THREE.Mesh) found = obj;
  });
  const mesh = found as THREE.Mesh | null;
  return mesh?.geometry.clone() ?? null;
}

function bakeWorldGeometry(
  localGeometry: THREE.BufferGeometry,
  position: [number, number, number],
  rotationY: number,
  scale: number,
): THREE.BufferGeometry {
  _position.set(position[0], position[1], position[2]);
  _quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
  _scale.setScalar(scale);
  _matrix.compose(_position, _quaternion, _scale);
  const baked = localGeometry.clone();
  baked.applyMatrix4(_matrix);
  baked.computeBoundingBox();
  return baked;
}

function buildColliderGeometry(input: PropColliderInstanceInput): THREE.BufferGeometry | null {
  if (input.mode === "none") return null;
  const useMesh = input.mode === "convex" || input.mode === "trimesh_near_only";
  const local = input.mode === "box"
    ? boxGeometryFromMetadata(input.asset.metadata, input.scale)
    : useMesh
      ? meshGeometryForAsset(input.asset)
      : null;
  if (!local) return null;
  return bakeWorldGeometry(local, input.position, input.rotationY, input.mode === "box" ? 1 : input.scale);
}

export class PropColliderSet {
  private readonly entries = new Map<string, ColliderEntry>();

  activeCount(): number {
    return this.entries.size;
  }

  sync(instances: PropColliderInstanceInput[]): void {
    const nextKeys = new Set(instances.map((i) => i.key));
    for (const key of [...this.entries.keys()]) {
      if (!nextKeys.has(key)) {
        const entry = this.entries.get(key)!;
        entry.geometry.dispose();
        this.entries.delete(key);
      }
    }

    for (const inst of instances) {
      if (inst.mode === "none") continue;
      if (this.entries.has(inst.key)) continue;
      const geometry = buildColliderGeometry(inst);
      if (!geometry) continue;
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (!box) continue;
      this.entries.set(inst.key, {
        key: inst.key,
        footprint: footprintFromBox(box),
        geometry,
        boundsTree: new MeshBVH(geometry),
      });
    }
  }

  resolveCapsule(
    position: THREE.Vector3,
    velocity: THREE.Vector3,
    config: CapsuleCollisionConfig,
  ): CapsuleCollisionResult {
    const radius = config.capsuleRadius;
    tempSegment.start.set(position.x, position.y + radius, position.z);
    tempSegment.end.set(position.x, position.y + config.capsuleHeight - radius, position.z);
    tempBox.makeEmpty();
    tempBox.expandByPoint(tempSegment.start);
    tempBox.expandByPoint(tempSegment.end);
    tempBox.min.addScalar(-radius);
    tempBox.max.addScalar(radius);

    const maxSlopeCosine = Math.cos(THREE.MathUtils.degToRad(config.maxSlopeDegrees));
    let grounded = false;
    let pagesTested = 0;

    for (const entry of this.entries.values()) {
      if (!overlapsFootprint(tempBox, entry.footprint)) continue;
      pagesTested++;
      entry.boundsTree.shapecast({
        intersectsBounds: (box) => box.intersectsBox(tempBox),
        intersectsTriangle: (triangle) => {
          const distance = triangle.closestPointToSegment(tempSegment, trianglePoint, capsulePoint);
          if (distance >= radius) return false;

          triangle.getNormal(triangleNormal);
          if (triangleNormal.y < 0) triangleNormal.negate();
          const depth = radius - distance;
          pushDirection.subVectors(capsulePoint, trianglePoint);
          if (pushDirection.lengthSq() < 1e-10) pushDirection.copy(triangleNormal);
          else pushDirection.normalize();

          tempSegment.start.addScaledVector(pushDirection, depth);
          tempSegment.end.addScaledVector(pushDirection, depth);
          tempBox.translate(pushDirection.clone().multiplyScalar(depth));

          if (triangleNormal.y >= maxSlopeCosine && pushDirection.y > 0.01) grounded = true;
          return false;
        },
      });
    }

    const resolvedPosition = new THREE.Vector3(
      tempSegment.start.x,
      tempSegment.start.y - radius,
      tempSegment.start.z,
    );
    const displacement = resolvedPosition.clone().sub(position);
    const resolvedVelocity = velocity.clone();
    if (displacement.lengthSq() > 1e-10) {
      const collisionNormal = displacement.normalize();
      const intoSurface = resolvedVelocity.dot(collisionNormal);
      if (intoSurface < 0) resolvedVelocity.addScaledVector(collisionNormal, -intoSurface);
    }
    if (grounded && resolvedVelocity.y < 0) resolvedVelocity.y = 0;

    return { position: resolvedPosition, velocity: resolvedVelocity, grounded, pagesTested };
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.geometry.dispose();
    this.entries.clear();
  }
}
