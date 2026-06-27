import type * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  type PostProcessSettings,
} from "../environment/postprocess.js";

/** True when the post-process output graph must be recompiled. */
export function postProcessOutputGraphDirty(
  current: PostProcessSettings,
  settings: Partial<PostProcessSettings>,
): boolean {
  return (
    (settings.enabled !== undefined && settings.enabled !== current.enabled) ||
    (settings.debugMode !== undefined && settings.debugMode !== current.debugMode)
  );
}

export class WebGpuPostProcessPipeline {
  private settings: PostProcessSettings;

  constructor(
    private readonly renderer: WebGPURenderer,
    _scene: THREE.Scene,
    _camera: THREE.Camera,
    settings: Partial<PostProcessSettings> = {},
  ) {
    this.settings = { ...DEFAULT_POST_PROCESS_SETTINGS, ...settings };
    console.warn("[webgpu] postprocess disabled: Three WebGPU cannot safely sample its render target in this path yet");
  }

  setSize(_width?: number, _height?: number): void {
    // WebGPU postprocess is disabled; keep the method for renderer startup parity.
  }

  updateSettings(settings: Partial<PostProcessSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderer.render(scene, camera);
  }

  dispose(): void {
    // No GPU resources are allocated while the WebGPU postprocess path is disabled.
  }
}
