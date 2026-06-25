import { describe, expect, it } from "vitest";
import { webGpuDispatchKey } from "./webgpu_selection_parity.js";
import type { SelectionParams } from "../clod/selection.js";

describe("webGpuDispatchKey", () => {
  it("is stable for quantized camera and selection params", () => {
    const params: SelectionParams = {
      thresholdPx: 1.5,
      hysteresisMergeFactor: 0.85,
      enforce21: true,
      nearField: {
        enabled: true,
        centerX: 10.1,
        centerZ: 20.2,
        radius: 48,
        boundaryPadding: 16,
      },
      viewportH: 720,
      fovY: 1.1,
      camPos: [12.3, 45.6, 78.9],
      forcedMaxLevel: null,
    };
    const a = webGpuDispatchKey(params);
    const b = webGpuDispatchKey({
      ...params,
      camPos: [12.31, 45.61, 78.91],
      nearField: { ...params.nearField!, centerX: 10.11, centerZ: 20.21 },
    });
    expect(a).toBe(b);
  });

  it("changes when threshold or near-field toggles change", () => {
    const base: SelectionParams = {
      thresholdPx: 1.5,
      hysteresisMergeFactor: 0.85,
      enforce21: false,
      viewportH: 720,
      fovY: 1.1,
      camPos: [0, 10, 0],
      forcedMaxLevel: 2,
    };
    const withNearField: SelectionParams = {
      ...base,
      nearField: {
        enabled: true,
        centerX: 0,
        centerZ: 0,
        radius: 32,
        boundaryPadding: 8,
      },
    };
    expect(webGpuDispatchKey(base)).not.toBe(webGpuDispatchKey(withNearField));
    expect(webGpuDispatchKey({ ...base, thresholdPx: 2.0 })).not.toBe(webGpuDispatchKey(base));
  });
});
