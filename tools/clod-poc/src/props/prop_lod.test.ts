import { describe, expect, it } from "vitest";
import customPropsYaml from "../../config/custom_props.yaml?raw";
import { parseCustomPropsConfig } from "./prop_config.js";
import {
  propCastsShadow,
  propDistanceToCamera,
  propLodErrorPx,
  propNeedsCollider,
  selectPropLodIndex,
} from "./prop_lod.js";

describe("prop LOD selection", () => {
  const settings = parseCustomPropsConfig(customPropsYaml);
  const ruin = settings.props.find((p) => p.id === "stone_ruin_wall")!;

  it("matches CLOD error_px formula", () => {
    const px = propLodErrorPx(2.0, 50, 1080, Math.PI / 3);
    expect(px).toBeGreaterThan(0);
    expect(px).toBeCloseTo((2 * 1080) / (2 * 50 * Math.tan(Math.PI / 6)), 4);
  });

  it("selects coarser LOD as distance increases", () => {
    const near = selectPropLodIndex(
      ruin,
      { camPos: [0, 2, 0], propPos: [10, 0, 10], viewportH: 1080, fovY: Math.PI / 3, thresholdPx: 2 },
      ruin.culling.maxDistance * 0.01,
    );
    const far = selectPropLodIndex(
      ruin,
      { camPos: [0, 2, 0], propPos: [120, 0, 120], viewportH: 1080, fovY: Math.PI / 3, thresholdPx: 2 },
      ruin.culling.maxDistance * 0.01,
    );
    expect(near).toBeGreaterThanOrEqual(0);
    expect(far).toBeGreaterThan(near);
  });

  it("returns billboard LOD index beyond billboard_from distance", () => {
    const lod = selectPropLodIndex(
      ruin,
      { camPos: [0, 2, 0], propPos: [220, 0, 0], viewportH: 1080, fovY: Math.PI / 3, thresholdPx: 2 },
      4,
    );
    expect(lod).toBe(ruin.lod.distances.length);
  });

  it("culls beyond max distance", () => {
    const lod = selectPropLodIndex(
      ruin,
      { camPos: [0, 2, 0], propPos: [1000, 0, 0], viewportH: 1080, fovY: Math.PI / 3, thresholdPx: 2 },
      4,
    );
    expect(lod).toBe(-1);
  });

  it("applies shadow, reflection, and collider distance gates", () => {
    const distance = propDistanceToCamera([0, 0, 0], [80, 0, 0], 2);
    expect(propCastsShadow(ruin, distance)).toBe(false);
    expect(propNeedsCollider(ruin, 30)).toBe(true);
    expect(propNeedsCollider(ruin, 80)).toBe(false);
  });
});
