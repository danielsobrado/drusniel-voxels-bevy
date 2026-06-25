import * as THREE from "three";
import type { ClodNodeId, ClodPageNodeRuntime } from "../runtime/clodRuntimeTypes.js";
import type { StressSceneName, StressSceneParams } from "./stressSceneConfig.js";
import { buildRidgeBorderScene } from "./ridgeBorderScene.js";
import { buildCliffCornerScene } from "./cliffCornerScene.js";
import { buildCaveMouthBorderScene } from "./caveMouthBorderScene.js";
import { buildThinBridgeScene } from "./thinBridgeScene.js";
import { buildNearFieldBubbleScene } from "./nearFieldBubbleScene.js";
import { buildBorderBeachScene } from "../../scenes/stress/borderBeachScene.js";
import { buildBorderCliffScene } from "../../scenes/stress/borderCliffScene.js";
import { buildBorderCoveScene } from "../../scenes/stress/borderCoveScene.js";
import { buildBorderCornerScene } from "../../scenes/stress/borderCornerScene.js";

export interface StressSceneResult {
  rootNodeIds: ClodNodeId[];
  nodes: Map<ClodNodeId, ClodPageNodeRuntime>;
}

const SCENE_BUILDERS: Record<string, (scene: THREE.Scene, params: StressSceneParams) => { rootNodeIds: ClodNodeId[]; nodes: Map<ClodNodeId, ClodPageNodeRuntime> }> = {
  ridge_border: buildRidgeBorderScene,
  cliff_corner: buildCliffCornerScene,
  cave_mouth_border: buildCaveMouthBorderScene,
  thin_bridge: buildThinBridgeScene,
  near_field_bubble: buildNearFieldBubbleScene,
  border_beach: buildBorderBeachScene,
  border_cliff: buildBorderCliffScene,
  border_cove: buildBorderCoveScene,
  border_corner: buildBorderCornerScene,
};

export function buildStressScene(
  sceneName: StressSceneName,
  scene: THREE.Scene,
  params: StressSceneParams,
): StressSceneResult {
  const builder = SCENE_BUILDERS[sceneName];
  if (!builder) {
    throw new Error(`Unknown stress scene: ${sceneName}`);
  }
  return builder(scene, params);
}
