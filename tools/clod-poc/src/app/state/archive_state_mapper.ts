import {
  validateProjectWaterArchiveState,
  validateProjectWeatherArchiveState,
} from "../../project/project_archive_environment_state.js";
import { validateProjectSessionState } from "../../project/project_archive_session_state.js";
import type { VoxelProjectManifest } from "../../project/voxel_project_archive.js";
import type { AppStateSlices } from "./types.js";
import { applyBrushArchiveState } from "./brush_state.js";
import { applyClodArchiveState } from "./clod_state.js";
import { applyEnvironmentArchiveState } from "./environment_state.js";
import { applyTerrainMaterialArchiveState } from "./terrain_material_state.js";
import { applyVegetationArchiveState } from "./vegetation_state.js";
import { applyWaterArchiveState } from "./water_state.js";
import { applyWeatherArchiveState } from "./weather_state.js";

export function applyValidatedArchiveState(slices: AppStateSlices, manifest: VoxelProjectManifest): void {
  const state = validateProjectSessionState(manifest.state);
  applyClodArchiveState(slices.clod, state);
  applyTerrainMaterialArchiveState(slices.terrainMaterial, state);
  applyBrushArchiveState(slices.brush, state);
  applyEnvironmentArchiveState(slices.environment, state);
  applyVegetationArchiveState(slices.vegetation, state);
  applyWaterArchiveState(slices.water, validateProjectWaterArchiveState(manifest.water));
  applyWeatherArchiveState(slices.weather, validateProjectWeatherArchiveState(manifest.weather));
}
