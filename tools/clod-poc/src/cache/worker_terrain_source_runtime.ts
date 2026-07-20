import type { TerrainSourceInputs } from "./terrainSource.js";
import {
  setGravelBarSettings,
  setGravelBedSettings,
} from "../water/gravel_bar_runtime.js";

export function installWorkerTerrainSourceRuntime(source: TerrainSourceInputs): void {
  const hydrology = source.waterConfig.hydrology;
  if (!hydrology.gravelBars || !hydrology.gravelBed) {
    throw new Error("worker terrain source is missing gravel-bed authority settings");
  }
  setGravelBarSettings(hydrology.gravelBars);
  setGravelBedSettings(hydrology.gravelBed);
}
