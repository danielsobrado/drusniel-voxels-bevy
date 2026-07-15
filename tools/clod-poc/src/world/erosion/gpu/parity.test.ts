import { describe, expect, it } from "vitest";
import { requestSharedWebGpuDevice } from "../../../rendering/shared_webgpu_device.js";
import { getErosionDiagnostics } from "../diagnostics.js";
import { assertErosionGpuParity } from "./parity_gate.js";

const webGpuAvailable = typeof navigator !== "undefined" && !!navigator.gpu;
const gpuIt = webGpuAvailable ? it : it.skip;

describe("erosion GPU parity", () => {
  gpuIt("is bit-identical to the CPU oracle on golden and random seeded grids", async () => {
    const shared = await requestSharedWebGpuDevice();
    await assertErosionGpuParity(shared.device);
    expect(getErosionDiagnostics().erosion_cpu_gpu_mismatch_count).toBe(0);
  });
});
