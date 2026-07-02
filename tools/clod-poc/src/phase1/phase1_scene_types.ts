import type { Phase1DebugMode } from "./phase1_config.js";

export interface Phase1SceneParams {
  seed: number;
  worldPages: number;
  terrainGrid: number;
  debugMode: Phase1DebugMode;
  freeze: boolean;
  hud: boolean;
  dpr: number | null;
  cam: string | null;
  coastGui: boolean;
}
