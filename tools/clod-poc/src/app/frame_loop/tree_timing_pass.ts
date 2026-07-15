import * as THREE from "three";
import { tagGpu } from "../../core/gpu_profiler.js";
import type { TreeIsolatedRenderer, TreeSystem } from "../../trees/tree_system_runtime.js";

/**
 * TP-1: gated offscreen render of just the tree meshes, so the tree main pass is
 * a distinctly-timeable render context. The main app draws straight to the
 * swapchain (WebGPU post-process is disabled), whose begin/end-of-pass
 * timestamps are unreliable on Dawn/RTX; an offscreen target times correctly.
 * The profiler labels this pass `r.treeMain` (via tagGpu on the target). Runs
 * only when `?gpuTiming=1` and timestamps are supported, after the
 * visible frame — zero cost in normal play.
 */
export class TreeTimingPass {
  private readonly target: THREE.RenderTarget;

  constructor(
    private readonly renderer: TreeIsolatedRenderer,
    width: number,
    height: number,
  ) {
    this.target = new THREE.RenderTarget(Math.max(1, width), Math.max(1, height), { depthBuffer: true });
    this.target.texture.name = "treeMainTiming";
    tagGpu(this.target, "treeMain");
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(1, width), Math.max(1, height));
  }

  render(treeSystem: TreeSystem, camera: THREE.Camera): void {
    treeSystem.renderIsolatedForTiming(this.renderer, this.target, camera);
  }

  dispose(): void {
    this.target.dispose();
  }
}
