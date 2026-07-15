import * as THREE from "three";
import { describe, expect, it } from "vitest";
import configText from "../../../config/ecological_dressing.yaml?raw";
import classRulesSource from "./gpu/class_rules.wgsl?raw";
import { DEFAULT_DRESSING_CONFIG, parseDressingConfig, type DressingConfig } from "./config.js";
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

  it("uses configured densities instead of hidden runtime constants", () => {
    const config: DressingConfig = {
      ...DEFAULT_DRESSING_CONFIG,
      densities: {
        ...DEFAULT_DRESSING_CONFIG.densities,
        deadfallPerHectare: 0,
        mossPatchesPerHectare: 0,
      },
      cosmeticDensityMultiplier: { ultra: 1, balanced: 1, perf: 1, potato: 1 },
    };
    const system = new DressingSystem({
      scene: new THREE.Scene(),
      worldCells: 96,
      worldSeed: 19,
      config,
      quality: "ultra",
      maximumInstances: 2_000,
    });

    expect(system.getStats().perClass.dead_log_fresh.generated).toBe(0);
    expect(system.getStats().perClass.dead_log_mossy.generated).toBe(0);
    expect(system.getStats().perClass.dead_log_rotten.generated).toBe(0);
    expect(system.getStats().perClass.moss_patch.generated).toBe(0);
    system.dispose();
  });

  it("never creates an unpaired stump when deadfall density is zero", () => {
    const config: DressingConfig = {
      ...DEFAULT_DRESSING_CONFIG,
      densities: {
        ...DEFAULT_DRESSING_CONFIG.densities,
        deadfallPerHectare: 0,
        stumpsPerHectare: 10_000,
      },
    };
    const system = new DressingSystem({
      scene: new THREE.Scene(),
      worldCells: 96,
      worldSeed: 19,
      config,
      quality: "ultra",
      maximumInstances: 2_000,
    });

    expect(system.getStats().perClass.stump_fresh.accepted).toBe(0);
    expect(system.getStats().perClass.stump_rotten.accepted).toBe(0);
    system.dispose();
  });

  it("retains diagnostics for paired stumps generated earlier in the pass", () => {
    const config: DressingConfig = {
      ...DEFAULT_DRESSING_CONFIG,
      densities: {
        ...DEFAULT_DRESSING_CONFIG.densities,
        deadfallPerHectare: 10_000,
        stumpsPerHectare: 10_000,
      },
    };
    const hydrologySystem = {
      sample: () => ({
        terrainY: 20,
        depth: 0,
        shoreDistance: 999,
        flowX: 0,
        flowZ: 0,
        moisture: 1,
        riverMask: 0,
        flowStrength: 0,
      }),
      terrainHeight: () => 20,
    };
    const system = new DressingSystem({
      scene: new THREE.Scene(),
      worldCells: 96,
      worldSeed: 19,
      config,
      hydrologySystem: hydrologySystem as never,
      quality: "ultra",
      maximumInstances: 4_000,
    });

    const stats = system.getStats();
    const generatedStumps = stats.perClass.stump_fresh.generated + stats.perClass.stump_rotten.generated;
    const visibleStumps = stats.perClass.stump_fresh.visible + stats.perClass.stump_rotten.visible;
    expect(visibleStumps).toBeGreaterThan(0);
    expect(generatedStumps).toBe(visibleStumps);
    expect(stats.dressing_parent_attached_visible).toBeGreaterThan(0);
    expect(stats.dressing_attachment_count).toBe(stats.dressing_parent_attached_visible);
    expect(stats.dressing_attachment_parents).toBeGreaterThan(0);
    system.dispose();
  });

  it("checks deadfall endpoint support against the carved hydrology surface", () => {
    const config: DressingConfig = {
      ...DEFAULT_DRESSING_CONFIG,
      densities: {
        ...DEFAULT_DRESSING_CONFIG.densities,
        deadfallPerHectare: 10_000,
        stumpsPerHectare: 0,
      },
    };
    const hydrologySystem = {
      sample: () => ({
        terrainY: 1_000,
        depth: 0,
        shoreDistance: 999,
        flowX: 0,
        flowZ: 0,
        moisture: 0.5,
        riverMask: 0,
        flowStrength: 0,
      }),
      terrainHeight: () => 1_000,
    };
    const system = new DressingSystem({
      scene: new THREE.Scene(),
      worldCells: 96,
      worldSeed: 19,
      config,
      hydrologySystem: hydrologySystem as never,
      quality: "ultra",
      maximumInstances: 2_000,
    });

    const stats = system.getStats();
    expect(stats.perClass.dead_log_fresh.accepted
      + stats.perClass.dead_log_mossy.accepted
      + stats.perClass.dead_log_rotten.accepted).toBeGreaterThan(0);
    system.dispose();
  });

  it("reuses authored geometry across residency refreshes", () => {
    const scene = new THREE.Scene();
    const config: DressingConfig = {
      ...DEFAULT_DRESSING_CONFIG,
      densities: { ...DEFAULT_DRESSING_CONFIG.densities, mossPatchesPerHectare: 10_000 },
      cosmeticDensityMultiplier: { ultra: 1, balanced: 1, perf: 1, potato: 1 },
    };
    const system = new DressingSystem({
      scene,
      worldCells: 96,
      worldSeed: 19,
      config,
      quality: "ultra",
      unboundedWorld: true,
      maximumInstances: 8_000,
    });
    const before = scene.getObjectByName("dressing:moss_patch") as THREE.InstancedMesh;
    expect(before).toBeDefined();

    system.update({ x: 258, z: 258 });

    const after = scene.getObjectByName("dressing:moss_patch") as THREE.InstancedMesh;
    expect(after).toBeDefined();
    expect(after).toBe(before);
    expect(after.geometry).toBe(before.geometry);
    expect(after.material).toBe(before.material);
    system.dispose();
  });

  it("returns an isolated diagnostics snapshot", () => {
    const system = new DressingSystem({
      scene: new THREE.Scene(),
      worldCells: 96,
      worldSeed: 19,
      config: DEFAULT_DRESSING_CONFIG,
      quality: "ultra",
    });
    const snapshot = system.getStats();
    snapshot.dressing_candidates_accepted = -1;
    snapshot.perClass.moss_patch.visible = -1;

    expect(system.getStats().dressing_candidates_accepted).toBeGreaterThanOrEqual(0);
    expect(system.getStats().perClass.moss_patch.visible).toBeGreaterThanOrEqual(0);
    system.dispose();
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
