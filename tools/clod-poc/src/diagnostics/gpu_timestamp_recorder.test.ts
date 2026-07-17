import { describe, expect, it } from "vitest";
import { gpuTimestampRecordingEnabled } from "./gpu_timestamp_recorder.js";

describe("gpu_timestamp_recorder", () => {
  it("is disabled during normal gameplay", () => {
    expect(gpuTimestampRecordingEnabled(new URLSearchParams())).toBe(false);
  });

  it("accepts explicit timing and perf-probe gates", () => {
    expect(gpuTimestampRecordingEnabled(new URLSearchParams("ringGpuTiming=1"))).toBe(true);
    expect(gpuTimestampRecordingEnabled(new URLSearchParams("gpuTiming=on"))).toBe(true);
    expect(gpuTimestampRecordingEnabled(new URLSearchParams("perfProbe=true"))).toBe(true);
  });
});
