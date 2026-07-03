import { describe, expect, it } from "vitest";
import { resolveLiveBubbleBuildBudget } from "./near_field_bubble_controller.js";

describe("resolveLiveBubbleBuildBudget", () => {
  it("keeps the configured default when no override is provided", () => {
    expect(resolveLiveBubbleBuildBudget(4, new URLSearchParams())).toBe(4);
  });

  it("accepts the camelCase query override", () => {
    expect(resolveLiveBubbleBuildBudget(4, new URLSearchParams("liveBubbleBudget=7"))).toBe(7);
  });

  it("accepts the snake_case query override", () => {
    expect(resolveLiveBubbleBuildBudget(4, new URLSearchParams("live_bubble_budget=3"))).toBe(3);
  });

  it("floors fractional values and clamps invalid budgets to one", () => {
    expect(resolveLiveBubbleBuildBudget(4, new URLSearchParams("liveBubbleBudget=2.9"))).toBe(2);
    expect(resolveLiveBubbleBuildBudget(Number.NaN, new URLSearchParams("liveBubbleBudget=0"))).toBe(1);
  });
});
