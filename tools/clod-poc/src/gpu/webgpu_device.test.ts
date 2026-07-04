import { describe, expect, it } from "vitest";
import { requestWebGpuDevice } from "./webgpu_device.js";

describe("requestWebGpuDevice", () => {
  it("reports a clear unavailable reason when WebGPU is missing", async () => {
    const result = await requestWebGpuDevice(undefined);

    expect(result).toMatchObject({
      ok: false,
      reason: "navigator-gpu-missing",
    });
  });

  it("reports adapter unavailable when the adapter request returns null", async () => {
    const gpu = {
      requestAdapter: async () => null,
    } as unknown as GPU;

    const result = await requestWebGpuDevice(gpu);

    expect(result).toMatchObject({
      ok: false,
      reason: "adapter-unavailable",
      message: "WebGPU adapter request returned null",
    });
  });

  it("reports adapter unavailable when the adapter request rejects", async () => {
    const gpu = {
      requestAdapter: async () => {
        throw new Error("adapter boom");
      },
    } as unknown as GPU;

    const result = await requestWebGpuDevice(gpu);

    expect(result).toMatchObject({
      ok: false,
      reason: "adapter-unavailable",
      message: "adapter boom",
    });
  });

  it("reports device request failures", async () => {
    const gpu = {
      requestAdapter: async () => ({
        requestDevice: async () => {
          throw new Error("device boom");
        },
      }),
    } as unknown as GPU;

    const result = await requestWebGpuDevice(gpu);

    expect(result).toMatchObject({
      ok: false,
      reason: "device-request-failed",
      message: "device boom",
    });
  });

  it("returns the adapter and device when requests succeed", async () => {
    const device = {} as GPUDevice;
    const adapter = {
      requestDevice: async () => device,
    } as unknown as GPUAdapter;
    const gpu = {
      requestAdapter: async () => adapter,
    } as unknown as GPU;

    const result = await requestWebGpuDevice(gpu);

    expect(result).toEqual({
      ok: true,
      adapter,
      device,
    });
  });
});
