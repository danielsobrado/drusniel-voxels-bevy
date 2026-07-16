import { describe, expect, it } from "vitest";
import { precisionLandmarkRenderPosition } from "./precision_landmarks.js";

describe("precision diagnostic landmarks", () => {
  it("converts logical world coordinates into floating-origin render coordinates", () => {
    expect(precisionLandmarkRenderPosition([8_192.25, 42, -7_999.5], { x: 8_192, z: -8_192 }))
      .toEqual([0.25, 42, 192.5]);
  });

  it("leaves fp32-world positions unchanged when the origin is zero", () => {
    expect(precisionLandmarkRenderPosition([-8_000, 96, 8_000], { x: 0, z: 0 }))
      .toEqual([-8_000, 96, 8_000]);
  });
});
