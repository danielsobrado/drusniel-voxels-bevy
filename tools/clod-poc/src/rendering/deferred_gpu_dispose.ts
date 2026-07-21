import { getActiveWebGpuRendererContext } from "./webgpu_renderer_context.js";

/**
 * Run a disposal after the GPU has drained the work already submitted.
 *
 * Disposing three.js geometries/materials frees their GPU buffers immediately. When that
 * happens mid-frame — e.g. a settings toggle swaps the tree ring's geometry and disposes
 * the previous one — the buffers are released while the previous frame's submitted draw
 * still references them, and the WebGPU backend reports
 * "[Buffer (unlabeled)] used in submit while destroyed" (often followed by a black frame
 * and zero-vertex draws as the ring repopulates).
 *
 * Deferring until `queue.onSubmittedWorkDone()` resolves keeps the resources alive until
 * every in-flight submit has completed. Falls back to disposing immediately when there is
 * no active WebGPU device (WebGL path, tests, or a torn-down renderer).
 */
let deferredDepth = 0;

/** True while a deferred disposal is running, so diagnostics can ignore safe frees. */
export function isRunningDeferredGpuDispose(): boolean {
  return deferredDepth > 0;
}

export function disposeAfterGpuIdle(dispose: () => void): void {
  const run = (): void => {
    deferredDepth++;
    try {
      dispose();
    } finally {
      deferredDepth--;
    }
  };
  const device = getActiveWebGpuRendererContext()?.device;
  if (!device) {
    run();
    return;
  }
  void device.queue.onSubmittedWorkDone().then(run, run);
}
