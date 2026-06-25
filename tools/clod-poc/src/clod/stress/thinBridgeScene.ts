import * as THREE from "three";
import { buildTerrainForStressScene, type TerrainBuildResult } from "./stressTerrainFactory.js";
import type { StressSceneParams } from "./stressSceneConfig.js";

export function buildThinBridgeScene(
  scene: THREE.Scene,
  params: StressSceneParams,
): TerrainBuildResult {
  return buildTerrainForStressScene(
    { ...params, sceneName: "thin_bridge" },
    scene,
  );
}
