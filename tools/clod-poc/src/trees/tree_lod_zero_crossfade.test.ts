import { describe, expect, it } from "vitest";
import { cloneTreeSettings } from "./tree_config_defaults.js";
import { selectTreeLod, treeLodDistances } from "./tree_lod.js";

describe("tree LOD with disabled crossfade band", () => {
  it("uses hysteresis instead of unstable zero-band dithering", () => {
    const settings = cloneTreeSettings();
    settings.lod.crossfadeEnabled = true;
    settings.lod.ditherEnabled = true;
    settings.lod.crossfadeBandM = 0;
    settings.lod.hysteresisM = 8;

    const nearBoundary = treeLodDistances(settings).near;
    const selection = selectTreeLod(nearBoundary + 4, "near", settings);

    expect(selection.lod).toBe("near");
    expect(selection.secondaryLod).toBeNull();
    expect(selection.fade).toBe(1);
  });
});
