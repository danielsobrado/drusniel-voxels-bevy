import { describe, expect, it } from "vitest";
import type { WaterField } from "./waterField.js";
import { DEFAULT_RIVER_MATERIAL_SETTINGS } from "./riverMaterialRuntime.js";
import { createRiverBankResidueBuildJob } from "./riverBankResidueOverlay.js";

function makeField(): WaterField {
  return {
    sample(x: number, z: number) {
      const wet = x > 0;
      return {
        waterY: wet ? 1 : -1,
        terrainY: 0,
        depth: wet ? 1 : -1,
        bodyMask: wet ? 1 : 0,
        flow: { x: 1, z: z * 0, speed: wet ? 0.8 : 0, progress: 0, drop: wet ? 1 : 0 },
      };
    },
  } as WaterField;
}

describe("river bank residue build job", () => {
  it("spreads sampling and geometry generation across bounded steps", () => {
    const job = createRiverBankResidueBuildJob(
      makeField(),
      DEFAULT_RIVER_MATERIAL_SETTINGS,
      0,
      0,
    );

    expect(job.step(1, 1)).toBeNull();

    let result = null;
    let steps = 1;
    while (!result && steps < 1_000) {
      result = job.step(1, 1);
      steps += 1;
    }

    expect(result).not.toBeNull();
    expect(steps).toBeGreaterThan(625);
    expect(result!.wet.drawCount).toBeGreaterThan(0);
    expect(result!.wet.positions.every(Number.isFinite)).toBe(true);
  });
});
