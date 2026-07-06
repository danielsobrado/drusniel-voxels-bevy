import { describe, expect, it } from "vitest";
import {
  DEFAULT_SELECTION_CUT_CACHE_CONFIG,
  SelectionCutCache,
  staleSetSignature,
  type SelectionCutCacheKeyInput,
} from "../selection_cut_cache.js";

const baseInput = (overrides: Partial<SelectionCutCacheKeyInput> = {}): SelectionCutCacheKeyInput => ({
  frameId: 1,
  cameraPosition: [10, 20, 30],
  cameraForward: [0, 0, -1],
  selectionCenter: [12, 0, 32],
  viewportHeight: 720,
  fovY: 1.1,
  thresholdPx: 1.5,
  hysteresisMergeFactor: 0.85,
  enforce21: true,
  freezeSelection: false,
  neighborLevelDeltaMax: 1,
  materialTiers: false,
  bubbleEnabled: true,
  bubbleCenterX: 12,
  bubbleCenterZ: 32,
  bubbleRadius: 48,
  forcedMaxLevel: null,
  webgpuSelectionEnabled: false,
  webgpuErrorMapGeneration: null,
  staleRevision: 0,
  debugKey: "cut-a|bounds:false",
  ...overrides,
});

function committedCache(input = baseInput()): SelectionCutCache {
  const cache = new SelectionCutCache(DEFAULT_SELECTION_CUT_CACHE_CONFIG);
  const first = cache.decide(input);
  expect(first.hit).toBe(false);
  cache.commitMiss(first.key, input.frameId);
  return cache;
}

