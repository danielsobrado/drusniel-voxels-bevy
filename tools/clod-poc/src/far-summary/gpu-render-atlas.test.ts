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

function center(worldX: number, worldZ: number): StreamCenter {
  return {
    worldX,
    worldZ,
    predictedX: worldX,
    predictedZ: worldZ,
    velocityX: 0,
    velocityZ: 0,
  };
}

describe("far-summary GPU render atlas", () => {
  afterEach(() => {
    setActiveFarSummaryGpuAtlasView(undefined);
  });

  it("covers the complete configured far radius for every ring", () => {
    const plan = planFarSummaryGpuRenderAtlas(center(0, 0), DEFAULT_FAR_SUMMARY_CONFIG, 7);

    expect(plan.tilesPerSide).toBe(9);
    expect(plan.rings).toHaveLength(DEFAULT_FAR_SUMMARY_CONFIG.rings.length);
    expect(plan.tiles).toHaveLength(DEFAULT_FAR_SUMMARY_CONFIG.rings.length * 81);
    expect(plan.tiles[0]).toMatchObject({
      ring: 0,
      tileX: -4,
      tileZ: -4,
      atlasX: 0,
      atlasY: 0,
      revision: 7,
    });
    expect(plan.rings[0]).toMatchObject({
      originX: -4096,
      originZ: -4096,
      widthCells: 288,
      heightCells: 288,
      rowOffsetCells: 0,
      valid: 1,
    });
    expect(plan.rings[1]?.rowOffsetCells).toBe(288);
    expect(plan.rings[2]?.rowOffsetCells).toBe(576);
  });

  it("keeps the atlas signature stable until a tile-window boundary is crossed", () => {
    const initial = planFarSummaryGpuRenderAtlas(center(20, 20), DEFAULT_FAR_SUMMARY_CONFIG, 1);
    const sameWindow = planFarSummaryGpuRenderAtlas(center(800, 800), DEFAULT_FAR_SUMMARY_CONFIG, 2);
    const shifted = planFarSummaryGpuRenderAtlas(center(1100, 20), DEFAULT_FAR_SUMMARY_CONFIG, 3);

    expect(sameWindow.signature).toBe(initial.signature);
    expect(shifted.signature).not.toBe(initial.signature);
  });

  it("packs atlas destinations into descriptor padding without CPU summary records", () => {
    const plan = planFarSummaryGpuRenderAtlas(center(0, 0), DEFAULT_FAR_SUMMARY_CONFIG, 9);
    const tile = plan.tiles[26]!;
    const packed = packFarSummaryRenderAtlasDescriptors([tile]);
    const view = new DataView(packed);

    expect(view.getUint32(36, true)).toBe(0);
    expect(view.getUint32(48, true)).toBe(0);
    expect(view.getUint32(52, true)).toBe(tile.atlasX);
    expect(view.getUint32(56, true)).toBe(tile.atlasY);
  });

  it("uses the current shared descriptor field names in the render-atlas shader", async () => {
    const shader = await import("./shaders/far_summary_render_atlas_build.wgsl?raw").then((module) => module.default);
    expect(shader).toContain("descriptor.layout_version");
    expect(shader).toContain("descriptor.canonical_sample_offset");
    expect(shader).not.toContain("descriptor._pad");
  });

  it("publishes the renderer-owned view for far-shell construction", () => {
    const view = { valid: 0 } as FarSummaryGpuAtlasView;
    setActiveFarSummaryGpuAtlasView(view);
    expect(getActiveFarSummaryGpuAtlasView()).toBe(view);
  });
});
