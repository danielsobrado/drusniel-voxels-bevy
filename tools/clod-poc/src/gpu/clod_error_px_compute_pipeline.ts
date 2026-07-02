import type { WebGpuUnavailable } from "./webgpu_device.js";
import { requestWebGpuDevice } from "./webgpu_device.js";
import commonShader from "./shaders/clod_common.wgsl?raw";
import computeShader from "./shaders/webgpu_error_px.compute.wgsl?raw";

export interface ClodPipelineCreateResult {
  device: GPUDevice;
  pipeline: GPUComputePipeline;
}

export async function createClodErrorPxPipeline(sharedDevice?: GPUDevice): Promise<ClodPipelineCreateResult & { unavailable: null } | { device: null; pipeline: null; unavailable: WebGpuUnavailable }> {
  let device = sharedDevice ?? null;
  if (!device) {
    const deviceResult = await requestWebGpuDevice();
    if (!deviceResult.ok) return { device: null, pipeline: null, unavailable: deviceResult };
    device = deviceResult.device;
  }

  const shader = device.createShaderModule({
    label: "clod error px shader",
    code: `${commonShader}\n${computeShader}`,
  });
  const pipeline = await device.createComputePipelineAsync({
    label: "clod error px pipeline",
    layout: "auto",
    compute: {
      module: shader,
      entryPoint: "compute_clod_error_px",
    },
  });
  return { device, pipeline, unavailable: null };
}
