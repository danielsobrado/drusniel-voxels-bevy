// WebGPU post-processing: scene render target -> exposure/contrast/saturation/vignette -> tone map/output.

import * as THREE from "three";
import { ColorManagement } from "three";
import { NodeMaterial, QuadMesh, type WebGPURenderer } from "three/webgpu";
import {
  clamp,
  dot,
  length,
  max,
  mix,
  renderOutput,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3,
  vec4,
} from "three/tsl";
import {
  DEFAULT_POST_PROCESS_SETTINGS,
  type PostProcessSettings,
} from "../environment/postprocess.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type TslNode = any;

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
  private readonly renderer: WebGPURenderer;
  private readonly target: THREE.RenderTarget;
  private readonly quad: QuadMesh;
  private readonly material: NodeMaterial;
  private readonly drawingBufferSize = new THREE.Vector2();
  private readonly uOpacity = uniform(DEFAULT_POST_PROCESS_SETTINGS.opacity);
  private readonly uExposure = uniform(DEFAULT_POST_PROCESS_SETTINGS.exposure);
  private readonly uContrast = uniform(DEFAULT_POST_PROCESS_SETTINGS.contrast);
  private readonly uSaturation = uniform(DEFAULT_POST_PROCESS_SETTINGS.saturation);
  private readonly uVignette = uniform(DEFAULT_POST_PROCESS_SETTINGS.vignette);
  private settings: PostProcessSettings;

  constructor(
    renderer: WebGPURenderer,
    _scene: THREE.Scene,
    _camera: THREE.Camera,
    settings: Partial<PostProcessSettings> = {},
  ) {
    this.renderer = renderer;
    this.settings = { ...DEFAULT_POST_PROCESS_SETTINGS, ...settings };
    // Single-sample RT: MSAA offscreen targets are not sampleable in the composite pass on WebGPU.
    this.target = new THREE.RenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
      type: renderer.getOutputBufferType(),
      colorSpace: ColorManagement.workingColorSpace,
    });
    this.target.texture.name = "clod-poc-webgpu-postprocess-color";

    this.material = new NodeMaterial();
    this.material.name = "clod-poc-webgpu-postprocess";
    this.quad = new QuadMesh(this.material);
    this.quad.name = "clod-poc-webgpu-postprocess-quad";

    this.updateSettings(this.settings);
    this.rebuildComposite();
  }

  setSize(width?: number, height?: number): void {
    if (width === undefined || height === undefined) {
      const css = new THREE.Vector2();
      this.renderer.getSize(css);
      width = css.x;
      height = css.y;
    }
    this.renderer.getDrawingBufferSize(this.drawingBufferSize);
    const pixelRatio = this.renderer.getPixelRatio();
    const targetWidth = this.drawingBufferSize.x || Math.floor(width * pixelRatio);
    const targetHeight = this.drawingBufferSize.y || Math.floor(height * pixelRatio);
    this.target.setSize(Math.max(1, targetWidth), Math.max(1, targetHeight));
  }

  updateSettings(settings: Partial<PostProcessSettings>): void {
    const modeChanged = postProcessOutputGraphDirty(this.settings, settings);
    this.settings = { ...this.settings, ...settings };
    this.uOpacity.value = this.settings.opacity;
    this.uExposure.value = this.settings.exposure;
    this.uContrast.value = this.settings.contrast;
    this.uSaturation.value = this.settings.saturation;
    this.uVignette.value = this.settings.vignette;
    if (modeChanged) this.rebuildComposite();
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (!this.settings.enabled || this.settings.debugMode === "off") {
      this.renderer.render(scene, camera);
      return;
    }

    const renderer = this.renderer;
    const toneMapping = renderer.toneMapping;
    const outputColorSpace = renderer.outputColorSpace;
    const currentRenderTarget = renderer.getRenderTarget();
    const currentXr = renderer.xr.enabled;

    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = ColorManagement.workingColorSpace;
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(currentRenderTarget);
    renderer.xr.enabled = currentXr;

    // Keep the renderer linear during the composite; renderOutput() in the quad applies tone mapping.
    this.quad.render(renderer);

    renderer.toneMapping = toneMapping;
    renderer.outputColorSpace = outputColorSpace;
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }

  private rebuildComposite(): void {
    const sampled: TslNode = texture(this.target.texture, uv());
    let output: TslNode;
    if (!this.settings.enabled || this.settings.debugMode === "off") {
      output = sampled;
    } else if (this.settings.debugMode === "copy") {
      output = vec4(sampled.rgb, sampled.a.mul(this.uOpacity));
    } else {
      output = this.outputNode(sampled);
    }
    this.material.fragmentNode = renderOutput(
      output,
      this.renderer.toneMapping,
      this.renderer.outputColorSpace,
    );
    this.material.needsUpdate = true;
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
