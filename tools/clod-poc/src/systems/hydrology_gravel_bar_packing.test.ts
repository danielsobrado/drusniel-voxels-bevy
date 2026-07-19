import { describe, expect, it } from "vitest";
import { createHydrologyGrid, HYDROLOGY_BODY_RIVER } from "../water/hydrologyGrid.js";
import { gravelBarBodyPhase } from "../water/gravel_bar_field.js";
import { packHydrologyFieldData } from "./hydrology_packing.js";

const BODY_PHASE_SCALE = 0.25;

describe("stone gravel bar hydrology packing", () => {
  it("preserves canonical fields while carrying phase below the body-kind round threshold", () => {
    const grid = createHydrologyGrid(2, 16, { surfaceHeight: () => 0 }, 1);
    const index = 0;
    // Layout B stores flowDir already pre-scaled by strength (see hydrologyGpuPacking).
    grid.flowDirX[index] = 0.24;
    grid.flowDirZ[index] = 0.32;
    grid.flowStrength[index] = 0.4;
    grid.moisture[index] = 0.7;
    grid.bodyKind[index] = HYDROLOGY_BODY_RIVER;
    grid.bodyId[index] = 42;

    const packed = packHydrologyFieldData({ grid }).data;
    expect(packed[0]).toBeCloseTo(0.24);
    expect(packed[1]).toBeCloseTo(0.32);
    expect(packed[2]).toBeCloseTo(0.7);

    const encodedKind = packed[3] * 255;
    expect(Math.round(encodedKind)).toBe(HYDROLOGY_BODY_RIVER);
    expect((encodedKind - Math.floor(encodedKind)) / BODY_PHASE_SCALE)
      .toBeCloseTo(gravelBarBodyPhase(42), 5);
  });
});
