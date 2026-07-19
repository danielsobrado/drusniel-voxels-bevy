import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportGpuCpuFallback,
  resetGpuCpuFallbackLogForTests,
} from "./gpu_cpu_fallback_log.js";

describe("GPU CPU fallback logging", () => {
  beforeEach(() => {
    resetGpuCpuFallbackLogForTests();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs each scope and reason once at error level", () => {
    reportGpuCpuFallback("props-gpu-ring", "device unavailable");
    reportGpuCpuFallback("props-gpu-ring", "device unavailable");
    reportGpuCpuFallback("clod-stream-gpu", "device unavailable");

    expect(console.error).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenNthCalledWith(
      1,
      "[props-gpu-ring] GPU path failed; falling back to CPU: device unavailable",
    );
  });

  it("deduplicates variable messages with a stable handoff key", () => {
    reportGpuCpuFallback("clod-stream-gpu", "handed 4 pages to CPU", "worker-handoff");
    reportGpuCpuFallback("clod-stream-gpu", "handed 8 pages to CPU", "worker-handoff");

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      "[clod-stream-gpu] GPU path failed; falling back to CPU: handed 4 pages to CPU",
    );
  });

  it("keeps the original error for stack diagnostics", () => {
    const error = new Error("compute initialization failed");
    reportGpuCpuFallback("props-gpu-ring", error);

    expect(console.error).toHaveBeenCalledWith(
      "[props-gpu-ring] GPU path failed; falling back to CPU: compute initialization failed",
      error,
    );
  });
});
