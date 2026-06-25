import type { ProjectSessionState } from "../../project_archive.js";
import type { AppStateSlices } from "./types.js";
import { applyBrushArchiveState } from "./brush_state.js";
import { applyClodArchiveState } from "./clod_state.js";
import { applyEnvironmentArchiveState } from "./environment_state.js";
import { applyTerrainMaterialArchiveState } from "./terrain_material_state.js";
import { applyVegetationArchiveState } from "./vegetation_state.js";

export function applyValidatedArchiveState(slices: AppStateSlices, archive: ProjectSessionState): void {
  applyClodArchiveState(slices.clod, archive);
  applyTerrainMaterialArchiveState(slices.terrainMaterial, archive);
  applyBrushArchiveState(slices.brush, archive);
  applyEnvironmentArchiveState(slices.environment, archive);
  applyVegetationArchiveState(slices.vegetation, archive);
}
