import { MeshStandardNodeMaterial } from "three/webgpu";
import { describe, expect, it } from "vitest";
import {
  createGroundDebrisCpuNodeMaterial,
  GROUND_DEBRIS_CPU_WEBGPU_FADE_CELL_M,
  groundDebrisCpuFadeVisibility,
} from "./ground_debris_cpu_node_material.js";
import { groundDebrisVisualProfile } from "./gpu/ground_debris_visuals.js";

describe("WebGPU CPU ground-debris material", () => {
  it("creates an opaque NodeMaterial with a stable mask for owned classes", () => {
    const material = createGroundDebrisCpuNodeMaterial("leaf_litter");
    expect(material).toBeInstanceOf(MeshStandardNodeMaterial);
    expect(material?.name).toBe("ground-debris-cpu-webgpu-leaf_litter");
    expect(material?.colorNode).toBeDefined();
    expect(material?.roughnessNode).toBeDefined();
    expect(material?.maskNode).toBeDefined();
    expect(material?.transparent).toBe(false);
    expect(material?.depthWrite).toBe(true);
    expect(GROUND_DEBRIS_CPU_WEBGPU_FADE_CELL_M).toBe(0.5);
    material?.dispose();
  });

  it("uses the shared class fade ranges", () => {
    const profile = groundDebrisVisualProfile("river_cobbles");
    expect(profile).not.toBeNull();
    expect(groundDebrisCpuFadeVisibility(profile!.fadeStartM, profile!)).toBe(1);
    expect(groundDebrisCpuFadeVisibility(profile!.fadeEndM, profile!)).toBe(0);
    expect(groundDebrisCpuFadeVisibility((profile!.fadeStartM + profile!.fadeEndM) * 0.5, profile!)).toBeCloseTo(0.5);
    expect(groundDebrisCpuFadeVisibility(Number.NaN, profile!)).toBe(0);
  });

  it("does not claim unrelated dressing classes", () => {
    expect(createGroundDebrisCpuNodeMaterial("dead_log_fresh")).toBeNull();
  });
});
