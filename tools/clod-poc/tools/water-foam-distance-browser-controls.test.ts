import { describe, expect, it, vi } from "vitest";
import type { CdpPage } from "./water-harness.js";
import {
  assertWaterFoamDistanceState,
  assertWaterFoamTimeState,
  resetWaterFoamDistanceControls,
  setWaterFoamDistanceOverride,
  setWaterFoamTimeFrozen,
} from "./water-foam-distance-browser-controls.js";

function pageWithEvaluate(
  evaluate: (expression: string) => unknown | Promise<unknown>,
): CdpPage {
  return { evaluate } as unknown as CdpPage;
}

describe("water foam distance browser controls", () => {
  it("sets and validates synthetic distance", async () => {
    const page = pageWithEvaluate(() => ({ enabled: true, distanceM: 220 }));

    const state = await setWaterFoamDistanceOverride(page, 220);

    expect(state).toEqual({ enabled: true, distanceM: 220 });
    expect(() => assertWaterFoamDistanceState(state, 220, "mid")).not.toThrow();
  });

  it("sets and validates frozen time", async () => {
    const page = pageWithEvaluate(() => ({ frozen: true }));

    const state = await setWaterFoamTimeFrozen(page, true);

    expect(state).toEqual({ frozen: true });
    expect(() => assertWaterFoamTimeState(state, true, "freeze")).not.toThrow();
  });

  it("rejects invalid browser states", async () => {
    await expect(setWaterFoamDistanceOverride(
      pageWithEvaluate(() => ({ enabled: true, distanceM: Number.NaN })),
      220,
    )).rejects.toThrow(/invalid state/);
    await expect(setWaterFoamTimeFrozen(
      pageWithEvaluate(() => ({ frozen: "yes" })),
      true,
    )).rejects.toThrow(/invalid state/);
  });

  it("resets distance and time and verifies both states", async () => {
    const evaluate = vi.fn((expression: string) => expression.includes("DistanceOverride")
      ? { enabled: false, distanceM: 0 }
      : { frozen: false });
    const result = await resetWaterFoamDistanceControls(pageWithEvaluate(evaluate));

    expect(result).toEqual({
      distance: { enabled: false, distanceM: 0 },
      time: { frozen: false },
    });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it("attempts time unfreeze even when distance reset fails", async () => {
    const evaluate = vi.fn((expression: string) => {
      if (expression.includes("DistanceOverride")) throw new Error("distance failure");
      return { frozen: false };
    });

    await expect(resetWaterFoamDistanceControls(pageWithEvaluate(evaluate)))
      .rejects.toThrow(/distance reset: distance failure/);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[1]?.[0]).toContain("setWaterFoamTimeFrozen(false)");
  });

  it("rejects incorrect reset states", async () => {
    const page = pageWithEvaluate((expression) => expression.includes("DistanceOverride")
      ? { enabled: true, distanceM: 100 }
      : { frozen: true });

    await expect(resetWaterFoamDistanceControls(page)).rejects.toThrow(/cleanup failed/);
  });
});
