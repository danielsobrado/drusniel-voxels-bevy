import type { ProjectSessionState } from "../../project/voxel_project_archive.js";
import type { BrushOp, BrushShape } from "../../terrain/terrain.js";
import { assignArchiveFields } from "./archive_fields.js";

export interface BrushSliceState {
  digEnabled: boolean;
  digRadius: number;
  brushOp: BrushOp;
  brushShape: BrushShape;
  brushMaterial: number;
  brushHeight: number;
  brushStrength: number;
  brushFalloff: number;
  brushFlowMs: number;
}

const BRUSH_ARCHIVE_KEYS = [
  "digEnabled", "digRadius", "brushOp", "brushShape", "brushMaterial", "brushHeight",
  "brushStrength", "brushFalloff", "brushFlowMs",
] as const satisfies readonly (keyof ProjectSessionState)[];

export function createBrushSliceState(digHoldIntervalMs: number): BrushSliceState {
  return {
    digEnabled: true,
    digRadius: 3,
    brushOp: "remove",
    brushShape: "sphere",
    brushMaterial: 0,
    brushHeight: 3,
    brushStrength: 1,
    brushFalloff: 0,
    brushFlowMs: digHoldIntervalMs,
  };
}

export function applyBrushArchiveState(target: BrushSliceState, archive: ProjectSessionState): void {
  assignArchiveFields(target, archive, BRUSH_ARCHIVE_KEYS);
}
