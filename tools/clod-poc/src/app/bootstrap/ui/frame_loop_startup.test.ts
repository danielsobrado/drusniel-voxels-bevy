import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const startupDir = dirname(fileURLToPath(import.meta.url));

describe("runFrameLoopStartup", () => {
  it("drains WebGPU timestamp queries even when named GPU timing is disabled", () => {
    const source = readFileSync(resolve(startupDir, "frame_loop_startup.ts"), "utf8");

    expect(source).toContain("new GpuPassTiming(input.app.renderer, gpuTimestampReady, wantGpuTiming && gpuTimestampReady)");
  });
});
