import { describe, expect, it, vi } from "vitest";
import type { LargePropOcclusionHeightPayload } from "../../props/large_prop_occlusion_height.js";
import type { FarClipmapSource } from "./far_clipmap_source.js";
import { FarReflectionSource, type FarReflectionSourceConfig } from "./far_reflection_source.js";

const config: FarReflectionSourceConfig = {
  enabled: true,
  resolution: 3,
  spanM: 2,
  snapM: 1,
  buildCellsPerFrame: 2,
};

function source(height = 4): FarClipmapSource {
  return {
    sampleHeight: vi.fn(() => height),
    sampleMaterial: () => 0,
    sampleBiome: () => 0,
    sampleWater: () => 0,
    isReady: () => true,
    revision: () => 1,
  };
}

function propPayload(revision = 2): LargePropOcclusionHeightPayload {
  return {
    revision,
    cellSizeM: 1,
    cellX: new Int32Array([1]),
    cellZ: new Int32Array([1]),
    topY: new Float32Array([9]),
    minX: 0,
    minZ: 0,
    maxX: 2,
    maxZ: 2,
  };
}

function finish(runtime: FarReflectionSource): void {
  while (runtime.stats().pending) runtime.step();
}

describe("FarReflectionSource", () => {
  it("keeps the old committed window live until a replacement swaps atomically", () => {
    const runtime = new FarReflectionSource(config);
    runtime.submit({
      source: source(4),
      sourceRevision: 1,
      propGeneration: 1,
      propPayload: null,
      centerX: 1,
      centerZ: 1,
    });
    finish(runtime);
    const first = runtime.snapshot();
    expect(first.generation).toBe(1);
    expect(first.data[0]).toBe(4);

    runtime.submit({
      source: source(7),
      sourceRevision: 2,
      propGeneration: 1,
      propPayload: null,
      centerX: 1,
      centerZ: 1,
    });
    runtime.step();
    expect(runtime.snapshot()).toBe(first);
    expect(runtime.stats()).toMatchObject({ pending: true, processedCellsLastStep: 2 });

    finish(runtime);
    expect(runtime.snapshot()).not.toBe(first);
    expect(runtime.snapshot()).toMatchObject({ generation: 2, sourceRevision: 2 });
    expect(runtime.snapshot().data[0]).toBe(7);
  });

  it("honors the strict cell budget and replaces obsolete pending revisions", () => {
    const runtime = new FarReflectionSource({ ...config, resolution: 5, spanM: 4, buildCellsPerFrame: 3 });
    runtime.submit({ source: source(1), sourceRevision: 1, propGeneration: 0, propPayload: null, centerX: 0, centerZ: 0 });
    runtime.step();
    expect(runtime.stats()).toMatchObject({ pending: true, pendingCells: 3, processedCellsLastStep: 3 });

    runtime.submit({ source: source(2), sourceRevision: 2, propGeneration: 0, propPayload: null, centerX: 0, centerZ: 0 });
    runtime.step();
    expect(runtime.stats()).toMatchObject({ pending: true, pendingCells: 3, processedCellsLastStep: 3 });
    finish(runtime);
    expect(runtime.snapshot().sourceRevision).toBe(2);
    expect(runtime.snapshot().data[0]).toBe(2);
  });

  it("combines conservative prop tops and records validity channels", () => {
    const runtime = new FarReflectionSource(config);
    runtime.submit({
      source: source(4),
      sourceRevision: 1,
      propGeneration: 5,
      propPayload: propPayload(),
      centerX: 1,
      centerZ: 1,
    });
    finish(runtime);

    const snapshot = runtime.snapshot();
    const centerOffset = (1 * snapshot.resolution + 1) * 4;
    expect(Array.from(snapshot.data.slice(centerOffset, centerOffset + 4))).toEqual([9, 1, 1, 1]);
    expect(snapshot).toMatchObject({ propGeneration: 5, propRevision: 2 });
  });

  it("keeps a prop blocker valid when terrain sampling throws", () => {
    const broken: FarClipmapSource = {
      sampleHeight: () => { throw new Error("missing terrain"); },
      sampleMaterial: () => 0,
      sampleBiome: () => 0,
      sampleWater: () => 0,
    };
    const runtime = new FarReflectionSource(config);
    runtime.submit({
      source: broken,
      sourceRevision: 1,
      propGeneration: 1,
      propPayload: propPayload(),
      centerX: 1,
      centerZ: 1,
    });
    finish(runtime);

    const centerOffset = (1 * runtime.snapshot().resolution + 1) * 4;
    expect(Array.from(runtime.snapshot().data.slice(centerOffset, centerOffset + 4))).toEqual([9, 0, 1, 1]);
    expect(runtime.stats().exceptionSamplesTotal).toBeGreaterThan(0);
  });

  it("snaps the window and ignores identical submissions", () => {
    const runtime = new FarReflectionSource(config);
    const input = { source: source(), sourceRevision: 1, propGeneration: 0, propPayload: null, centerX: 1.2, centerZ: -0.2 };
    expect(runtime.submit(input)).toBe(true);
    expect(runtime.submit({ ...input, centerX: 1.8, centerZ: -0.8 })).toBe(false);
    finish(runtime);
    expect(runtime.snapshot()).toMatchObject({ originX: 0, originZ: -2, cellSizeM: 1 });
  });
});
