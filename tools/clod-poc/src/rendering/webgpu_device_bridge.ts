// Safely extracts the GPUDevice from a Three.js WebGPURenderer backend.
// WebGL renderers have no WebGPU device; this helper returns null for them.

import type { AppRenderer } from "./renderer_backend.js";

export function getRendererGpuDevice(app: AppRenderer): GPUDevice | null {
  if (!app.isWebGpu) return null;
  const device = (app.renderer.backend as unknown as { device?: GPUDevice }).device ?? null;
  if (!device) {
    console.warn("[webgpu-device-bridge] WebGPU renderer present but no GPUDevice exposed on backend");
  }
  return device;
}
