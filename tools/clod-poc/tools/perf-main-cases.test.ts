import { describe, expect, it } from "vitest";
import { PERF_MAIN_CASES, selectPerfMainCases } from "./perf-main-cases.js";

describe("perf main cases", () => {
  it("runs infinite-islands as the moving infinite-islands scene", () => {
    const [perfCase] = selectPerfMainCases("infinite-islands");

    expect(perfCase).toEqual({
      name: "infinite-islands",
      params: { scene: "infinite-islands", freeze: "0" },
    });
  });

  it("keeps every registered case selectable by name", () => {
    for (const perfCase of PERF_MAIN_CASES) {
      expect(selectPerfMainCases(perfCase.name)).toEqual([perfCase]);
    }
  });
});
