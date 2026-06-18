import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { ClodPageNode } from "../types.js";
import { DEFAULT_STONE_SETTINGS, type StoneClass, type StoneSettings } from "./stone_config.js";
import { StoneSystem } from "./stone_instances.js";
import type { StoneInstance } from "./stone_scatter.js";

function node(id: string, minX: number, minZ: number, maxX: number, maxZ: number): ClodPageNode {
  return {
    id,
    level: 0,
    children: [],
    footprint: { minX, minZ, maxX, maxZ },
    mesh: {
      positions: new Float32Array(),
      normals: new Float32Array(),
      materials: new Float32Array(),
      indices: new Uint32Array(),
    },
    bounds: { center: [(minX + maxX) * 0.5, 0, (minZ + maxZ) * 0.5], radius: Math.hypot(maxX - minX, maxZ - minZ) },
    errorWorld: 0,
    lowBenefit: false,
  };
}

function lighting() {
  return {
    light: new THREE.Vector3(0.4, 1, 0.2).normalize(),
    sunColor: new THREE.Color(1, 1, 1),
    skyLight: new THREE.Color(0.55, 0.6, 0.7),
    groundLight: new THREE.Color(0.25, 0.22, 0.18),
  };
}

function mixedClassSettings(overrides: Partial<StoneSettings> = {}): StoneSettings {
  const shared = { presets: ["cobble" as const], variants: 1 };
  return {
    ...DEFAULT_STONE_SETTINGS,
    enabled: true,
    density: 2,
    maxInstances: 2000,
    classes: {
      large: { ...DEFAULT_STONE_SETTINGS.classes.large, ...shared },
      medium: { ...DEFAULT_STONE_SETTINGS.classes.medium, ...shared },
      small: { ...DEFAULT_STONE_SETTINGS.classes.small, ...shared },
    },
    ...overrides,
  };
}

function stoneSystem(settings: StoneSettings): StoneSystem {
  return new StoneSystem({
    scene: new THREE.Scene(),
    nodes: [node("L0:0,0", 0, 0, 256, 256), node("L0:1,0", 256, 0, 512, 256)],
    worldCells: 512,
    settings,
    lighting: lighting(),
  });
}

function groups(system: StoneSystem): Array<{ classId: StoneClass; instances: StoneInstance[] }> {
  return (system as unknown as { groups: Array<{ classId: StoneClass; instances: StoneInstance[] }> }).groups;
}

function signature(system: StoneSystem): string {
  return groups(system)
    .flatMap((group) => group.instances.slice(0, 8))
    .map((stone) => `${stone.classId}:${stone.x.toFixed(2)},${stone.z.toFixed(2)}`)
    .join("|");
}

describe("StoneSystem", () => {
  it("keeps instanced batches class-homogeneous even when presets and variants overlap", () => {
    const system = stoneSystem(mixedClassSettings());
    try {
      const builtGroups = groups(system);
      expect(builtGroups.length).toBeGreaterThan(1);
      for (const group of builtGroups) {
        expect(group.instances.every((stone) => stone.classId === group.classId)).toBe(true);
      }
    } finally {
      system.dispose();
    }
  });

  it("rebuilds from current settings after disabling and changing the seed", () => {
    const system = stoneSystem(mixedClassSettings({ seed: 11 }));
    try {
      const first = signature(system);
      system.setEnabled(false);
      expect(groups(system)).toHaveLength(0);
      system.updateSettings({ seed: 12 });
      system.setEnabled(true);
      expect(signature(system)).not.toBe(first);
    } finally {
      system.dispose();
    }
  });
});
