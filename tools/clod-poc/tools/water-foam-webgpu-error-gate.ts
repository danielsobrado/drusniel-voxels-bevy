import type { CdpPage } from "./water-harness.js";

export interface WaterFoamWebGpuErrorCheckpoints {
  readonly postStartup: number | null;
  readonly postCapture: number | null;
}

export interface WaterFoamWebGpuErrorGateResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly checkpoints: WaterFoamWebGpuErrorCheckpoints;
}

export async function readWaterFoamWebGpuErrorCount(page: CdpPage): Promise<number | null> {
  return page.evaluate<number | null>(`(() => {
    const value = window.__drusnielClod?.stats?.counters?.webgpu_uncaptured_errors;
    return Number.isInteger(value) && value >= 0 ? value : null;
  })()`);
}

export function evaluateWaterFoamWebGpuErrorGate(
  checkpoints: WaterFoamWebGpuErrorCheckpoints,
): WaterFoamWebGpuErrorGateResult {
  const failures: string[] = [];
  requireZero(failures, "post-startup WebGPU uncaptured errors", checkpoints.postStartup);
  requireZero(failures, "post-capture WebGPU uncaptured errors", checkpoints.postCapture);

  if (
    checkpoints.postStartup !== null
    && checkpoints.postCapture !== null
    && checkpoints.postCapture < checkpoints.postStartup
  ) {
    failures.push(
      `WebGPU uncaptured error counter decreased from ${checkpoints.postStartup} to ${checkpoints.postCapture}`,
    );
  }

  return {
    passed: failures.length === 0,
    failures,
    checkpoints,
  };
}

function requireZero(failures: string[], label: string, value: number | null): void {
  if (value === null) {
    failures.push(`${label} counter is unavailable`);
    return;
  }
  if (value !== 0) failures.push(`${label} ${value} did not equal 0`);
}
