import { describe, expect, it } from "vitest";
import { compositePremultipliedCloudReference } from "./postfx_cloud_nodes.js";

describe("volumetric cloud compositing", () => {
  it("adds premultiplied cloud radiance without multiplying alpha twice", () => {
    const result = compositePremultipliedCloudReference(
      [0.2, 0.4, 0.6],
      [0.3, 0.2, 0.1],
      0.5,
    );

    expect(result).toEqual([0.4, 0.4, 0.4]);
  });

  it("clamps opacity while preserving the accumulated cloud radiance", () => {
    expect(compositePremultipliedCloudReference([1, 1, 1], [0.2, 0.3, 0.4], 2))
      .toEqual([0.2, 0.3, 0.4]);
    expect(compositePremultipliedCloudReference([1, 1, 1], [0, 0, 0], -1))
      .toEqual([1, 1, 1]);
  });
});
