import { describe, expect, it } from "vitest";
import { parseWaterNormalModel, waterNormalModelId } from "./water_normal_models.js";

describe("water normal models", () => {
  it("assigns stable shader ids", () => {
    expect(waterNormalModelId("fable5")).toBe(0);
    expect(waterNormalModelId("glacial")).toBe(1);
    expect(waterNormalModelId("legacy")).toBe(2);
  });

  it("parses supported models and falls back safely", () => {
    expect(parseWaterNormalModel("glacial", "fable5")).toBe("glacial");
    expect(parseWaterNormalModel("legacy", "fable5")).toBe("legacy");
    expect(parseWaterNormalModel("unknown", "fable5")).toBe("fable5");
  });
});
