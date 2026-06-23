import { describe, expect, it, vi } from "vitest";
import { getRendererGpuDevice } from "./webgpu_device_bridge.js";
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
  it("returns null for WebGL renderer", () => {
    expect(getRendererGpuDevice(webglApp())).toBeNull();
  });

  it("returns the device for WebGPU renderer with exposed device", () => {
    const fakeDevice = { label: "fake" } as unknown as GPUDevice;
    expect(getRendererGpuDevice(webgpuApp(fakeDevice))).toBe(fakeDevice);
  });

  it("returns null when WebGPU renderer has no device exposed", () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(getRendererGpuDevice(webgpuApp())).toBeNull();
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
