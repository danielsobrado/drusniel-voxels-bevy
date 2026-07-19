import { describe, expect, it } from "vitest";
import {
  assertWaterFoamAcceptancePosesMatch,
  extractWaterFoamAcceptancePoses,
  waterFoamAcceptancePosesMatch,
} from "./water-foam-pose-parity.js";

const REPORT = {
  captures: {
    rapid: { pose: { x: 10, z: 20, yaw: 0.5, distance: 24, pitch: -0.2, depth: 0.4 } },
    smoothRiver: { pose: { x: 30, z: 40, yaw: 1.5, distance: 26, pitch: -0.3 } },
    lakeShore: { pose: { x: 50, z: 60, yaw: 2.5, distance: 28, pitch: -0.4 } },
  },
};

describe("water foam acceptance pose parity", () => {
  it("extracts only camera pose fields from an acceptance report", () => {
    const poses = extractWaterFoamAcceptancePoses(REPORT);

    expect(poses.rapid).toEqual({ x: 10, z: 20, yaw: 0.5, distance: 24, pitch: -0.2 });
    expect(poses.rapid).not.toHaveProperty("depth");
  });

  it("accepts identical quality-tier poses", () => {
    const expected = extractWaterFoamAcceptancePoses(REPORT);
    const actual = extractWaterFoamAcceptancePoses(structuredClone(REPORT));

    expect(waterFoamAcceptancePosesMatch(expected, actual)).toBe(true);
    expect(() => assertWaterFoamAcceptancePosesMatch(expected, actual)).not.toThrow();
  });

  it("rejects camera drift between quality tiers", () => {
    const changed = structuredClone(REPORT);
    changed.captures.smoothRiver.pose.x += 0.25;
    const expected = extractWaterFoamAcceptancePoses(REPORT);
    const actual = extractWaterFoamAcceptancePoses(changed);

    expect(waterFoamAcceptancePosesMatch(expected, actual)).toBe(false);
    expect(() => assertWaterFoamAcceptancePosesMatch(expected, actual)).toThrow(/smooth river\.x/);
  });

  it("rejects malformed pose reports", () => {
    expect(() => extractWaterFoamAcceptancePoses({ captures: {} })).toThrow(/rapid capture/);
    expect(() => extractWaterFoamAcceptancePoses({
      captures: {
        rapid: { pose: { x: Number.NaN, z: 1 } },
        smoothRiver: { pose: { x: 1, z: 1 } },
        lakeShore: { pose: { x: 1, z: 1 } },
      },
    })).toThrow(/rapid pose x must be finite/);
  });
});
