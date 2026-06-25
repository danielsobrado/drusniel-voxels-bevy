import * as THREE from "three";
import { buildTerrainForStressScene, type TerrainBuildResult } from "./stressTerrainFactory.js";
import type { StressSceneParams } from "./stressSceneConfig.js";

export function buildNearFieldBubbleScene(
  scene: THREE.Scene,
  params: StressSceneParams,
): TerrainBuildResult {
  return buildTerrainForStressScene(
    { ...params, sceneName: "flat" },
    scene,
  );
}
