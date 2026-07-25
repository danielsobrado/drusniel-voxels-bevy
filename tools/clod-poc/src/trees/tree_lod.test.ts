import { describe, expect, it } from "vitest";
import {
  DEFAULT_TREE_SETTINGS,
  canopyVisibility,
  selectTreeLod,
  treeImpostorVisibility,
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
    impostorEndM: 200,
    canopyFadeStartM: 160,
    canopyFadeEndM: 200,
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

  it("keeps the shipping config's four LOD bands distinct, ascending, and all reachable", () => {
    const d = treeLodDistances(DEFAULT_TREE_SETTINGS);
    expect(d.near).toBeLessThan(d.mid);
    expect(d.mid).toBeLessThan(d.far);
    expect(d.far).toBeLessThan(d.impostor);
    const reached = new Set<string>();
    for (let distance = 0; distance <= d.impostor + 20; distance += 2) {
      reached.add(selectTreeLod(distance, null, DEFAULT_TREE_SETTINGS, { allowCrossfade: false }).lod);
    }
    expect([...reached].sort()).toEqual(["far", "impostor", "mid", "near"]);
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
      lod: { ...settings.lod, crossfadeEnabled: true, ditherEnabled: true, crossfadeBandM: 20 },
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

  it("can force one hard LOD even when crossfade settings are enabled", () => {
    const crossfadeSettings: TreeSettings = {
      ...settings,
      lod: { ...settings.lod, crossfadeEnabled: true, ditherEnabled: true, crossfadeBandM: 20 },
    };

    const selection = selectTreeLod(50, "near", crossfadeSettings, { allowCrossfade: false });

    expect(selection.lod).toBe("near");
    expect(selection.fade).toBe(1);
    expect(selection.secondaryLod).toBeNull();
    expect(selection.secondaryFade).toBe(0);
  });

  it("keeps far to impostor fades continuous across the impostor threshold", () => {
    const crossfadeSettings: TreeSettings = {
      ...settings,
      lod: { ...settings.lod, crossfadeEnabled: true, ditherEnabled: true, crossfadeBandM: 20 },
    };

    const beforeThreshold = selectTreeLod(145, null, crossfadeSettings);
    expect(beforeThreshold.lod).toBe("far");
    expect(beforeThreshold.secondaryLod).toBe("impostor");
    expect(beforeThreshold.fade).toBeCloseTo(0.75);
    expect(beforeThreshold.secondaryFade).toBeCloseTo(0.25);

    const atThreshold = selectTreeLod(150, null, crossfadeSettings);
    expect(atThreshold.lod).toBe("far");
    expect(atThreshold.secondaryLod).toBe("impostor");
    expect(atThreshold.fade).toBeCloseTo(0.5);
    expect(atThreshold.secondaryFade).toBeCloseTo(0.5);

    const afterThreshold = selectTreeLod(155, null, crossfadeSettings);
    expect(afterThreshold.lod).toBe("impostor");
    expect(afterThreshold.secondaryLod).toBe("far");
    expect(afterThreshold.fade).toBeCloseTo(0.75);
    expect(afterThreshold.secondaryFade).toBeCloseTo(0.25);
  });
});

describe("tree impostor canopy handoff", () => {
  it("uses the configured impostor end distance for the impostor band", () => {
    expect(treeLodDistances(DEFAULT_TREE_SETTINGS).impostor).toBe(760);
  });

  it("fades the impostor out across the configured handoff band", () => {
    expect(treeImpostorVisibility(620, DEFAULT_TREE_SETTINGS)).toBeCloseTo(1);
    expect(treeImpostorVisibility(690, DEFAULT_TREE_SETTINGS)).toBeCloseTo(0.5);
    expect(treeImpostorVisibility(760, DEFAULT_TREE_SETTINGS)).toBeCloseTo(0);
  });

  it("keeps tree impostor and far-canopy visibility complementary", () => {
    for (const distance of [620, 660, 690, 720, 760]) {
      const tree = treeImpostorVisibility(distance, DEFAULT_TREE_SETTINGS);
      const canopy = canopyVisibility(
        distance,
        DEFAULT_TREE_SETTINGS.lod.canopyFadeStartM,
        DEFAULT_TREE_SETTINGS.lod.canopyFadeEndM,
      );
      expect(tree + canopy).toBeCloseTo(1);
    }
  });

  it("scales the impostor selection fade by the remaining tree visibility", () => {
    const handoffSettings: TreeSettings = {
      ...DEFAULT_TREE_SETTINGS,
      distanceM: 760,
      lod: {
        ...DEFAULT_TREE_SETTINGS.lod,
        crossfadeEnabled: false,
        ditherEnabled: false,
        crossfadeBandM: 0,
        impostorEndM: 760,
        canopyFadeStartM: 620,
        canopyFadeEndM: 760,
      },
    };

    const midHandoff = selectTreeLod(690, null, handoffSettings);
    expect(midHandoff.lod).toBe("impostor");
    expect(midHandoff.fade).toBeCloseTo(0.5);
  });
});
