import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  gradeForLighting,
  gradeForSunHeight,
  parsePostFxColorScript,
} from "./postfx_color_script.js";

describe("postfx color script", () => {
  it("parses yaml keyframes in sun-height order", () => {
    const script = parsePostFxColorScript(`
postfx_color_script:
  keyframes:
    - sun_height: 1
      white_balance: [1, 1, 1]
      shadow_tint: [1, 1, 1]
      shadow_amount: 0.1
      highlight_tint: [1, 1, 1]
      highlight_amount: 0.1
      saturation: 1.1
      contrast: 1.1
    - sun_height: -1
      white_balance: [0.8, 0.9, 1.1]
      shadow_tint: [0.8, 0.9, 1.1]
      shadow_amount: 0.4
      highlight_tint: [1, 1, 1]
      highlight_amount: 0.2
      saturation: 0.8
      contrast: 1.0
`);
    expect(script.keyframes.map((keyframe) => keyframe.sunHeight)).toEqual([-1, 1]);
  });

  it("interpolates between neighbouring keyframes", () => {
    const script = parsePostFxColorScript(`
postfx_color_script:
  keyframes:
    - sun_height: 0
      white_balance: [1, 1, 1]
      shadow_tint: [1, 1, 1]
      shadow_amount: 0
      highlight_tint: [1, 1, 1]
      highlight_amount: 0
      saturation: 1
      contrast: 1
    - sun_height: 1
      white_balance: [2, 2, 2]
      shadow_tint: [1, 1, 1]
      shadow_amount: 1
      highlight_tint: [1, 1, 1]
      highlight_amount: 1
      saturation: 2
      contrast: 2
`);
    const grade = gradeForSunHeight(script, 0.5);
    expect(grade.whiteBalance).toEqual([1.5, 1.5, 1.5]);
    expect(grade.shadowAmount).toBeCloseTo(0.5);
    expect(grade.saturation).toBeCloseTo(1.5);
  });

  it("uses lighting sun height as the grade driver", () => {
    const script = parsePostFxColorScript(`
postfx_color_script:
  keyframes:
    - sun_height: 0
      white_balance: [1, 1, 1]
      shadow_tint: [1, 1, 1]
      shadow_amount: 0
      highlight_tint: [1, 1, 1]
      highlight_amount: 0
      saturation: 1
      contrast: 1
    - sun_height: 1
      white_balance: [2, 2, 2]
      shadow_tint: [1, 1, 1]
      shadow_amount: 1
      highlight_tint: [1, 1, 1]
      highlight_amount: 1
      saturation: 2
      contrast: 2
`);
    const grade = gradeForLighting({
      sunDirection: new Vector3(0, 0.25, 0),
      sunColor: null as never,
      skyLight: null as never,
      groundLight: null as never,
    }, script);
    expect(grade.whiteBalance).toEqual([1.25, 1.25, 1.25]);
  });
});
