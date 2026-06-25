import * as THREE from "three";
import { buildTerrainForStressScene, type TerrainBuildResult } from "./stressTerrainFactory.js";
import type { StressSceneParams } from "./stressSceneConfig.js";

export function buildCliffCornerScene(
  scene: THREE.Scene,
  params: StressSceneParams,
): TerrainBuildResult {
  return buildTerrainForStressScene(
    { ...params, sceneName: "cliff_corner" },
    scene,
  );
}
