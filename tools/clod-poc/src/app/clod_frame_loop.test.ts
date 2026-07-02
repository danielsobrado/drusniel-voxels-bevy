import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDir = dirname(fileURLToPath(import.meta.url));

describe("bindClodFrameLoop", () => {
  it("resolves WebGPU timestamp queries after the render phase has submitted work", () => {
    const source = readFileSync(resolve(appDir, "clod_frame_loop.ts"), "utf8");
    const renderPhase = source.indexOf("runRenderPhase({");
    const timestampResolve = source.indexOf("render.gpuPassTiming?.update();");

    expect(renderPhase).toBeGreaterThanOrEqual(0);
    expect(timestampResolve).toBeGreaterThan(renderPhase);
  });
});
