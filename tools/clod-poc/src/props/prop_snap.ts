import * as THREE from "three";
import type { PropAssetDef, PropAssetMetadata, PropBoundsSnapshot, PropInstance, PropSnapGroup, PropSnapPoint } from "./prop_types.js";

const SNAP_RADIUS_M = 1.1;
const MIN_ALIGNMENT = 0.65;
const STRUCTURAL_WEIGHT = 8;

const DEFAULT_ACCEPTS: Record<PropSnapGroup, PropSnapGroup[]> = {
  "prop-bottom": ["prop-top", "prop-foundation", "prop-roof"],
  "prop-top": ["prop-bottom", "prop-foundation", "prop-roof"],
  "prop-side": ["prop-side", "prop-door", "prop-window"],
  "prop-door": ["prop-side", "prop-door"],
  "prop-window": ["prop-side", "prop-window"],
  "prop-roof": ["prop-bottom", "prop-top", "prop-roof"],
  "prop-foundation": ["prop-bottom", "prop-top"],
};

interface WorldSnapPoint {
  assetId: string;
  point: PropSnapPoint;
  worldPos: THREE.Vector3;
  worldDirection: THREE.Vector3;
}

export interface PropSnapPlacementInput {
  assetId: string;
  position: [number, number, number];
  rotationY: number;
  scale: number;
  ignoreInstanceIndex?: number;
  radiusM?: number;
}

export interface PropSnapPlacementResult {
  position: [number, number, number];
  targetAssetId: string;
  sourceSnapId: string;
  targetSnapId: string;
  distanceM: number;
}

function v(value: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(value[0], value[1], value[2]);
}

function tuple(value: THREE.Vector3): [number, number, number] {
  return [value.x, value.y, value.z];
}

function norm(value: THREE.Vector3): THREE.Vector3 {
  return value.lengthSq() > 0.000001 ? value.normalize() : new THREE.Vector3(0, 1, 0);
}

function snapAccepts(source: PropSnapPoint, target: PropSnapPoint): boolean {
  const sourceAccepts = source.accepts.length > 0 ? source.accepts : DEFAULT_ACCEPTS[source.group];
  const targetAccepts = target.accepts.length > 0 ? target.accepts : DEFAULT_ACCEPTS[target.group];
  return sourceAccepts.includes(target.group) && targetAccepts.includes(source.group);
}

function rank(sourceGroup: PropSnapGroup, targetGroup: PropSnapGroup): number {
  if (sourceGroup === "prop-bottom" && (targetGroup === "prop-top" || targetGroup === "prop-foundation")) return 4;
  if (sourceGroup === "prop-foundation" && targetGroup === "prop-bottom") return 4;
  if (sourceGroup === "prop-side" && targetGroup === "prop-side") return 3;
  if (sourceGroup === "prop-door" && targetGroup === "prop-door") return 3;
  if (sourceGroup === "prop-roof" || targetGroup === "prop-roof") return 2;
  return 1;
}

function boundsSnaps(bounds: PropBoundsSnapshot): PropSnapPoint[] {
  const min = bounds.min;
  const max = bounds.max;
  const c = bounds.center;
  return [
    { id: "auto-bottom", localPos: [c[0], min[1], c[2]], direction: [0, -1, 0], group: "prop-bottom", accepts: ["prop-top", "prop-foundation", "prop-roof"] },
    { id: "auto-top", localPos: [c[0], max[1], c[2]], direction: [0, 1, 0], group: "prop-top", accepts: ["prop-bottom", "prop-foundation", "prop-roof"] },
    { id: "auto-east", localPos: [max[0], c[1], c[2]], direction: [1, 0, 0], group: "prop-side", accepts: ["prop-side", "prop-door", "prop-window"] },
    { id: "auto-west", localPos: [min[0], c[1], c[2]], direction: [-1, 0, 0], group: "prop-side", accepts: ["prop-side", "prop-door", "prop-window"] },
    { id: "auto-north", localPos: [c[0], c[1], min[2]], direction: [0, 0, -1], group: "prop-side", accepts: ["prop-side", "prop-door", "prop-window"] },
    { id: "auto-south", localPos: [c[0], c[1], max[2]], direction: [0, 0, 1], group: "prop-side", accepts: ["prop-side", "prop-door", "prop-window"] },
  ];
}

export function propSnapPoints(def: PropAssetDef, metadata: PropAssetMetadata): PropSnapPoint[] {
  return def.snapPoints && def.snapPoints.length > 0 ? def.snapPoints : boundsSnaps(metadata.localBounds);
}

function worldSnap(assetId: string, snap: PropSnapPoint, position: readonly [number, number, number], rotationY: number, scale: number): WorldSnapPoint {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
  return {
    assetId,
    point: snap,
    worldPos: v(position).add(v(snap.localPos).multiplyScalar(scale).applyQuaternion(q)),
    worldDirection: norm(v(snap.direction).applyQuaternion(q)),
  };
}

function sourceOffset(snap: PropSnapPoint, rotationY: number, scale: number): { offset: THREE.Vector3; direction: THREE.Vector3 } {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY);
  return {
    offset: v(snap.localPos).multiplyScalar(scale).applyQuaternion(q),
    direction: norm(v(snap.direction).applyQuaternion(q)),
  };
}

export function resolvePropSnapPlacement(
  input: PropSnapPlacementInput,
  instances: readonly PropInstance[],
  assetDefs: ReadonlyMap<string, PropAssetDef>,
  metadataByAssetId: ReadonlyMap<string, PropAssetMetadata>,
): PropSnapPlacementResult | null {
  const sourceDef = assetDefs.get(input.assetId);
  const sourceMetadata = metadataByAssetId.get(input.assetId);
  if (!sourceDef || !sourceMetadata) return null;

  const radiusM = input.radiusM ?? SNAP_RADIUS_M;
  const candidatePos = v(input.position);
  const sourceSnaps = propSnapPoints(sourceDef, sourceMetadata);
  let best: PropSnapPlacementResult | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let targetIndex = 0; targetIndex < instances.length; targetIndex += 1) {
    if (targetIndex === input.ignoreInstanceIndex) continue;
    const targetInstance = instances[targetIndex]!;
    const targetDef = assetDefs.get(targetInstance.assetId);
    const targetMetadata = metadataByAssetId.get(targetInstance.assetId);
    if (!targetDef || !targetMetadata) continue;

    for (const targetSnap of propSnapPoints(targetDef, targetMetadata)) {
      const target = worldSnap(targetInstance.assetId, targetSnap, targetInstance.position, targetInstance.rotationY, targetInstance.scale);
      if (target.worldPos.distanceTo(candidatePos) > radiusM + sourceMetadata.boundingSphereRadius * input.scale) continue;
      for (const sourceSnap of sourceSnaps) {
        if (!snapAccepts(sourceSnap, target.point)) continue;
        const source = sourceOffset(sourceSnap, input.rotationY, input.scale);
        const alignment = -source.direction.dot(target.worldDirection);
        if (alignment < MIN_ALIGNMENT) continue;
        const snapped = target.worldPos.clone().sub(source.offset);
        const distanceM = snapped.distanceTo(candidatePos);
        if (distanceM > radiusM) continue;
        const score = rank(sourceSnap.group, target.point.group) * STRUCTURAL_WEIGHT + alignment + (1 - distanceM / radiusM);
        if (score <= bestScore) continue;
        bestScore = score;
        best = {
          position: tuple(snapped),
          targetAssetId: target.assetId,
          sourceSnapId: sourceSnap.id,
          targetSnapId: target.point.id,
          distanceM,
        };
      }
    }
  }
  return best;
}
