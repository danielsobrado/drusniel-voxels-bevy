import { describe, expect, it } from "vitest";
import {
  LargePropOcclusionField,
  createLargePropOcclusionSample,
} from "./large_prop_occlusion_field.js";
import type { PropOccluder, PropOccluderSnapshot } from "./prop_occluder_snapshot.js";
import type { PropOcclusionSettings } from "./prop_types.js";

const settings: PropOcclusionSettings = {
  enabled: true,
  cellSizeM: 1,
  buildCellsPerFrame: 2,
  footprintPaddingM: 0,
  minimumHeightM: 0,
  mistClipStrength: 0.8,
};

function occluder(
  key: string,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  overrides: Partial<PropOccluder> = {},
): PropOccluder {
  return {
    key,
    assetId: "ruin",
    instanceIndex: 0,
    instanceRevision: 1,
    bounds: {
      minX,
      minY: 0,
      minZ,
      maxX,
      maxY: 4,
      maxZ,
    },
    heightM: 4,
    affectGi: true,
    affectFog: true,
    ...overrides,
  };
}

function snapshot(revision: number, occluders: readonly PropOccluder[], enabled = true): PropOccluderSnapshot {
  return {
    enabled,
    revision,
    sceneId: "test",
    occluders,
  };
}

describe("large prop occlusion field", () => {
  it("keeps the old valid field live until the new revision swaps atomically", () => {
    const field = new LargePropOcclusionField(settings);
    const sample = createLargePropOcclusionSample();

    field.submit(snapshot(1, [occluder("a", 0, 0, 2, 2)]));
    field.step();
    expect(field.stats()).toMatchObject({
      activeRevision: 0,
      pendingRevision: 1,
      processedCellsLastStep: 2,
      pending: true,
    });
    expect(field.sampleInto(0.5, 0.5, sample).valid).toBe(false);

    field.step();
    expect(field.stats()).toMatchObject({
      activeRevision: 1,
      pendingRevision: 0,
      activeCells: 4,
      pending: false,
    });
    expect(field.sampleInto(0.5, 0.5, sample)).toMatchObject({
      valid: true,
      enabled: true,
      revision: 1,
      giOccupancy: 1,
      fogOccupancy: 1,
      fogBottomY: 0,
      fogTopY: 4,
    });

    field.submit(snapshot(2, [occluder("b", 10, 10, 12, 12)]));
    field.step();
    expect(field.sampleInto(0.5, 0.5, sample)).toMatchObject({
      revision: 1,
      fogOccupancy: 1,
    });
    expect(field.stats().pendingRevision).toBe(2);

    field.step();
    expect(field.sampleInto(0.5, 0.5, sample)).toMatchObject({
      revision: 2,
      fogOccupancy: 0,
    });
    expect(field.sampleInto(10.5, 10.5, sample).fogOccupancy).toBe(1);
  });

  it("honors the strict raster-cell budget even for one large occluder", () => {
    const field = new LargePropOcclusionField({
      ...settings,
      buildCellsPerFrame: 3,
    });
    field.submit(snapshot(1, [occluder("large", 0, 0, 10, 10)]));

    field.step();
    expect(field.stats()).toMatchObject({
      activeRevision: 0,
      pendingRevision: 1,
      processedCellsLastStep: 3,
      pendingCells: 3,
    });
    field.step();
    expect(field.stats().processedCellsLastStep).toBe(3);
    expect(field.stats().pending).toBe(true);
  });

  it("stores partial coverage and GI/fog channels independently", () => {
    const field = new LargePropOcclusionField({
      ...settings,
      buildCellsPerFrame: 8,
    });
    field.submit(snapshot(1, [
      occluder("fog", 0.5, 0, 1.5, 1, {
        affectGi: false,
        affectFog: true,
      }),
    ]));
    field.step();

    const sample = createLargePropOcclusionSample();
    expect(field.sampleInto(0.25, 0.5, sample)).toMatchObject({
      valid: true,
      giOccupancy: 0,
      fogOccupancy: 0.5,
      fogBottomY: 0,
      fogTopY: 4,
    });
    expect(field.sampleInto(1.25, 0.5, sample).fogOccupancy).toBe(0.5);
  });

  it("replaces a pending revision and applies disabled snapshots immediately", () => {
    const field = new LargePropOcclusionField(settings);
    field.submit(snapshot(1, [occluder("old-pending", 0, 0, 5, 5)]));
    field.step();

    expect(field.submit(snapshot(2, [occluder("new-pending", 20, 20, 21, 21)]))).toBe(true);
    field.step();
    expect(field.stats().activeRevision).toBe(2);

    expect(field.submit(snapshot(3, [], false))).toBe(true);
    expect(field.stats()).toMatchObject({
      activeRevision: 3,
      pending: false,
      activeCells: 0,
    });
    const sample = createLargePropOcclusionSample();
    expect(field.sampleInto(20.5, 20.5, sample)).toMatchObject({
      valid: true,
      enabled: false,
      revision: 3,
      fogOccupancy: 0,
    });
    expect(field.submit(snapshot(2, []))).toBe(false);
  });
});
