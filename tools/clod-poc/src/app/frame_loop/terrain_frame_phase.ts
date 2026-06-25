import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PlayerController, PlayerInteractionState } from "../../player_controller.js";
import type { NearFieldBubbleController, NearFieldBubbleView } from "../../terrain/near_field/near_field_bubble_controller.js";
import type { ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import type { ClodFrameLoopUiState } from "./ui_state.js";

interface TerrainFadeView {
  fade: number;
  target: number;
  mesh: THREE.Mesh;
  mat: { setFade: (fade: number, fadeIn: boolean, dither: boolean) => void };
}

export interface TerrainFramePhaseInput {
  state: ClodFrameLoopUiState;
  pageTransitionMode: string;
  crossfadeStep: number;
  interaction: PlayerInteractionState;
  player: PlayerController;
  controls: OrbitControls;
  selectionController: ClodSelectionController;
  nearFieldBubbleController: NearFieldBubbleController;
  views: Map<string, { node: { id: string } } & TerrainFadeView>;
  worldCells: number;
}

export interface TerrainFramePhaseResult {
  chunkGroupsBuiltThisFrame: number;
  tBubbleStart: number;
  tPropsStart: number;
  ringCenter: THREE.Vector3;
  grassCenter: THREE.Vector3;
}

export function runTerrainFramePhase(input: TerrainFramePhaseInput): TerrainFramePhaseResult {
  const activeTerrainViews = input.selectionController.activeTerrainViews() as Set<TerrainFadeView>;
  const currentTerrainViews = input.selectionController.currentTerrainViews();
  const selectionStats = input.selectionController.stats();

  for (const v of activeTerrainViews) {
    if (input.pageTransitionMode === "instant") {
      v.fade = v.target;
      v.mesh.visible = v.target > 0.5;
      v.mat.setFade(1, v.target > 0.5, false);
      activeTerrainViews.delete(v);
      continue;
    }

    if (v.fade < v.target) v.fade = Math.min(v.target, v.fade + input.crossfadeStep);
    else if (v.fade > v.target) v.fade = Math.max(v.target, v.fade - input.crossfadeStep);
    v.mesh.visible = v.fade > 0.001;
    v.mat.setFade(v.fade, v.target > 0.5, v.fade > 0.001 && v.fade < 0.999);
    if (v.fade === v.target) activeTerrainViews.delete(v);
  }

  const bubbleCenter = input.interaction.mode === "playing" ? input.player.position : input.controls.target;
  const bubbleStats = input.nearFieldBubbleController.update({
    enabled: input.state.bubble,
    bubbleRadius: input.state.bubbleRadius,
    bubbleCenter,
    bubbleViews: new Set([...currentTerrainViews, ...activeTerrainViews]) as unknown as Set<NearFieldBubbleView>,
    getView: (nodeId) => input.views.get(nodeId) as unknown as NearFieldBubbleView | undefined,
    frameId: selectionStats.frameId,
  });

  const tPropsStart = performance.now();
  const grassCenter = bubbleCenter;
  const ringClampMargin = 2;
  const ringCenter = new THREE.Vector3(
    THREE.MathUtils.clamp(grassCenter.x, ringClampMargin, input.worldCells - ringClampMargin),
    grassCenter.y,
    THREE.MathUtils.clamp(grassCenter.z, ringClampMargin, input.worldCells - ringClampMargin),
  );

  return {
    chunkGroupsBuiltThisFrame: bubbleStats.chunkGroupsBuiltThisFrame,
    tBubbleStart: tPropsStart - bubbleStats.bubbleMs,
    tPropsStart,
    ringCenter,
    grassCenter,
  };
}
