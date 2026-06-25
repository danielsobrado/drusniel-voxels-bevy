import * as THREE from "three";
import { buildTerrainForStressScene, type TerrainBuildResult } from "./stressTerrainFactory.js";
import type { StressSceneParams } from "./stressSceneConfig.js";

export function buildCaveMouthBorderScene(
  scene: THREE.Scene,
  params: StressSceneParams,
): TerrainBuildResult {
  return buildTerrainForStressScene(
    { ...params, sceneName: "cave_mouth_border" },
    scene,
  );
}
