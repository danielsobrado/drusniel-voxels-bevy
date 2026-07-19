import { describe, expect, it } from "vitest";
import { validateVisualSequenceConfig } from "./schema.js";

const config = {
  schemaVersion: 1,
  id: "static-rim",
  mode: "static",
  frames: 8,
  stepSeconds: 1 / 60,
  scene: "continent",
  seed: 1,
  start: { p: [1, 2, 3], yaw: 0, pitch: 0 },
  end: { p: [1, 2, 3], yaw: 0, pitch: 0 },
  query: {},
  captureDepth: true,
};

describe("visual sequence schema", () => {
  it("accepts bounded deterministic sequence configs", () => {
    expect(validateVisualSequenceConfig(config)).toMatchObject({ id: "static-rim", frames: 8 });
  });

  it("rejects oversized captures", () => {
    expect(() => validateVisualSequenceConfig({ ...config, frames: 97 })).toThrow(/2\.\.96/);
  });

  it("rejects negative metric thresholds", () => {
    expect(() => validateVisualSequenceConfig({ ...config, thresholds: { meanLuma: -1 } })).toThrow(/non-negative/);
  });
});
