import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DYNAMIC_RESOLUTION_CONFIG } from "../render_resolution_config.js";
import { createDynamicResolutionController } from "../dynamic_resolution.js";
import type { RenderResolutionRuntime } from "../render_resolution_runtime.js";

function makeRuntime(renderScale = 1): RenderResolutionRuntime {
  const settings = { presetName: "custom", dprCap: 1, renderScale };
  return {
    settings,
    current: vi.fn(),
    readout: vi.fn(),
    presetNames: vi.fn(() => ["custom"]),
    applyPreset: vi.fn(),
    setCustomDprCap: vi.fn((value: number) => { settings.dprCap = value; }),
    setCustomRenderScale: vi.fn((value: number) => { settings.renderScale = value; }),
    resolveCurrentViewport: vi.fn(),
    markApplied: vi.fn(),
    applyCurrentViewport: vi.fn(() => ({ resolution: {} as never, changed: true })),
  };
}

function makeUpdateInput(frameMs: number) {
  return {
    frameMs,
    frameIndex: 1,
    renderer: {
      setPixelRatio: vi.fn(),
      setSize: vi.fn(),
    },
    camera: {
      aspect: 1,
      updateProjectionMatrix: vi.fn(),
    },
  };
}

describe("createDynamicResolutionController", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stays disabled during perf probes unless explicitly forced", () => {
    const runtime = makeRuntime(0.9);
    const controller = createDynamicResolutionController(
      { ...DEFAULT_DYNAMIC_RESOLUTION_CONFIG, sampleWindowFrames: 1 },
      runtime,
      new URLSearchParams("perfProbe=1"),
    );

    const stats = controller.update(makeUpdateInput(40));

    expect(stats.active).toBe(false);
    expect(stats.reason).toBe("mode_disabled");
    expect(runtime.setCustomRenderScale).not.toHaveBeenCalled();
  });

  it("scales down after sustained over-target frames", () => {
    const runtime = makeRuntime(1.0);
    const controller = createDynamicResolutionController(
      {
        ...DEFAULT_DYNAMIC_RESOLUTION_CONFIG,
        targetMs: 16,
        minScale: 0.7,
        maxScale: 1.0,
        stepDown: 0.1,
        sampleWindowFrames: 2,
        settleFrames: 0,
      },
      runtime,
      new URLSearchParams(),
    );

    controller.update(makeUpdateInput(30));
    const stats = controller.update(makeUpdateInput(32));

    expect(stats.reason).toBe("scale_down");
    expect(runtime.settings.renderScale).toBe(0.9);
    expect(runtime.applyCurrentViewport).toHaveBeenCalledTimes(1);
  });

  it("registers the controller for render-phase fallback", () => {
    vi.stubGlobal("window", {});
    const runtime = makeRuntime(1.0);
    const controller = createDynamicResolutionController(
      { ...DEFAULT_DYNAMIC_RESOLUTION_CONFIG, sampleWindowFrames: 1 },
      runtime,
      new URLSearchParams("dynamicResolution=1"),
    );

    expect(window.__drusnielDynamicResolution).toBe(controller);
  });
});
