import type { WebGPURenderer } from "three/webgpu";
import type { AppRenderer } from "./renderer_backend.js";

let currentRenderer: WebGPURenderer | null = null;

export function getRendererGpuDevice(app: AppRenderer): GPUDevice | null {
  if (!app.isWebGpu) {
    currentRenderer = null;
    return null;
  }
  currentRenderer = app.renderer;
  const device = (app.renderer.backend as unknown as { device?: GPUDevice }).device ?? null;
  if (!device) {
    console.warn("[webgpu-device-bridge] WebGPU renderer present but no GPUDevice exposed on backend");
  }
  return device;
}

export function getCurrentWebGpuRenderer(): WebGPURenderer | null {
  return currentRenderer;
}
