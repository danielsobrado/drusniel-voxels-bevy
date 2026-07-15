import * as THREE from "three";
import { describe, expect, it } from "vitest";
import configText from "../../../config/ecological_dressing.yaml?raw";
import classRulesSource from "./gpu/class_rules.wgsl?raw";
import { DEFAULT_DRESSING_CONFIG, parseDressingConfig } from "./config.js";
import { DressingSystem } from "./dressing_system.js";
import {
  DRESSING_ENVIRONMENT_STRIDE_BYTES,
  DRESSING_INSTANCE_STRIDE_BYTES,
  validateDressingGpuCapacities,
} from "./gpu/layouts.js";

describe("ecological dressing runtime", () => {
  it("parses the shipped strict config", () => {
    expect(parseDressingConfig(configText)).toEqual(DEFAULT_DRESSING_CONFIG);
    expect(parseDressingConfig("ecological_dressing:\n  enabled: false\n  lod:\n    persistent: [1, 2, 3]\n").enabled).toBe(false);
    expect(() => parseDressingConfig("ecological_dressing:\n  lod:\n    persistent: [3, 2, 1]\n")).toThrow(/ordered/i);
    expect(() => parseDressingConfig("ecological_dressing:\n  persistence:\n    save_cosmetic_items: true\n")).toThrow(/may not be serialized/i);
  });

  it("builds deterministic instanced dressing groups and disposes them", () => {
    const firstScene = new THREE.Scene();
    const secondScene = new THREE.Scene();
    const options = {
      worldCells: 96,
      worldSeed: 19,
      config: DEFAULT_DRESSING_CONFIG,
      quality: "ultra" as const,
      maximumInstances: 2_000,
    };
    const first = new DressingSystem({ scene: firstScene, ...options });
    const second = new DressingSystem({ scene: secondScene, ...options });

    expect(firstScene.getObjectByName("ecological-dressing")).toBeDefined();
    expect(first.getStats().dressing_candidates_accepted).toBeGreaterThan(0);
    expect(first.getStats().dressing_candidates_accepted).toBe(second.getStats().dressing_candidates_accepted);
    expect(first.getStats().perClass).toEqual(second.getStats().perClass);

    first.dispose();
    second.dispose();
    expect(firstScene.getObjectByName("ecological-dressing")).toBeUndefined();
  });

  it("locks GPU layouts, class-rule coverage, and overflow-safe capacities", () => {
    expect(DRESSING_ENVIRONMENT_STRIDE_BYTES).toBe(128);
    expect(DRESSING_INSTANCE_STRIDE_BYTES).toBe(64);
    expect(classRulesSource).toContain("const DRESSING_CLASS_COUNT: u32 = 29u");
    expect(classRulesSource).toContain("fn dressing_accept");
    expect(() => validateDressingGpuCapacities({
      environments: 1,
      terrainCandidates: 1,
      attachmentCandidates: 1,
      visibleInstances: 1,
      drawGroups: 29,
    })).toThrow(/visible capacity/i);
  });
});
