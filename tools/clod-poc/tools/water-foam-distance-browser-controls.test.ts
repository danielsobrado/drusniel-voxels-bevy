import { describe, expect, it, vi } from "vitest";
import type { CdpPage } from "./water-harness.js";
import {
  assertWaterFoamAuxiliaryState,
  assertWaterFoamDistanceState,
  assertWaterFoamTimeState,
  resetWaterFoamDistanceControls,
  runWaterFoamDistanceCapture,
  setWaterFoamAuxiliaryOverlaysHidden,
  setWaterFoamDistanceOverride,
  setWaterFoamTimeFrozen,
} from "./water-foam-distance-browser-controls.js";

function pageWithEvaluate(
  evaluate: (expression: string) => unknown | Promise<unknown>,
): CdpPage {
  return { evaluate } as unknown as CdpPage;
}

function successfulResetPage(): CdpPage {
  return pageWithEvaluate((expression) => {
    if (expression.includes("DistanceOverride")) return { enabled: false, distanceM: 0 };
    if (expression.includes("TimeFrozen")) return { frozen: false };
    return { hidden: false, matched: 0 };
  });
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

  it("sets and validates auxiliary overlay isolation", async () => {
    const page = pageWithEvaluate(() => ({ hidden: true, matched: 3 }));

    const state = await setWaterFoamAuxiliaryOverlaysHidden(page, true);

    expect(state).toEqual({ hidden: true, matched: 3 });
    expect(() => assertWaterFoamAuxiliaryState(state, true, "capture")).not.toThrow();
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
    await expect(setWaterFoamAuxiliaryOverlaysHidden(
      pageWithEvaluate(() => ({ hidden: true, matched: -1 })),
      true,
    )).rejects.toThrow(/invalid state/);
  });

  it("resets distance, time, and auxiliary visibility", async () => {
    const evaluate = vi.fn((expression: string) => {
      if (expression.includes("DistanceOverride")) return { enabled: false, distanceM: 0 };
      if (expression.includes("TimeFrozen")) return { frozen: false };
      return { hidden: false, matched: 0 };
    });
    const result = await resetWaterFoamDistanceControls(pageWithEvaluate(evaluate));

    expect(result).toEqual({
      distance: { enabled: false, distanceM: 0 },
      time: { frozen: false },
      auxiliary: { hidden: false, matched: 0 },
    });
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it("attempts every cleanup even when distance reset fails", async () => {
    const evaluate = vi.fn((expression: string) => {
      if (expression.includes("DistanceOverride")) throw new Error("distance failure");
      if (expression.includes("TimeFrozen")) return { frozen: false };
      return { hidden: false, matched: 0 };
    });

    await expect(resetWaterFoamDistanceControls(pageWithEvaluate(evaluate)))
      .rejects.toThrow(/distance reset: distance failure/);
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(evaluate.mock.calls[1]?.[0]).toContain("setWaterFoamTimeFrozen(false)");
    expect(evaluate.mock.calls[2]?.[0]).toContain("setWaterFoamAuxiliaryOverlaysHidden(false)");
  });

  it("returns capture value and verified reset state", async () => {
    const result = await runWaterFoamDistanceCapture(
      successfulResetPage(),
      async () => ({ captured: true }),
    );

    expect(result).toEqual({
      value: { captured: true },
      reset: {
        distance: { enabled: false, distanceM: 0 },
        time: { frozen: false },
        auxiliary: { hidden: false, matched: 0 },
      },
    });
  });

  it("preserves the capture failure when cleanup succeeds", async () => {
    await expect(runWaterFoamDistanceCapture(
      successfulResetPage(),
      async () => {
        throw new Error("capture failure");
      },
    )).rejects.toThrow(/^capture failure$/);
  });

  it("reports capture and cleanup failures together", async () => {
    const page = pageWithEvaluate(() => {
      throw new Error("cleanup failure");
    });

    await expect(runWaterFoamDistanceCapture(page, async () => {
      throw new Error("capture failure");
    })).rejects.toThrow(
      /foam distance capture failed: capture failure; cleanup failed: foam distance control cleanup failed/,
    );
  });

  it("rejects incorrect reset states and insufficient isolation", async () => {
    expect(() => assertWaterFoamAuxiliaryState(
      { hidden: true, matched: 1 },
      true,
      "capture",
    )).toThrow(/matched only 1 overlays/);

    const page = pageWithEvaluate((expression) => {
      if (expression.includes("DistanceOverride")) return { enabled: true, distanceM: 100 };
      if (expression.includes("TimeFrozen")) return { frozen: true };
      return { hidden: true, matched: 2 };
    });

    await expect(resetWaterFoamDistanceControls(page)).rejects.toThrow(/cleanup failed/);
  });
});
