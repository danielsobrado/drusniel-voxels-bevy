import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  cloneForestLightingSettings,
  clearForestLightingField,
  createForestLightingField,
  finalizeForestLightingField,
  splatCanopyInfluence,
  type ForestLightingField,
  type ForestLightingTreeProxy,
} from "./index.js";

describe("forest lighting fields", () => {
  it("creates finite arrays and clears to neutral values", () => {
    const settings = testSettings();
    const field = createForestLightingField(128, settings);
    expect(field.resolution).toBe(32);
    expect(field.canopyDensity).toHaveLength(32 * 32);
    field.canopyDensity[0] = 1;
    field.ambientOcclusion[0] = 1;
    clearForestLightingField(field);
    for (const array of arrays(field)) {
      expect([...array].every((value) => Number.isFinite(value) && value === 0)).toBe(true);
    }
  });

  it("splatting one tree raises nearby canopy and keeps far cells lower", () => {
    const settings = testSettings();
    const field = createForestLightingField(128, settings);
    splatCanopyInfluence(field, tree({ crownRadius: 8 }), settings);
    const center = valueAt(field.canopyDensity, field, 16, 16);
    const far = valueAt(field.canopyDensity, field, 1, 1);
    expect(center).toBeGreaterThan(0);
    expect(far).toBeLessThan(center);
  });

  it("larger crown radius affects more cells and is deterministic", () => {
    const settings = testSettings();
    const small = createForestLightingField(128, settings);
    const large = createForestLightingField(128, settings);
    const again = createForestLightingField(128, settings);
    splatCanopyInfluence(small, tree({ crownRadius: 2 }), settings);
    splatCanopyInfluence(large, tree({ crownRadius: 12 }), settings);
    splatCanopyInfluence(again, tree({ crownRadius: 12 }), settings);
    expect(nonZero(large.canopyDensity)).toBeGreaterThan(nonZero(small.canopyDensity));
    expect([...large.canopyDensity]).toEqual([...again.canopyDensity]);
  });

  it("finalization derives clamped AO, shadow, fog, edges, and shafts", () => {
    const settings = testSettings();
    settings.atmosphere.sunShaftsThreshold = 0;
    settings.atmosphere.sunShaftsStrength = 1;
    const field = createForestLightingField(128, settings);
    splatCanopyInfluence(field, tree({ crownRadius: 12 }), settings);
    finalizeForestLightingField(field, new THREE.Vector3(1, 0.7, 0).normalize(), settings);
    expect(max(field.ambientOcclusion)).toBeGreaterThan(0);
    expect(max(field.shadowProxy)).toBeGreaterThan(0);
    expect(max(field.fogDensity)).toBeGreaterThan(0);
    expect(max(field.forestEdge)).toBeGreaterThan(0);
    for (const array of arrays(field)) {
      expect([...array].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
    }
  });

  it("shadow proxy changes with sun direction", () => {
    const settings = testSettings();
    const east = createForestLightingField(128, settings);
    const north = createForestLightingField(128, settings);
    splatCanopyInfluence(east, tree({ crownRadius: 12 }), settings);
    splatCanopyInfluence(north, tree({ crownRadius: 12 }), settings);
    finalizeForestLightingField(east, new THREE.Vector3(1, 0.7, 0).normalize(), settings);
    finalizeForestLightingField(north, new THREE.Vector3(0, 0.7, 1).normalize(), settings);
    expect(totalAbsDelta(east.shadowProxy, north.shadowProxy)).toBeGreaterThan(0.01);
  });
});

function testSettings() {
  const settings = cloneForestLightingSettings();
  settings.field.resolution = 32;
  settings.field.blurRadiusCells = 1;
  settings.field.canopyInfluenceRadiusM = 4;
  settings.field.densityFalloffPower = 1.5;
  return settings;
}

function tree(overrides: Partial<ForestLightingTreeProxy> = {}): ForestLightingTreeProxy {
  return {
    x: 64,
    z: 64,
    height: 18,
    scale: 1,
    crownRadius: 8,
    species: "oak",
    ...overrides,
  };
}

function arrays(field: ForestLightingField): Float32Array[] {
  return [
    field.canopyDensity,
    field.understoryDensity,
    field.ambientOcclusion,
    field.shadowProxy,
    field.fogDensity,
    field.sunShaftMask,
    field.forestEdge,
  ];
}

function valueAt(array: Float32Array, field: ForestLightingField, x: number, z: number): number {
  return array[z * field.resolution + x] ?? 0;
}

function max(array: Float32Array): number {
  return array.reduce((best, value) => Math.max(best, value), 0);
}

function nonZero(array: Float32Array): number {
  return array.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
}

function totalAbsDelta(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return total;
}
