// WebGPU post-processing for the isolated preview path. This mirrors src/postprocess.ts:
// scene pass -> exposure/contrast/saturation/vignette -> renderer tone mapping/output color.

import * as THREE from "three";
import { RenderPipeline, type WebGPURenderer } from "three/webgpu";
import {
  clamp,
  dot,
  length,
  max,
  mix,
  pass,
  smoothstep,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  type PostProcessSettings,
} from "../postprocess.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

export class WebGpuPostProcessPipeline {
  private readonly renderer: WebGPURenderer;
  private readonly pipeline: RenderPipeline;
  private readonly scenePass: ReturnType<typeof pass>;
  private readonly uOpacity = uniform(DEFAULT_POST_PROCESS_SETTINGS.opacity);
  private readonly uExposure = uniform(DEFAULT_POST_PROCESS_SETTINGS.exposure);
  private readonly uContrast = uniform(DEFAULT_POST_PROCESS_SETTINGS.contrast);
  private readonly uSaturation = uniform(DEFAULT_POST_PROCESS_SETTINGS.saturation);
  private readonly uVignette = uniform(DEFAULT_POST_PROCESS_SETTINGS.vignette);
  private settings: PostProcessSettings;

  constructor(
    renderer: WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    settings: Partial<PostProcessSettings> = {},
  ) {
    this.renderer = renderer;
    this.settings = { ...DEFAULT_POST_PROCESS_SETTINGS, ...settings };
    this.scenePass = pass(scene, camera, {
      depthBuffer: true,
      stencilBuffer: false,
      samples: 4,
    });
    this.pipeline = new RenderPipeline(renderer);
    // updateSettings() rebuilds the output graph (mode keys are defined here), so no
    // separate rebuildOutput() call is needed.
    this.updateSettings(this.settings);
  }

  /** Resize the offscreen scene-pass target to match the renderer's drawing buffer. */
  setSize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.scenePass.setSize(size.x, size.y);
  }

  updateSettings(settings: Partial<PostProcessSettings>): void {
    const modeChanged = settings.enabled !== undefined || settings.debugMode !== undefined;
    this.settings = { ...this.settings, ...settings };
    this.uOpacity.value = this.settings.opacity;
    this.uExposure.value = this.settings.exposure;
    this.uContrast.value = this.settings.contrast;
    this.uSaturation.value = this.settings.saturation;
    this.uVignette.value = this.settings.vignette;
    if (modeChanged) this.rebuildOutput();
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.settings.enabled || this.settings.debugMode === "off") {
      this.renderer.render(scene, camera);
      return;
    }
    this.pipeline.render();
  }

  dispose(): void {
    this.scenePass.dispose();
    this.pipeline.dispose();
  }

  private rebuildOutput(): void {
    const sampled: TslNode = this.scenePass.getTextureNode("output");
    if (!this.settings.enabled || this.settings.debugMode === "off") {
      this.pipeline.outputNode = sampled;
    } else if (this.settings.debugMode === "copy") {
      this.pipeline.outputNode = vec4(sampled.rgb, sampled.a.mul(this.uOpacity));
    } else {
      this.pipeline.outputNode = this.outputNode(sampled);
    }
    this.pipeline.needsUpdate = true;
  }

  private outputNode(sampled: TslNode): TslNode {
    let color: TslNode = sampled.rgb.mul(this.uExposure);
    color = color.sub(0.5).mul(this.uContrast).add(0.5);

    const luma: TslNode = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(vec3(luma), color, this.uSaturation);

    const center: TslNode = uv().sub(0.5);
    const vignetteMask: TslNode = smoothstep(0.2, 0.75, length(center));
    color = color.mul(this.uVignette.mul(vignetteMask).oneMinus());
    color = max(color, vec3(0));

    return vec4(color, clamp(sampled.a, 0.0, 1.0));
  }
}
