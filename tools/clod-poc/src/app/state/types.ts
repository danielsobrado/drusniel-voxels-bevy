import type { BrushSliceState } from "./brush_state.js";
import type { ClodSliceState } from "./clod_state.js";
import type { EnvironmentSliceState } from "./environment_state.js";
import type { TerrainMaterialSliceState } from "./terrain_material_state.js";
import type { VegetationSliceState } from "./vegetation_state.js";
import type { WaterSliceState } from "./water_state.js";
import type { WeatherSliceState } from "./weather_state.js";

export interface AppStateSlices {
  clod: ClodSliceState;
  terrainMaterial: TerrainMaterialSliceState;
  brush: BrushSliceState;
  environment: EnvironmentSliceState;
  vegetation: VegetationSliceState;
  water: WaterSliceState;
  weather: WeatherSliceState;
}
