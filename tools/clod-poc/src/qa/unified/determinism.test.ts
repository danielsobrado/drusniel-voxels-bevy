import { describe, expect, it } from "vitest";
import { compareJsonValues } from "./determinism.js";

describe("determinism comparison", () => {
  it("accepts numeric drift inside the declared tolerance", () => {
    expect(compareJsonValues({ value: 1 }, { value: 1.004 }, new Set(), 0.005)).toEqual([]);
  });

  it("reports drift outside the declared tolerance", () => {
    expect(compareJsonValues({ value: 1 }, { value: 1.006 }, new Set(), 0.005)).toHaveLength(1);
  });

  it("ignores explicitly volatile keys at any depth", () => {
    const left = { captured_utc: "a", nested: { captured_utc: "b", stable: 4 } };
    const right = { captured_utc: "x", nested: { captured_utc: "y", stable: 4 } };
    expect(compareJsonValues(left, right, new Set(["captured_utc"]), 0)).toEqual([]);
  });
});
