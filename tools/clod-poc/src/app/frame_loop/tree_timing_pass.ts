import * as THREE from "three";
import { tagGpu } from "../../core/gpu_profiler.js";
import type { TreeIsolatedRenderer, TreeSystem } from "../../trees/tree_system_runtime.js";

interface DebugSceneWindow extends Window {
  __drusnielScene?: THREE.Scene;
}

/**
 * Gated offscreen renders for vegetation families whose swapchain timestamps are unreliable
 * on Dawn. Runs only under `?gpuTiming=1`; normal gameplay creates no targets and pays no cost.
 */
export class TreeTimingPass {
  private readonly treeTarget: THREE.RenderTarget;
  private readonly stoneTarget: THREE.RenderTarget;
  private readonly understoryTarget: THREE.RenderTarget;
  private readonly measureScene = new THREE.Scene();

  constructor(
    private readonly renderer: TreeIsolatedRenderer,
    width: number,
    height: number,
  ) {
    this.treeTarget = timingTarget("treeMainTiming", "treeMain", width, height);
    this.stoneTarget = timingTarget("stoneMainTiming", "stoneMain", width, height);
    this.understoryTarget = timingTarget("understoryMainTiming", "understoryMain", width, height);
  }

  setSize(width: number, height: number): void {
    const safeWidth = Math.max(1, width);
    const safeHeight = Math.max(1, height);
    this.treeTarget.setSize(safeWidth, safeHeight);
    this.stoneTarget.setSize(safeWidth, safeHeight);
    this.understoryTarget.setSize(safeWidth, safeHeight);
  }

  render(treeSystem: TreeSystem, camera: THREE.Camera): void {
    treeSystem.renderIsolatedForTiming(this.renderer, this.treeTarget, camera);
    const scene = typeof window === "undefined" ? null : (window as DebugSceneWindow).__drusnielScene ?? null;
    if (!scene) return;
    this.renderNamedRoot(scene, "stones", this.stoneTarget, camera);
    this.renderNamedRoot(scene, "understory", this.understoryTarget, camera);
  }

  dispose(): void {
    this.treeTarget.dispose();
    this.stoneTarget.dispose();
    this.understoryTarget.dispose();
  }

  private renderNamedRoot(
    scene: THREE.Scene,
    name: string,
    target: THREE.RenderTarget,
    camera: THREE.Camera,
  ): void {
    const root = scene.getObjectByName(name);
    if (!root) return;
    const previousParent = root.parent;
    const previousVisible = root.visible;
    const previousTarget = this.renderer.getRenderTarget();
    root.visible = true;
    this.measureScene.add(root);
    try {
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.measureScene, camera);
    } finally {
      this.renderer.setRenderTarget(previousTarget);
      root.visible = previousVisible;
      if (previousParent) previousParent.add(root);
      else this.measureScene.remove(root);
    }
  }
}

function timingTarget(name: string, gpuLabel: string, width: number, height: number): THREE.RenderTarget {
  const target = new THREE.RenderTarget(Math.max(1, width), Math.max(1, height), { depthBuffer: true });
  target.texture.name = name;
  tagGpu(target, gpuLabel);
  return target;
}
