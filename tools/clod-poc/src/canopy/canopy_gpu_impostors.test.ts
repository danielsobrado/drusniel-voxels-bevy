import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { DEFAULT_CANOPY_SHELL_CONFIG } from "./canopy_defaults.js";
import type { CanopyTextureSet } from "./canopy_types.js";
import {
  buildCanopyGpuImpostorsFromTextureSet,
  canopyTextureFiniteCenter,
  maxCanopyGpuImpostorInstances,
  selectCanopyGpuImpostorSamples,
} from "./canopy_gpu_impostors.js";

function redTexture(data: number[], res: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Float32Array(data), res, res, THREE.RedFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

function rgbaTexture(data: number[], res: number): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Float32Array(data), res, res, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

function textureSet(overrides: Partial<CanopyTextureSet> = {}): CanopyTextureSet {
  const res = 4;
  return {
    heightTexture: redTexture([
      10, 11, 12, 13,
      20, 21, 22, 23,
      30, 31, 32, 33,
      40, 41, 42, 43,
    ], res),
    coverageTexture: redTexture([
      0, 0.2, 0, 0.3,
      0.4, 0, 0.5, 0,
      0, 0.6, 0, 0.7,
      0.8, 0, 0.9, 0,
    ], res),
    speciesTexture: rgbaTexture(new Array(res * res).fill(0).flatMap((_, i) => [0.1 + i * 0.01, 0.2, 0.05, 1]), res),
    roughnessTexture: redTexture(new Array(res * res).fill(0.5), res),
    originX: 100,
    originZ: -300,
    extentM: 400,
    resolution: res,
    syntheticFallback: false,
    revision: 7,
    ...overrides,
  };
}

function lighting() {
  return {
    sunDirection: new THREE.Vector3(0.3, 0.8, 0.4).normalize(),
    sunColor: new THREE.Color(1, 0.95, 0.85),
    skyLight: new THREE.Color(0.45, 0.55, 0.65),
    groundLight: new THREE.Color(0.2, 0.18, 0.12),
  };
}

describe("canopy GPU impostors", () => {
  it("selects deterministic high-coverage impostor samples", () => {
    const samples = selectCanopyGpuImpostorSamples(textureSet(), 3, 0.3, 1);

    expect(samples).toHaveLength(3);
    expect(samples[0]!.coverage).toBeGreaterThanOrEqual(0.3);
    expect(samples[0]!.x).toBeGreaterThanOrEqual(100);
    expect(samples[0]!.z).toBeGreaterThanOrEqual(-300);
  });

  it("builds a finite centered instanced GPU impostor shell", () => {
    const shell = buildCanopyGpuImpostorsFromTextureSet(textureSet(), DEFAULT_CANOPY_SHELL_CONFIG, lighting(), {
      maxInstances: 5,
      coverageThreshold: 0.2,
      sampleStride: 1,
    });

    expect(shell.instanceCount).toBeLessThanOrEqual(5);
    expect(shell.triangleCount).toBe(shell.instanceCount * 2);
    expect(shell.maxInstances).toBe(5);
    expect(shell.centerX).toBe(300);
    expect(shell.centerZ).toBe(-100);
    expect(shell.mesh.position.x).toBe(300);
    expect(shell.mesh.position.z).toBe(-100);
    expect(shell.mesh.userData.canopyTextureSetRevision).toBe(7);
    expect(shell.mesh.userData.canopyGpuImpostorInstances).toBe(shell.instanceCount);
    shell.dispose();
  });

  it("sanitizes non-finite texture centers", () => {
    expect(canopyTextureFiniteCenter(textureSet({ originX: Number.NaN })).x).toBe(0);
    expect(canopyTextureFiniteCenter(textureSet({ originZ: Number.POSITIVE_INFINITY })).z).toBe(0);
  });

  it("derives a safe instance budget from the existing shell triangle budget", () => {
    expect(maxCanopyGpuImpostorInstances(1000)).toBe(500);
    expect(maxCanopyGpuImpostorInstances(-1)).toBeGreaterThan(0);
  });
});
