import * as THREE from "three";
import type { BrushSettings, EditorMode } from "../../types/editor";
import type { BlockType } from "../../types/world";

export interface PendingVoxelEdit {
  readonly id: string;
  readonly position: [number, number, number];
  readonly block: BlockType;
  readonly status: "pending" | "applied" | "rejected";
  readonly message?: string;
}

export const shouldShowBrushPreview = (activeMode: EditorMode) => activeMode === "voxel_sculpt" || activeMode === "voxel_paint";

export const buildAffectedVoxelPositions = (
  brushSettings: BrushSettings,
  targetedVoxel: readonly [number, number, number],
  activeMode: EditorMode,
): readonly THREE.Vector3[] => {
  if (!shouldShowBrushPreview(activeMode)) {
    return [];
  }

  const affected: THREE.Vector3[] = [];
  if (brushSettings.brushShape === "single") {
    return [new THREE.Vector3(targetedVoxel[0] + 0.5, targetedVoxel[1] + 0.5, targetedVoxel[2] + 0.5)];
  }

  const previewStep = Math.max(1, Math.round(brushSettings.radius / 3));

  for (let x = -previewStep; x <= previewStep; x += previewStep) {
    for (let z = -previewStep; z <= previewStep; z += previewStep) {
      const distance = Math.sqrt(x * x + z * z);
      if (brushSettings.brushShape === "sphere" && distance > previewStep * 1.35) {
        continue;
      }
      affected.push(new THREE.Vector3(targetedVoxel[0] + x + 0.5, targetedVoxel[1] + 0.5, targetedVoxel[2] + z + 0.5));
    }
  }

  return affected;
};
