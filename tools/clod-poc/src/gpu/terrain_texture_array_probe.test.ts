import { describe, expect, it } from "vitest";
import { compactRgbaReadback } from "./terrain_texture_array_probe.js";
import {
  diagnoseTerrainTextureArrayProbe,
  type TerrainTextureArrayProbePass,
  type TerrainTextureArrayProbeResult,
} from "./terrain_texture_array_probe_types.js";

function pass(layerCount: number, correctLayerRatio = 1, gpuUniqueColors = layerCount): TerrainTextureArrayProbePass {
  return {
    layerCount,
    cpuLayerMeans: Array.from({ length: layerCount }, (_, index) => ({ r: index / layerCount, g: 0, b: 0 })),
    gpuStripeMeans: Array.from({ length: layerCount }, (_, index) => ({ r: index / layerCount, g: 0, b: 0 })),
    nearestCpuLayerByStripe: Array.from({ length: layerCount }, (_, index) => index),
    cpuUniqueColors: layerCount,
    gpuUniqueColors,
    correctLayerRatio,
  };
}

describe("terrain texture-array probe diagnosis", () => {
  it("reports a passing synthetic and live array probe", () => {
    const result: TerrainTextureArrayProbeResult = {
      supported: true,
      reason: null,
      synthetic: pass(4),
      actual: pass(10),
    };
    expect(diagnoseTerrainTextureArrayProbe(result)).toEqual([expect.objectContaining({
      severity: "info",
      code: "GPU_TEXTURE_ARRAY_PROBE_PASSED",
    })]);
  });

  it("fails immediately when dynamic synthetic layer indexing collapses", () => {
    const result: TerrainTextureArrayProbeResult = {
      supported: true,
      reason: null,
      synthetic: pass(4, 0.25, 1),
      actual: pass(10),
    };
    expect(diagnoseTerrainTextureArrayProbe(result)).toEqual([expect.objectContaining({
      severity: "error",
      code: "GPU_TEXTURE_ARRAY_DYNAMIC_INDEX_FAILURE",
    })]);
  });

  it("distinguishes CPU content collapse from GPU layer collapse", () => {
    const cpuCollapsed = pass(10);
    cpuCollapsed.cpuUniqueColors = 1;
    expect(diagnoseTerrainTextureArrayProbe({
      supported: true,
      reason: null,
      synthetic: pass(4),
      actual: cpuCollapsed,
    })[0]?.code).toBe("ALBEDO_ARRAY_CONTENT_COLLAPSE");

    const gpuCollapsed = pass(10, 0.1, 1);
    expect(diagnoseTerrainTextureArrayProbe({
      supported: true,
      reason: null,
      synthetic: pass(4),
      actual: gpuCollapsed,
    })[0]?.code).toBe("GPU_ALBEDO_LAYER_COLLAPSE");
  });

  it("removes WebGPU 256-byte row padding from readback data", () => {
    const width = 96;
    const height = 24;
    const tightRowBytes = width * 4;
    const paddedRowBytes = 512;
    const padded = new Uint8Array((height - 1) * paddedRowBytes + tightRowBytes);
    const expected = new Uint8Array(tightRowBytes * height);

    for (let row = 0; row < height; row++) {
      for (let byte = 0; byte < tightRowBytes; byte++) {
        const value = (row * 17 + byte) & 0xff;
        padded[row * paddedRowBytes + byte] = value;
        expected[row * tightRowBytes + byte] = value;
      }
    }

    expect(compactRgbaReadback(padded, width, height)).toEqual(expected);
  });
});
