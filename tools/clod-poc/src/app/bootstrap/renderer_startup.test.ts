import { describe, expect, it } from "vitest";
import { playerWorldBoundsForScene } from "./renderer_startup.js";

describe("playerWorldBoundsForScene", () => {
  it("keeps continent-backed RPG density scenes unbounded for standing routes", () => {
    const bounds = playerWorldBoundsForScene(
      new URLSearchParams("scene=continent&rpgDensityScene=rpg-village"),
      2_048,
    );

    expect(bounds.minX).toBeLessThan(-8_000);
    expect(bounds.maxX).toBeGreaterThan(8_000);
  });
});
