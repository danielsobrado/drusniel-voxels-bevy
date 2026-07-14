import type { WebGPURenderer } from "three/webgpu";

export interface ActiveWebGpuRendererContext {
  renderer: WebGPURenderer;
  device: GPUDevice;
}

let activeContext: ActiveWebGpuRendererContext | null = null;

export function setActiveWebGpuRendererContext(
  renderer: WebGPURenderer,
  device: GPUDevice,
): void {
  activeContext = { renderer, device };
}

export function clearActiveWebGpuRendererContext(renderer?: WebGPURenderer): void {
  if (renderer && activeContext?.renderer !== renderer) return;
  activeContext = null;
}

export function getActiveWebGpuRendererContext(): ActiveWebGpuRendererContext | null {
  return activeContext;
}
