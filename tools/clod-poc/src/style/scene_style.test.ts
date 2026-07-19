import { afterEach, describe, expect, it, vi } from "vitest";
import { readStoneStyle } from "../stones/stone_style.js";
import { DEFAULT_GRASS_APPEARANCE_SETTINGS } from "../grass/grass_config_defaults.js";
import { hexToLinearRgb } from "../grass/grass_palette.js";
import {
  readSceneStyle,
  registerSceneStyleApplier,
  SCENE_STYLE_PRESETS,
  setSceneStyle,
} from "./scene_style.js";

afterEach(() => setSceneStyle("realistic"));

describe("scene style presets", () => {
  it("keeps the realistic grass preset equal to the shared palette defaults", () => {
    const grass = SCENE_STYLE_PRESETS.realistic.grass;
    const base = hexToLinearRgb(grass.baseColor, [0, 0, 0]);
    for (let channel = 0; channel < 3; channel++) {
      expect(base[channel]).toBeCloseTo(DEFAULT_GRASS_APPEARANCE_SETTINGS.baseColor[channel]!, 2);
    }
    expect(grass.patchStrength).toBe(DEFAULT_GRASS_APPEARANCE_SETTINGS.patchStrength);
    expect(SCENE_STYLE_PRESETS.realistic.vegetationWrap).toBe(0);
    expect(SCENE_STYLE_PRESETS.realistic.water).toEqual({ foamShoreMul: 1, normalFlattenPull: 0, glitter: true });
  });

  it("applies the current style immediately on registration and fans out on change", () => {
    const applier = vi.fn();
    const unregister = registerSceneStyleApplier(applier);
    expect(applier).toHaveBeenCalledTimes(1);
    expect(applier).toHaveBeenLastCalledWith(SCENE_STYLE_PRESETS.realistic, "realistic");

    setSceneStyle("toon");
    expect(applier).toHaveBeenCalledTimes(2);
    expect(applier).toHaveBeenLastCalledWith(SCENE_STYLE_PRESETS.toon, "toon");
    expect(readSceneStyle().name).toBe("toon");

    unregister();
    setSceneStyle("stylized");
    expect(applier).toHaveBeenCalledTimes(2);
  });

  it("drives the stone style with the same preset name", () => {
    setSceneStyle("stylized");
    expect(readStoneStyle().name).toBe("stylized");
    setSceneStyle("realistic");
    expect(readStoneStyle().name).toBe("realistic");
  });
});
