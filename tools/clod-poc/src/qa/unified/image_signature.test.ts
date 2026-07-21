import { describe, expect, it } from "vitest";
import { buildImageSignature } from "./image_signature.js";
import type { LinearImage } from "./image_linear.js";

describe("QA image signature", () => {
  it("is stable for identical linear images", () => {
    const image: LinearImage = {
      width: 2,
      height: 2,
      rgb: new Float32Array([
        0, 0, 0,
        1, 1, 1,
        1, 0, 0,
        0, 1, 0,
      ]),
    };
    expect(buildImageSignature(image, 2)).toEqual(buildImageSignature(image, 2));
  });

  it("detects a changed spatial layout", () => {
    const left: LinearImage = {
      width: 2,
      height: 2,
      rgb: new Float32Array([0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1, 0]),
    };
    const right: LinearImage = {
      width: 2,
      height: 2,
      rgb: new Float32Array([1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0]),
    };
    expect(buildImageSignature(left, 2).linearRgbGrid).not.toEqual(buildImageSignature(right, 2).linearRgbGrid);
  });
});
