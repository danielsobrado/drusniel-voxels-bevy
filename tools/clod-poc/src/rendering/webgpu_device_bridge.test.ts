import { describe, expect, it, vi } from "vitest";
import {
  getCurrentRendererGpuDevice,
  getCurrentWebGpuRenderer,
  getRendererGpuDevice,
} from "./webgpu_device_bridge.js";
import type { AppRenderer } from "./renderer_backend.js";

function webglApp(): AppRenderer {
  return { isWebGpu: false, renderer: {} as never, maxAnisotropy: 8 };
}

function webgpuApp(device?: GPUDevice): AppRenderer {
  return {
    isWebGpu: true,
    renderer: { backend: device !== undefined ? { device } : {} } as never,
    maxAnisotropy: 16,
  };
}

describe("getRendererGpuDevice", () => {
  it("returns null for WebGL renderer and clears the shared renderer state", () => {
    expect(getRendererGpuDevice(webglApp())).toBeNull();
    expect(getCurrentRendererGpuDevice()).toBeNull();
    expect(getCurrentWebGpuRenderer()).toBeNull();
  });

  it("returns and retains the device for the active WebGPU renderer", () => {
    const fakeDevice = { label: "fake" } as unknown as GPUDevice;
    const app = webgpuApp(fakeDevice);
    expect(getRendererGpuDevice(app)).toBe(fakeDevice);
    expect(getCurrentRendererGpuDevice()).toBe(fakeDevice);
    expect(getCurrentWebGpuRenderer()).toBe(app.renderer);
  });

  it("returns null when WebGPU renderer has no device exposed", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getRendererGpuDevice(webgpuApp())).toBeNull();
    expect(getCurrentRendererGpuDevice()).toBeNull();
    consoleSpy.mockRestore();
  });

  it("logs a warning when WebGPU renderer has no device", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    getRendererGpuDevice(webgpuApp());
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("WebGPU renderer present but no GPUDevice exposed"),
    );
    consoleSpy.mockRestore();
  });
});
