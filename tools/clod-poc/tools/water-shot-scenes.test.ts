import { describe, expect, it, vi } from "vitest";
import {
  GLACIAL_WATER_SHOT_SCENES,
  STANDARD_WATER_SHOT_SCENES,
  WATER_SHOT_DEBUG_MODES,
  WATER_SHOT_SCENE_POLICIES,
  findWaterShotPose,
  parseWaterShotDebugModes,
  parseWaterShotScene,
} from "./water-shot-scenes.js";

describe("water shot scenes", () => {
  it("registers every standard and glacial scene", () => {
    for (const scene of [...STANDARD_WATER_SHOT_SCENES, ...GLACIAL_WATER_SHOT_SCENES, "low-sun-glitter"] as const) {
      expect(parseWaterShotScene(scene)).toBe(scene);
    }
    expect(() => parseWaterShotScene("unknown")).toThrow(/unknown --scene/);
  });

  it("accepts all runtime water debug modes and the clipmap alias", () => {
    for (const mode of WATER_SHOT_DEBUG_MODES) {
      expect(parseWaterShotDebugModes(mode)).toEqual([mode]);
    }
    expect(parseWaterShotDebugModes("clipmap-level")).toEqual(["clipmapLevel"]);
    expect(parseWaterShotDebugModes("all")).toEqual(WATER_SHOT_DEBUG_MODES);
    expect(() => parseWaterShotDebugModes("invalid")).toThrow(/unknown --debug/);
  });

  it("keeps policies finite and internally ordered", () => {
    for (const policy of Object.values(WATER_SHOT_SCENE_POLICIES)) {
      expect(policy.minDepth).toBeGreaterThanOrEqual(0);
      expect(policy.maxDepth).toBeGreaterThanOrEqual(policy.minDepth);
      expect(policy.targetDepth).toBeGreaterThanOrEqual(policy.minDepth);
      expect(policy.targetDepth).toBeLessThanOrEqual(policy.maxDepth);
      expect(policy.minWetFraction).toBeGreaterThanOrEqual(0);
      expect(policy.minWetFraction).toBeLessThanOrEqual(1);
      expect(policy.distance).toBeGreaterThan(0);
      expect(Number.isFinite(policy.pitch)).toBe(true);
    }
  });

  it("requires flow and bed drop for the rapid scene", () => {
    const policy = WATER_SHOT_SCENE_POLICIES["rapid-bed-step"];
    expect(policy.kind).toBe("river");
    expect(policy.minFlow).toBeGreaterThan(0);
    expect(policy.minDrop).toBeGreaterThan(0);
    expect(policy.viewMode).toBe("downstream");
  });

  it("requires deep calm lake water for the lake scene", () => {
    const policy = WATER_SHOT_SCENE_POLICIES["deep-glacial-lake"];
    expect(policy.kind).toBe("lake");
    expect(policy.minDepth).toBeGreaterThanOrEqual(0.5);
    expect(policy.calmWeight).toBeGreaterThan(0);
  });

  it("builds a deterministic browser probe and returns its result", async () => {
    const candidate = {
      x: 10,
      z: 12,
      yaw: 1,
      distance: 24,
      pitch: -0.28,
      depth: 0.2,
      wetFraction: 0.7,
      kind: "river" as const,
      flowSpeed: 0.1,
      flowDrop: 0.2,
      score: 4,
    };
    const evaluate = vi.fn(async () => candidate);

    await expect(findWaterShotPose({ evaluate }, "shallow-glacial-river", 64)).resolves.toEqual(candidate);
    const expression = evaluate.mock.calls[0]?.[0] ?? "";
    expect(expression).toContain('"viewMode":"downstream"');
    expect(expression).toContain("const worldCells = 64");
  });

  it("fails when no deterministic candidate is found", async () => {
    await expect(findWaterShotPose({ evaluate: async <T>() => null as T }, "deep-glacial-lake", 64))
      .rejects.toThrow(/could not find a deep-glacial-lake water shot/);
  });
});
