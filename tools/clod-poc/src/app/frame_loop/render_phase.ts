import * as THREE from "three";
import type { ClodHooks } from "../../core/hooks.js";
import type { GrassStats } from "../../grass.js";
import type { PostProcessSettings } from "../../environment/postprocess.js";
import type { NodeLabelOverlay } from "../../ui/node_labels.js";
import type { AppPostProcess } from "../app_post_process.js";
import type { NearFieldBubbleController } from "../../terrain/near_field/near_field_bubble_controller.js";
import type { ClodSelectionController } from "../../terrain/selection/clod_selection_controller.js";
import type { PlayerInteractionState } from "../../player_controller.js";
import type { FrameRenderer } from "./frame_renderer.js";

export interface RenderPhaseInput {
  renderer: FrameRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  postProcess: AppPostProcess | null;
  currentPostProcessSettings: () => PostProcessSettings;
  nodeLabelOverlay: NodeLabelOverlay;
  selectionController: ClodSelectionController;
  getHooks: () => ClodHooks | null;
  longViewSettleWaiters: { frames: number; resolve: () => void }[];
  frameStart: number;
  profileEnabled: boolean;
  profileFrameMs: number;
  grassProfileEnabled: boolean;
  grassProfileFrame: { value: number };
  currentGrassStats: GrassStats | null;
  tPropsStart: number;
  tBubbleStart: number;
  chunkGroupsBuiltThisFrame: number;
  nearFieldBubbleController: NearFieldBubbleController;
  interaction: PlayerInteractionState;
  makeGrassSettings: () => import("../../grass.js").GrassSettings;
  grassPrepassEnabled: boolean;
}

const grassProfileMs = (value: number | null): string => value === null ? "-" : `${value.toFixed(2)}ms`;

function logGrassProfile(
  stats: GrassStats,
  grassAndPropsMs: number,
  grassProfileEnabled: boolean,
  makeGrassSettings: () => import("../../grass.js").GrassSettings,
  grassPrepassEnabled: boolean,
): void {
  if (!grassProfileEnabled) return;
  const settings = makeGrassSettings();
  const visible = stats.gpuRingVisibleNear
    + stats.gpuRingVisibleMid
    + stats.gpuRingVisibleFar
    + stats.gpuRingVisibleSuper;
  // eslint-disable-next-line no-console
  console.info(
    `[grass-profile] mode=${stats.mode}` +
      ` dispatch=${grassProfileMs(stats.gpuRingDispatchMs)}` +
      ` readback=${grassProfileMs(stats.gpuRingReadbackMs)}` +
      ` visible=${visible}` +
      ` near=${stats.gpuRingVisibleNear}` +
      ` mid=${stats.gpuRingVisibleMid}` +
      ` far=${stats.gpuRingVisibleFar}` +
      ` super=${stats.gpuRingVisibleSuper}` +
      ` prepass=${grassPrepassEnabled ? "on" : "off"}` +
      ` grid=${settings.ring.grid}` +
      ` cell=${settings.ring.cell}` +
      ` slots=${settings.ring.grid * settings.ring.grid}` +
      ` grass+props=${grassAndPropsMs.toFixed(2)}ms`,
  );
}

export function runRenderPhase(input: RenderPhaseInput): void {
  const selectionStats = input.selectionController.stats();
  input.nodeLabelOverlay.update({
    nodes: selectionStats.renderedNodes,
    camera: input.camera,
    viewport: input.renderer.domElement,
    viewportHeight: input.renderer.domElement.height,
    fovY: THREE.MathUtils.degToRad(input.camera.fov),
  });
  input.postProcess?.updateSettings(input.currentPostProcessSettings());
  const tRenderStart = performance.now();
  if (input.grassProfileEnabled && input.currentGrassStats && input.grassProfileFrame.value++ % 60 === 0) {
    logGrassProfile(
      input.currentGrassStats,
      tRenderStart - input.tPropsStart,
      input.grassProfileEnabled,
      input.makeGrassSettings,
      input.grassPrepassEnabled,
    );
  }
  if (input.postProcess) input.postProcess.render(input.scene, input.camera);
  else input.renderer.render(input.scene, input.camera);

  const hooks = input.getHooks();
  if (hooks && !hooks.ready) {
    hooks.ready = true;
    hooks.progress = 1;
    hooks.progressMsg = "ready";
  }

  for (const waiter of input.longViewSettleWaiters) waiter.frames -= 1;
  const doneWaiters = input.longViewSettleWaiters.filter((w) => w.frames <= 0);
  for (const waiter of doneWaiters) waiter.resolve();
  for (const waiter of doneWaiters) {
    const index = input.longViewSettleWaiters.indexOf(waiter);
    if (index >= 0) input.longViewSettleWaiters.splice(index, 1);
  }

  if (input.profileEnabled) {
    const end = performance.now();
    const frameMs = end - input.frameStart;
    if (frameMs >= input.profileFrameMs) {
      const bubbleMs = input.tPropsStart - input.tBubbleStart;
      const propsMs = tRenderStart - input.tPropsStart;
      const renderMs = end - tRenderStart;
      const otherMs = frameMs - selectionStats.selectionMs - bubbleMs - propsMs - renderMs;
      // eslint-disable-next-line no-console
      console.warn(
        `[profile] frame ${frameMs.toFixed(1)}ms` +
          ` | selection ${selectionStats.selectionMs.toFixed(1)}` +
          ` (cut ${selectionStats.subphases.cut.toFixed(1)} book ${selectionStats.subphases.book.toFixed(1)} info ${selectionStats.subphases.info.toFixed(1)} overlays ${selectionStats.subphases.overlays.toFixed(1)})` +
          ` bubble/chunks ${bubbleMs.toFixed(1)} (built ${input.chunkGroupsBuiltThisFrame})` +
          ` props ${propsMs.toFixed(1)}` +
          ` render ${renderMs.toFixed(1)}` +
          ` other ${otherMs.toFixed(1)}` +
          ` | cut=${selectionStats.renderedCount} chunkGroups=${input.nearFieldBubbleController.size()} mode=${input.interaction.mode}`,
      );
    }
  }
}
