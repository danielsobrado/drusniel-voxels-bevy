import type { WebGPURenderer } from "three/webgpu";
import type { AppRenderer } from "./renderer_backend.js";

let currentRenderer: WebGPURenderer | null = null;
let currentDevice: GPUDevice | null = null;

export function getRendererGpuDevice(app: AppRenderer): GPUDevice | null {
  if (!app.isWebGpu) {
    currentRenderer = null;
    currentDevice = null;
    return null;
  }
  currentRenderer = app.renderer;
  currentDevice = (app.renderer.backend as unknown as { device?: GPUDevice }).device ?? null;
  if (!currentDevice) {
    console.warn("[webgpu-device-bridge] WebGPU renderer present but no GPUDevice exposed on backend");
  }
  return currentDevice;
}

export function getCurrentWebGpuRenderer(): WebGPURenderer | null {
  return currentRenderer;
}

export function getCurrentRendererGpuDevice(): GPUDevice | null {
  return currentDevice;
}
