import { describe, expect, it } from "vitest";
import configText from "../../../../config/ecological_dressing.yaml?raw";
import { parseDressingConfig } from "../config.js";
import { DRESSING_CLASSES } from "../class_registry.js";
import {
  DRESSING_GPU_GROUP_COUNT,
  DRESSING_GPU_LOD_COUNT,
  buildDressingGpuLayout,
  dressingGpuGroupIndex,
} from "./layouts.js";

describe("dressing GPU layout", () => {
  it("packs every class into three indirect LOD groups", () => {
    const config = parseDressingConfig(configText);
    const indexCounts = new Uint32Array(DRESSING_GPU_GROUP_COUNT).fill(36);
    const layout = buildDressingGpuLayout(config, "balanced", indexCounts);
    expect(layout.classes).toHaveLength(DRESSING_CLASSES.length);
    expect(DRESSING_GPU_GROUP_COUNT).toBe(DRESSING_CLASSES.length * DRESSING_GPU_LOD_COUNT);
    expect(layout.totalCandidateSlots).toBeGreaterThan(0);
    expect(layout.persistentCandidateEnd).toBeLessThanOrEqual(layout.terrainCandidateStart);
    expect(layout.terrainCandidateEnd).toBe(layout.totalCandidateSlots);
    expect(layout.classes.filter((entry) => entry.ownership === "parent_attached").every((entry) => entry.slotCount === 0)).toBe(true);
    expect(layout.classes.find((entry) => entry.classId === "stump_fresh")?.slotCount).toBe(0);
    expect(layout.classes.find((entry) => entry.classId === "stump_rotten")?.slotCount).toBe(0);
    expect(new Uint32Array(layout.packed)[16]).toBe(36);
  });

  it("keeps persistent density stable across quality presets", () => {
    const config = parseDressingConfig(configText);
    const counts = new Uint32Array(DRESSING_GPU_GROUP_COUNT).fill(6);
    const ultra = buildDressingGpuLayout(config, "ultra", counts);
    const potato = buildDressingGpuLayout(config, "potato", counts);
    expect(potato.classes[0]?.acceptanceProbability).toBe(ultra.classes[0]?.acceptanceProbability);
    const moss = DRESSING_CLASSES.indexOf("moss_patch");
    expect(potato.classes[moss]?.acceptanceProbability).toBeLessThan(ultra.classes[moss]?.acceptanceProbability ?? 0);
    expect(dressingGpuGroupIndex("flower_patch", 2)).toBe(DRESSING_GPU_GROUP_COUNT - 1);
  });
});
