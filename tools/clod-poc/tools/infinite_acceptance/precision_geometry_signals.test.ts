import { describe, expect, it } from "vitest";
import {
  landmarkDriftSignals,
  type ScreenLandmark,
} from "./precision_geometry_signals.js";

const landmark = (id: string, xPx: number, yPx: number): ScreenLandmark => ({
  id,
  xPx,
  yPx,
  depthNdc: 0,
  visible: true,
});

describe("precision geometry signals", () => {
  it("reports landmark and terrain-to-prop relative drift", () => {
    const result = landmarkDriftSignals(
      [landmark("terrain", 10, 20), landmark("prop", 30, 25)],
      [landmark("terrain", 10.3, 20.4), landmark("prop", 30.5, 25.7)],
      "terrain",
      "prop",
    );

    expect(result.maxLandmarkDriftPx).toBeCloseTo(Math.hypot(0.5, 0.7));
    expect(result.terrainPropRelativeDriftPx).toBeCloseTo(Math.hypot(0.2, 0.3));
    expect(result.missingOrInvisibleIds).toEqual([]);
  });

  it("fails closed when a required marker is absent or invisible", () => {
    const result = landmarkDriftSignals(
      [landmark("terrain", 10, 20), landmark("prop", 30, 25)],
      [{ ...landmark("terrain", 10, 20), visible: false }],
      "terrain",
      "prop",
    );

    expect(result.maxLandmarkDriftPx).toBeNull();
    expect(result.terrainPropRelativeDriftPx).toBeNull();
    expect(result.missingOrInvisibleIds).toEqual(["prop", "terrain"]);
  });
});
