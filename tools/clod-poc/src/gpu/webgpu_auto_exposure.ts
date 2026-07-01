import { type WebGPURenderer } from "three/webgpu";
import {
  Fn,
  If,
  Return,
  clamp,
  exp2,
  float,
  instanceIndex,
  instancedArray,
  log2,
  luminance,
  mix,
  texture,
  vec2,
} from "three/tsl";
import {
  autoExposureWeightTotal,
  centerMeterWeight,
  type PostFxAutoExposureSettings,
} from "./postfx_auto_exposure.js";
import type { TslAny } from "./webgpu_postprocess_nodes.js";

const tslMix = mix as unknown as (a: TslAny, b: TslAny, amount: TslAny) => TslAny;

export class WebGpuAutoExposureMeter {
  private exposureBuffer: TslAny | null = null;
  private exposureKernel: TslAny | null = null;
  private errorReported = false;

  constructor(
    private readonly renderer: WebGPURenderer,
    private readonly settings: PostFxAutoExposureSettings,
    private readonly enabled: boolean,
    private readonly lock: boolean,
  ) {}

  get exposureNode(): TslAny {
    return this.enabled && this.exposureBuffer
      ? this.exposureBuffer.element(0)
      : float(1);
  }

  configure(beauty: TslAny): void {
    this.exposureKernel = null;
    if (!this.enabled) return;
    this.ensureBuffer();
    this.exposureKernel = this.createKernel(beauty);
    this.exposureKernel.setName?.("autoExposure");
  }

  meter(): void {
    if (this.lock || !this.exposureKernel) return;
    this.runCompute(this.exposureKernel, false);
  }

  clearKernel(): void {
    this.exposureKernel = null;
  }

  private ensureBuffer(): void {
    if (this.exposureBuffer) return;
    this.exposureBuffer = instancedArray(2, "float") as TslAny;
    const exposureBuffer = this.exposureBuffer;
    const initKernel = Fn((): void => {
      exposureBuffer.element(0).assign(1);
      exposureBuffer.element(1).assign(1);
    })().compute(1);
    this.runCompute(initKernel, true);
  }

  private createKernel(beauty: TslAny): TslAny {
    const exposureBuffer = this.exposureBuffer as TslAny;
    const samples = this.settings.samplesPerAxis;
    const weightTotal = autoExposureWeightTotal(samples, this.settings.centerWeightStrength);

    return Fn((): void => {
      If(instanceIndex.greaterThanEqual(1), () => {
        Return();
      });
      const logSum = float(0).toVar();
      for (let gy = 0; gy < samples; gy++) {
        for (let gx = 0; gx < samples; gx++) {
          const u = (gx + 0.5) / samples;
          const v = (gy + 0.5) / samples;
          const weight = centerMeterWeight(u, v, this.settings.centerWeightStrength);
          const color = texture(beauty.value, vec2(u, v)).rgb;
          const lum = luminance(color).max(1e-4);
          logSum.addAssign(log2(lum).mul(weight));
        }
      }
      const averageLum = exp2(logSum.div(weightTotal));
      const target = clamp(float(this.settings.targetLuminance).div(averageLum), this.settings.minExposure, this.settings.maxExposure);
      const previous = exposureBuffer.element(0);
      exposureBuffer.element(0).assign(tslMix(previous, target, this.settings.adaptationRate));
    })().compute(1);
  }

  private runCompute(kernel: TslAny, preferAsync: boolean): void {
    const renderer = this.renderer as unknown as {
      compute?: (node: TslAny) => void;
      computeAsync?: (node: TslAny) => Promise<unknown>;
    };
    try {
      if (preferAsync && renderer.computeAsync) {
        void renderer.computeAsync(kernel).catch((error: unknown) => this.reportError(error));
        return;
      }
      renderer.compute?.(kernel);
    } catch (error) {
      this.reportError(error);
    }
  }

  private reportError(error: unknown): void {
    if (this.errorReported) return;
    this.errorReported = true;
    console.warn("[webgpu-post] auto-exposure compute failed; continuing with last exposure", error);
  }
}
