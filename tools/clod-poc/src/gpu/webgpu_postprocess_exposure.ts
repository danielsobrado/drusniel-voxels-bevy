import * as THREE from "three";
import type { WebGPURenderer } from "three/webgpu";
import type { EnvironmentLighting } from "../environment/environment.js";
import type { PostProcessSettings } from "../environment/postprocess.js";
import {
  DEFAULT_POSTFX_AUTO_EXPOSURE,
} from "./postfx_auto_exposure.js";
import {
  DEFAULT_POSTFX_COLOR_SCRIPT,
  DEFAULT_POSTFX_GRADE,
  gradeForLighting,
  type PostFxColorScript,
  type PostFxGradeParams,
} from "./postfx_color_script.js";
import { WebGpuAutoExposureMeter } from "./webgpu_auto_exposure.js";
import type { TslAny } from "./webgpu_postprocess_nodes.js";

const NEUTRAL_GRADE: PostFxGradeParams = {
  whiteBalance: [1.0, 1.0, 1.0],
  shadowTint: [1.0, 1.0, 1.0],
  shadowAmount: 0.0,
  highlightTint: [1.0, 1.0, 1.0],
  highlightAmount: 0.0,
  saturation: 1.0,
  contrast: 1.0,
};

type NumericUniform = { value: number };
type VectorUniform = { value: THREE.Vector3 };

export interface WebGpuPostProcessGradeUniforms {
  uSunDirection: VectorUniform;
  uContrast: NumericUniform;
  uSaturation: NumericUniform;
  uWhiteBalance: VectorUniform;
  uShadowTint: VectorUniform;
  uHighlightTint: VectorUniform;
  uShadowAmount: NumericUniform;
  uHighlightAmount: NumericUniform;
}

/** Owns auto-exposure meter plus grade / lighting metering path for the post-process façade. */
export class WebGpuPostProcessExposure {
  private readonly meter: WebGpuAutoExposureMeter;
  private readonly colorScript: PostFxColorScript = DEFAULT_POSTFX_COLOR_SCRIPT;
  private lightingErrorReported = false;

  constructor(
    renderer: WebGPURenderer,
    enabled: boolean,
    lock: boolean,
    private readonly getLighting: (() => EnvironmentLighting) | null,
  ) {
    this.meter = new WebGpuAutoExposureMeter(
      renderer,
      DEFAULT_POSTFX_AUTO_EXPOSURE,
      enabled,
      lock,
    );
  }

  get exposureNode(): TslAny {
    return this.meter.exposureNode;
  }

  configure(beauty: TslAny): void {
    this.meter.configure(beauty);
  }

  clearKernel(): void {
    this.meter.clearKernel();
  }

  meterFrame(): void {
    this.meter.meter();
  }

  resolveLighting(): EnvironmentLighting | null {
    if (!this.getLighting) return null;
    try {
      return this.getLighting();
    } catch (error) {
      if (!this.lightingErrorReported) {
        this.lightingErrorReported = true;
        console.warn("[webgpu-post] failed to read lighting for color script; using default grade", error);
      }
      return null;
    }
  }

  updateGradeUniforms(
    settings: Required<PostProcessSettings>,
    uniforms: WebGpuPostProcessGradeUniforms,
    colorScriptEnabled: boolean,
  ): void {
    const lighting = this.resolveLighting();
    if (lighting) uniforms.uSunDirection.value.copy(lighting.sunDirection).normalize();
    const grade = colorScriptEnabled
      ? (lighting ? gradeForLighting(lighting, this.colorScript) : DEFAULT_POSTFX_GRADE)
      : NEUTRAL_GRADE;
    uniforms.uContrast.value = settings.contrast * grade.contrast;
    uniforms.uSaturation.value = settings.saturation * grade.saturation;
    uniforms.uWhiteBalance.value.set(...grade.whiteBalance);
    uniforms.uShadowTint.value.set(...grade.shadowTint);
    uniforms.uHighlightTint.value.set(...grade.highlightTint);
    uniforms.uShadowAmount.value = grade.shadowAmount;
    uniforms.uHighlightAmount.value = grade.highlightAmount;
  }
}
