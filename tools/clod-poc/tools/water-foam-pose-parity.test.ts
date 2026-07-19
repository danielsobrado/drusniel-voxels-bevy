import { describe, expect, it } from "vitest";
import {
  assertWaterFoamAcceptancePosesMatch,
  extractWaterFoamAcceptancePoses,
} from "./water-foam-pose-parity.js";

const REPORT = {
  captures: {
    rapid: { pose: { x: 10, z: 20, yaw: 0.5, distance: 24, pitch: -0.2, depth: 0.4 } },
    smoothRiver: { pose: { x: 30, z: 40, yaw: 1.5, distance: 26, pitch: -0.3 } },
    lakeShore: { pose: { x: 50, z: 60, yaw: 2.5, distance: 28, pitch: -0.4 } },
  },
};

describe("water foam acceptance pose parity", () => {
  it("extracts only camera fields from an acceptance report", () => {
    const poses = extractWaterFoamAcceptancePoses(REPORT);

    expect(poses.rapid).toEqual({ x: 10, z: 20, yaw: 0.5, distance: 24, pitch: -0.2 });
    expect(poses.rapid).not.toHaveProperty("depth");
  });

  it("accepts identical poses", () => {
    const expected = extractWaterFoamAcceptancePoses(REPORT);
    const actual = extractWaterFoamAcceptancePoses(structuredClone(REPORT));

    expect(() => assertWaterFoamAcceptancePosesMatch(expected, actual)).not.toThrow();
  });

  it("rejects cross-tier camera drift", () => {
    const changed = structuredClone(REPORT);
    changed.captures.smoothRiver.pose.x += 0.25;

    expect(() => assertWaterFoamAcceptancePosesMatch(
      extractWaterFoamAcceptancePoses(REPORT),
      extractWaterFoamAcceptancePoses(changed),
    )).toThrow(/smooth river\.x/);
  });

  it("rejects malformed reports", () => {
    expect(() => extractWaterFoamAcceptancePoses({ captures: {} })).toThrow(/rapid capture/);
  });
});
