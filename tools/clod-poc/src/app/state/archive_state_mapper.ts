import type { ClodProjectManifest } from "../../project_archive.js";
import type { AppStateSlices } from "./types.js";
import { applyBrushArchiveState } from "./brush_state.js";
import { applyClodArchiveState } from "./clod_state.js";
import { applyEnvironmentArchiveState } from "./environment_state.js";
import { applyTerrainMaterialArchiveState } from "./terrain_material_state.js";
import { applyVegetationArchiveState } from "./vegetation_state.js";
import { applyWaterArchiveState } from "./water_state.js";
import { applyWeatherArchiveState } from "./weather_state.js";

export function applyValidatedArchiveState(slices: AppStateSlices, manifest: ClodProjectManifest): void {
  applyClodArchiveState(slices.clod, manifest.state);
  applyTerrainMaterialArchiveState(slices.terrainMaterial, manifest.state);
  applyBrushArchiveState(slices.brush, manifest.state);
  applyEnvironmentArchiveState(slices.environment, manifest.state);
  applyVegetationArchiveState(slices.vegetation, manifest.state);
  applyWaterArchiveState(slices.water, manifest.water);
  applyWeatherArchiveState(slices.weather, manifest.weather);
}
