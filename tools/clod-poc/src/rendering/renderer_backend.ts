// Phase B of the WebGPU make-default plan (docs/webgpu-make-default-plan.md).
//
// Renderer-backend seam for the real app. The app selects a backend with
// `?renderer=webgpu|webgl` (default webgpu) and creates the matching renderer here, so the
// rest of main.ts depends on a small surface (renderer + maxAnisotropy) instead of
// `new THREE.WebGLRenderer` directly. The WebGPU app boot itself lands in Phase B-2.

import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { installPositionInvariance } from "./veg_prepass.js";

export type RendererBackend = "webgl" | "webgpu";

export function parseRendererBackend(params: URLSearchParams): RendererBackend {
  return params.get("renderer") === "webgl" ? "webgl" : "webgpu";
}

export interface WebGlAppRenderer {
  isWebGpu: false;
  renderer: THREE.WebGLRenderer;
  /** Max texture anisotropy for this backend (queried on WebGL). */
  maxAnisotropy: number;
}

export interface WebGpuAppRenderer {
  isWebGpu: true;
  renderer: WebGPURenderer;
  maxAnisotropy: number;
}

export type AppRenderer = WebGlAppRenderer | WebGpuAppRenderer;

export function createWebGlAppRenderer(): WebGlAppRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  return { isWebGpu: false, renderer, maxAnisotropy: renderer.capabilities.getMaxAnisotropy() };
}

export async function createWebGpuAppRenderer(): Promise<WebGpuAppRenderer> {
  const renderer = new WebGPURenderer({ antialias: true });
  await renderer.init();
  installPositionInvariance(renderer);
  // fail-loud: surface WebGPU validation errors instead of silent black frames.
  const device = (renderer.backend as unknown as { device?: GPUDevice }).device;
  if (device) {
    let reported = 0;
    device.onuncapturederror = (e: GPUUncapturedErrorEvent): void => {
      if (reported++ < 8) console.error("[webgpu] uncaptured error:", e.error.message);
    };
  }
  // WebGPU exposes a high anisotropy limit; 16 matches typical hardware and the WebGL default.
  return { isWebGpu: true, renderer, maxAnisotropy: 16 };
}
