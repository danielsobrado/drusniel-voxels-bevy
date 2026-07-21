import { describe, expect, it } from "vitest";
import { readWaterNormalModelOverride } from "./water_config_runtime_overrides.js";

describe("water normal model URL override", () => {
  it.each(["fable5", "glacial", "legacy"] as const)("accepts %s", (model) => {
    const params = new URLSearchParams({ waterNormalModel: model });

    expect(readWaterNormalModelOverride(params, "fable5")).toBe(model);
  });

  it("falls back for absent or unsupported values", () => {
    expect(readWaterNormalModelOverride(new URLSearchParams(), "glacial")).toBe("glacial");
    expect(readWaterNormalModelOverride(
      new URLSearchParams({ waterNormalModel: "unknown" }),
      "legacy",
    )).toBe("legacy");
  });
});
