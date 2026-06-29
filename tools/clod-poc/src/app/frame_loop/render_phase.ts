import * as THREE from "three";
import { logGrassProfile } from "../../grass/grass_profile.js";
import type { FrameLoopRenderInput } from "./frame_loop_types.js";

let gpuTimestampPending = false;
let latchedGpuRenderMs = 0;
let latchedGpuComputeMs = 0;

export function getLatchedGpuTimings(): { renderMs: number; computeMs: number } {
  return { renderMs: latchedGpuRenderMs, computeMs: latchedGpuComputeMs };
}

export function renderFrame(input: FrameLoopRenderInput): void {
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

  // [DEBUG-bs9f] temporary: resolve GPU render/compute pass timings (requires trackTimestamp; perfProbe only).
  // Fully defensive: must never crash the frame loop even if timestamps are unsupported.
  if (input.perfProbe && !gpuTimestampPending) {
    try {
      const gpuRenderer = input.renderer as unknown as {
        resolveTimestampsAsync?: (query: string | number) => Promise<void>;
        info?: { render?: { timestamp?: number }; compute?: { timestamp?: number } };
      };
      if (typeof gpuRenderer.resolveTimestampsAsync === "function") {
        gpuTimestampPending = true;
        Promise.all([
          gpuRenderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER),
          gpuRenderer.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE),
        ])
          .then(() => {
            latchedGpuRenderMs = gpuRenderer.info?.render?.timestamp ?? 0;
            latchedGpuComputeMs = gpuRenderer.info?.compute?.timestamp ?? 0;
          })
          .catch(() => { /* timestamp-query unsupported; leave latched values */ })
          .finally(() => { gpuTimestampPending = false; });
      }
    } catch {
      gpuTimestampPending = false; // resolveTimestampsAsync threw synchronously; ignore.
    }
  }

  const hooks = input.getHooks();
  if (hooks && !hooks.ready) {
    hooks.ready = true;
  }
}