describe("SelectionCutCache", () => {
  it("returns miss on first frame", () => {
    const cache = new SelectionCutCache(DEFAULT_SELECTION_CUT_CACHE_CONFIG);

    const decision = cache.decide(baseInput());

    expect(decision.hit).toBe(false);
    expect(decision.reason).toBe("first_frame");
    expect(cache.stats().misses).toBe(1);
  });

  it("returns hit for same quantized camera/settings", () => {
    const input = baseInput();
    const cache = committedCache(input);

    const decision = cache.decide({ ...input, frameId: 2 });

    expect(decision.hit).toBe(true);
    expect(decision.reason).toBe("hit");
    expect(cache.stats().hits).toBe(1);
  });

  it("returns hit when camera moves within bucket", () => {
    const cache = committedCache();

    const decision = cache.decide(baseInput({
      frameId: 2,
      cameraPosition: [10.2, 20.4, 30.2],
      selectionCenter: [12.3, 0, 32.3],
    }));

    expect(decision.hit).toBe(true);
  });

  it("returns miss when camera crosses bucket", () => {
    const cache = committedCache();

    const decision = cache.decide(baseInput({
      frameId: 2,
      cameraPosition: [11.6, 20, 30],
    }));

    expect(decision.hit).toBe(false);
    expect(decision.reason).toBe("camera_bucket_changed");
  });

  it("returns miss when threshold bucket changes", () => {
    const cache = committedCache();

    const decision = cache.decide(baseInput({ frameId: 2, thresholdPx: 1.6 }));

    expect(decision.hit).toBe(false);
    expect(decision.reason).toBe("settings_changed");
  });

  it("returns miss when bubble center or radius changes", () => {
    const cache = committedCache();

    const centerDecision = cache.decide(baseInput({ frameId: 2, bubbleCenterX: 14 }));
    expect(centerDecision.hit).toBe(false);
    expect(centerDecision.reason).toBe("near_field_changed");

    cache.commitMiss(centerDecision.key, 2);
    const radiusDecision = cache.decide(baseInput({
      frameId: 3,
      bubbleCenterX: 14,
      bubbleRadius: 50,
    }));
    expect(radiusDecision.hit).toBe(false);
    expect(radiusDecision.reason).toBe("near_field_changed");
  });

  it("returns miss when stale revision changes", () => {
    const cache = committedCache();

    const decision = cache.decide(baseInput({ frameId: 2, staleRevision: 1 }));

    expect(decision.hit).toBe(false);
    expect(decision.reason).toBe("stale_revision_changed");
  });

  it("returns hit under freezeSelection despite camera movement", () => {
    const input = baseInput({ freezeSelection: true });
    const cache = committedCache(input);

    const decision = cache.decide({
      ...input,
      frameId: 2,
      cameraPosition: [100, 200, 300],
      cameraForward: [1, 0, 0],
      selectionCenter: [400, 0, 500],
    });

    expect(decision.hit).toBe(true);
  });

  it("returns hit under freezeSelection despite near-field movement", () => {
    const input = baseInput({ freezeSelection: true });
    const cache = committedCache(input);

    const decision = cache.decide(baseInput({
      freezeSelection: true,
      frameId: 2,
      bubbleCenterX: 128,
      bubbleCenterZ: 256,
      bubbleRadius: 96,
    }));

    expect(decision.hit).toBe(true);
  });

  it("returns hit under freezeSelection despite WebGPU map changes and max reuse age", () => {
    const input = baseInput({
      freezeSelection: true,
      webgpuSelectionEnabled: true,
      webgpuErrorMapGeneration: "1:1",
    });
    const cache = committedCache(input);

    const decision = cache.decide(baseInput({
      freezeSelection: true,
      frameId: 100,
      webgpuSelectionEnabled: true,
      webgpuErrorMapGeneration: "2:100",
    }));

    expect(decision.hit).toBe(true);
  });

  it("returns miss when freezeSelection toggles", () => {
    const cache = committedCache();

    const decision = cache.decide(baseInput({ frameId: 2, freezeSelection: true }));

    expect(decision.hit).toBe(false);
    expect(decision.reason).toBe("settings_changed");
  });

  it("returns miss after explicit invalidate", () => {
    const cache = committedCache();

    cache.invalidate();
    const decision = cache.decide(baseInput({ frameId: 2 }));

    expect(decision.hit).toBe(false);
    expect(decision.reason).toBe("forced_invalidate");
    expect(cache.stats().invalidations).toBe(1);
  });

  it("misses after maxReuseFrames exceeded", () => {
    const config = { ...DEFAULT_SELECTION_CUT_CACHE_CONFIG, maxReuseFrames: 8 };
    const cache = new SelectionCutCache(config);
    const input = baseInput({ frameId: 1 });
    const first = cache.decide(input);
    expect(first.hit).toBe(false);
    cache.commitMiss(first.key, input.frameId);

    const decision = cache.decide(baseInput({ frameId: 10 }));

    expect(decision.hit).toBe(false);
    expect(decision.reason).toBe("max_reuse_frames_exceeded");
  });

  it("tracks hits/misses/invalidations stats", () => {
    const cache = committedCache();
    cache.decide(baseInput({ frameId: 2 }));
    cache.invalidate();
    cache.decide(baseInput({ frameId: 3 }));

    expect(cache.stats()).toEqual({
      enabled: true,
      hits: 1,
      misses: 2,
      invalidations: 1,
      lastReason: "forced_invalidate",
    });
  });

  it("does not poison committed state when a stale pending key is committed", () => {
    const cache = new SelectionCutCache(DEFAULT_SELECTION_CUT_CACHE_CONFIG);
    const first = cache.decide(baseInput({ frameId: 1 }));
    expect(first.hit).toBe(false);

    cache.commitMiss("stale-key", 1);
    const second = cache.decide(baseInput({ frameId: 2 }));

    expect(second.hit).toBe(false);
    expect(second.reason).toBe("first_frame");
  });

  it("does not collide WebGPU map generations", () => {
    const input = baseInput({
      webgpuSelectionEnabled: true,
      webgpuErrorMapGeneration: "1:1000001",
    });
    const cache = committedCache(input);

    const decision = cache.decide(baseInput({
      frameId: 2,
      webgpuSelectionEnabled: true,
      webgpuErrorMapGeneration: "2:1",
    }));

    expect(decision.hit).toBe(false);
    expect(decision.reason).toBe("webgpu_error_source_changed");
  });

  it("flags debug state changes without forcing a selection miss", () => {
    const cache = committedCache();

    const decision = cache.decide(baseInput({
      frameId: 2,
      debugKey: "cut-a|bounds:true",
    }));

    expect(decision.hit).toBe(true);
    expect(decision.debugChanged).toBe(true);
  });

  it("uses a stable stale set signature independent of insertion order", () => {
    expect(staleSetSignature(new Set(["b", "a"]))).toBe("2:a|b");
    expect(staleSetSignature(new Set(["a", "b"]))).toBe("2:a|b");
    expect(staleSetSignature(new Set())).toBe("0:");
  });
});
