import { describe, expect, it } from "vitest";
import {
  DEFAULT_TREE_SETTINGS,
  selectTreeLod,
  treeLodDistances,
  type TreeSettings,
} from "./index.js";

const settings: TreeSettings = {
  ...DEFAULT_TREE_SETTINGS,
  distanceM: 200,
  lod: {
    ...DEFAULT_TREE_SETTINGS.lod,
    nearFraction: 0.25,
    midFraction: 0.5,
    farFraction: 0.75,
    impostorFraction: 1,
    hysteresisM: 10,
    crossfadeEnabled: false,
    crossfadeBandM: 20,
  },
};

describe("tree LOD selection", () => {
  it("maps configured fractions to world distances", () => {
    expect(treeLodDistances(settings)).toEqual({
      near: 50,
      mid: 100,
      far: 150,
      impostor: 200,
    });
  });

  it("selects the four LOD bands by distance", () => {
    expect(selectTreeLod(25, null, settings).lod).toBe("near");
    expect(selectTreeLod(75, null, settings).lod).toBe("mid");
    expect(selectTreeLod(125, null, settings).lod).toBe("far");
    expect(selectTreeLod(175, null, settings).lod).toBe("impostor");
    expect(selectTreeLod(250, null, settings).lod).toBe("impostor");
  });

  it("uses hysteresis to keep the previous LOD near thresholds", () => {
    expect(selectTreeLod(54, "near", settings).lod).toBe("near");
    expect(selectTreeLod(61, "near", settings).lod).toBe("mid");
    expect(selectTreeLod(96, "far", settings).lod).toBe("far");
    expect(selectTreeLod(89, "far", settings).lod).toBe("mid");
  });

  it("returns secondary LOD and fade weights inside a crossfade band", () => {
    const crossfadeSettings: TreeSettings = {
      ...settings,
      lod: { ...settings.lod, crossfadeEnabled: true, crossfadeBandM: 20 },
    };

    const beforeThreshold = selectTreeLod(45, null, crossfadeSettings);
    expect(beforeThreshold.lod).toBe("near");
    expect(beforeThreshold.secondaryLod).toBe("mid");
    expect(beforeThreshold.fade).toBeCloseTo(0.75);
    expect(beforeThreshold.secondaryFade).toBeCloseTo(0.25);

    const afterThreshold = selectTreeLod(55, null, crossfadeSettings);
    expect(afterThreshold.lod).toBe("mid");
    expect(afterThreshold.secondaryLod).toBe("near");
    expect(afterThreshold.fade).toBeCloseTo(0.75);
    expect(afterThreshold.secondaryFade).toBeCloseTo(0.25);
  });
});
