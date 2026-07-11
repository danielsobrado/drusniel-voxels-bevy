import { afterEach, describe, expect, it } from "vitest";
import type { FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";
import { DEFAULT_FAR_SUMMARY_CONFIG } from "./config.js";
import {
  getActiveFarSummaryGpuAtlasView,
  packFarSummaryRenderAtlasDescriptors,
  planFarSummaryGpuRenderAtlas,
  setActiveFarSummaryGpuAtlasView,
} from "./gpu-render-atlas.js";
import type { StreamCenter } from "./stream-center.js";

function center(predictedX: number, predictedZ: number): StreamCenter {
  return {
    worldX: predictedX,
    worldZ: predictedZ,
    predictedX,
    predictedZ,
    velocityX: 0,
    velocityZ: 0,
  };
}

describe("far-summary GPU render atlas", () => {
  afterEach(() => {
    setActiveFarSummaryGpuAtlasView(undefined);
  });

  it("plans a fixed 5x5 GPU tile window for every far-summary ring", () => {
    const plan = planFarSummaryGpuRenderAtlas(center(0, 0), DEFAULT_FAR_SUMMARY_CONFIG, 7);

    expect(plan.rings).toHaveLength(DEFAULT_FAR_SUMMARY_CONFIG.rings.length);
    expect(plan.tiles).toHaveLength(DEFAULT_FAR_SUMMARY_CONFIG.rings.length * 25);
    expect(plan.tiles[0]).toMatchObject({
      ring: 0,
      tileX: -2,
      tileZ: -2,
      atlasX: 0,
      atlasY: 0,
      revision: 7,
    });
    expect(plan.rings[0]).toMatchObject({
      originX: -2048,
      originZ: -2048,
      widthCells: 160,
      heightCells: 160,
      rowOffsetCells: 0,
      valid: 1,
    });
    expect(plan.rings[1]?.rowOffsetCells).toBe(160);
    expect(plan.rings[2]?.rowOffsetCells).toBe(320);
  });

  it("keeps the atlas signature stable until a tile-window boundary is crossed", () => {
    const initial = planFarSummaryGpuRenderAtlas(center(20, 20), DEFAULT_FAR_SUMMARY_CONFIG, 1);
    const sameWindow = planFarSummaryGpuRenderAtlas(center(800, 800), DEFAULT_FAR_SUMMARY_CONFIG, 2);
    const shifted = planFarSummaryGpuRenderAtlas(center(1100, 20), DEFAULT_FAR_SUMMARY_CONFIG, 3);

    expect(sameWindow.signature).toBe(initial.signature);
    expect(shifted.signature).not.toBe(initial.signature);
  });

  it("packs atlas destinations into the descriptor padding without CPU summary records", () => {
    const plan = planFarSummaryGpuRenderAtlas(center(0, 0), DEFAULT_FAR_SUMMARY_CONFIG, 9);
    const packed = packFarSummaryRenderAtlasDescriptors([plan.tiles[26]!]);
    const view = new DataView(packed);

    expect(view.getUint32(36, true)).toBe(0);
    expect(view.getUint32(48, true)).toBe(0);
    expect(view.getUint32(52, true)).toBe(plan.tiles[26]!.atlasX);
    expect(view.getUint32(56, true)).toBe(plan.tiles[26]!.atlasY);
  });

  it("publishes the renderer-owned view for far-shell material construction", () => {
    const view = { valid: 0 } as FarSummaryGpuAtlasView;
    setActiveFarSummaryGpuAtlasView(view);
    expect(getActiveFarSummaryGpuAtlasView()).toBe(view);
  });
});
