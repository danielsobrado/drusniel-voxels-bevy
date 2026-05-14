import * as THREE from "three";
import type { BrushSettings } from "../../types/editor";
import type { WorldSurfaceSample } from "../../types/world";

export interface PickedVoxelSelection {
  readonly position: [number, number, number];
  readonly chunkId: string;
  readonly face: "top" | "side" | "bottom";
}

export const chunkIdForVoxel = (position: readonly [number, number, number]) =>
  `chunk-${Math.floor(position[0] / 16)}-${Math.floor(position[1] / 16)}-${Math.floor(position[2] / 16)}`;

const faceFromNormal = (normal: THREE.Vector3 | null | undefined): PickedVoxelSelection["face"] => {
  if (!normal) {
    return "top";
  }

  if (normal.y > 0.45) {
    return "top";
  }

  if (normal.y < -0.45) {
    return "bottom";
  }

  return "side";
};

const applyTargetFace = (face: PickedVoxelSelection["face"], targetFace: BrushSettings["targetFace"]): PickedVoxelSelection["face"] =>
  targetFace === "all" ? face : targetFace;

export const selectionFromSample = (
  sample: WorldSurfaceSample,
  targetFace: BrushSettings["targetFace"],
  normal?: THREE.Vector3 | null,
): PickedVoxelSelection => {
  const position: [number, number, number] = [
    Math.floor(sample.x),
    Math.max(0, Math.round(sample.height)),
    Math.floor(sample.z),
  ];

  return {
    position,
    chunkId: chunkIdForVoxel(position),
    face: applyTargetFace(faceFromNormal(normal), targetFace),
  };
};

export const selectionFromPoint = (
  point: THREE.Vector3,
  targetFace: BrushSettings["targetFace"],
  normal?: THREE.Vector3 | null,
): PickedVoxelSelection => {
  const face = applyTargetFace(faceFromNormal(normal), targetFace);
  const yOffset = face === "bottom" ? -1 : 0;
  const position: [number, number, number] = [
    Math.floor(point.x),
    Math.max(0, Math.floor(point.y + yOffset)),
    Math.floor(point.z),
  ];

  return {
    position,
    chunkId: chunkIdForVoxel(position),
    face,
  };
};

export const placementFromSelection = (selection: PickedVoxelSelection): readonly [number, number, number] => [
  selection.position[0] + 0.5,
  selection.position[1] + 1,
  selection.position[2] + 0.5,
];
