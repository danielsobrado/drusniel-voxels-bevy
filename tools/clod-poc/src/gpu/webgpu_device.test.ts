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
});
