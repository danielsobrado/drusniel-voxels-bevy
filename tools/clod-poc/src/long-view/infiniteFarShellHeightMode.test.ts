import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { FAR_SHELL_PRIORITY_HEIGHT_OFFSET_M, InfiniteFarShell, type InfiniteFarShellOptions } from "./infiniteFarShell.js";
import type { FarTerrainUniformData } from "../farTerrain/farTerrainUniforms.js";
import type { FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";
import { BIOME_IDS } from "../world_source/biome_region_field.js";
import { biomeRgbForId } from "../world_source/biome_colors.js";

const parityConfig: FarTerrainUniformData = {
  materialQuality: "horizon_proxy",
  materialQualityIndex: 3,
  waterlineM: 0,
  sandMaxHeightM: 4,
  grassMaxSlope: 0.7,
  dirtMaxSlope: 0.85,
  rockMinSlope: 0.9,
  snowMinHeightM: 1000,
  snowMinSlope: 0.8,
  macroEnabled: 0,
  macroScale1: 1,
  macroScale2: 1,
  macroStrength: 0,
  macroSlopeStrength: 0,
  macroHeightStrength: 0,
  farNormalStrength: 0,
  farNormalFiniteDiffM: 1,
  farNormalFlattenStartM: 1000,
  farNormalFlattenEndM: 2000,
  hemiStrength: 1,
  sunStrength: 1,
  wrapLighting: 0,
  roughness: 1,
  ambientFloor: 0.2,
  hazeEnabled: 0,
  hazeStartM: 1000,
  hazeEndM: 2000,
  hazeColor: [0.5, 0.6, 0.7],
  hazeStrength: 0,
  hazeHeightFalloff: 0,
  shellInnerDropM: 0,
  normalBlendM: 1,
  materialBlendM: 1,
  pageToShellBlendM: 1,
  debugShowMaterialBands: 0,
  debugShowSlope: 0,
  debugShowMacroNoise: 0,
  debugShowFarNormals: 0,
  debugShowHazeFactor: 0,
  freezeMaterialLod: 0,
};

function makeShell(overrides: Partial<InfiniteFarShellOptions> = {}): InfiniteFarShell {
  return new InfiniteFarShell({
    innerMeters: 16,
    outerMeters: 32,
    radialSegments: 2,
    angularSegments: 4,
    heightBiasMeters: 0,
    nearBlendMeters: 1,
    farFadeMeters: 8,
    macroBlendStartMeters: 16,
    macroBlendEndMeters: 32,
    rebaseSnapMeters: 16,
    lighting: {
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color(1, 1, 1),
      skyLight: new THREE.Color(1, 1, 1),
      groundLight: new THREE.Color(0.2, 0.2, 0.2),
    },
    ...overrides,
  });
}

function makeGpuAtlas(): FarSummaryGpuAtlasView {
  const texture = new THREE.DataTexture(new Float32Array([1, 1, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  return {
    texture,
    materialTexture: texture,
    normalTexture: texture,
    coverageTexture: texture,
    rings: [{
      originX: -64,
      originZ: -64,
      cellM: 4,
      startM: 0,
      endM: 64,
      rowOffsetCells: 0,
      widthCells: 32,
      heightCells: 32,
      valid: 1,
    }],
    uploadStats: {
      fullUploads: 0,
      dirtyUploads: 0,
      dirtyRects: 0,
      dirtyPixels: 0,
      dirtyPct: 0,
      totalPixels: 1024,
      lastUploadMode: "none",
      fallbackReason: null,
    },
    originX: -64,
    originZ: -64,
    cellM: 4,
    widthCells: 32,
    heightCells: 32,
    valid: 1,
    revision: 1,
  };
}

describe("InfiniteFarShell height sampling mode", () => {
  it("keeps CPU provider heights as the default with parity material", () => {
    const shell = makeShell({ useParityMaterial: true, parityConfig });

    shell.setHeightProvider({
      sampleHeight: () => 123,
      sampleNormal: () => new THREE.Vector3(0, 1, 0),
    });

    const positions = shell.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(positions.getY(0)).toBe(123 + FAR_SHELL_PRIORITY_HEIGHT_OFFSET_M);
    shell.dispose();
  });

  it("fails loudly when GPU mode is requested without an atlas", () => {
    expect(() => makeShell({
      useParityMaterial: true,
      parityConfig,
      heightSamplingMode: "gpu",
    })).toThrow(/GPU mode requires parity material, parity config, and a GPU far-summary atlas/);
  });

  it("keeps geometry static and creates the water overlay in GPU mode", () => {
    const shell = makeShell({
      useParityMaterial: true,
      parityConfig,
      heightSamplingMode: "gpu",
      farSummaryGpuAtlas: makeGpuAtlas(),
    });
    const positions = shell.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const versionBefore = positions.version;

    shell.setHeightProvider({
      sampleHeight: () => 123,
      sampleNormal: () => new THREE.Vector3(0, 1, 0),
    });
    shell.update(20, 20, 1);

    expect(positions.version).toBe(versionBefore);
    expect(positions.getY(0)).toBe(0);
    expect(shell.mesh.children.some((child) => child.name === "naadf-far-water-overlay")).toBe(true);
    shell.dispose();
  });

  it("attaches initial vertex colors for parity material before provider rebuild", () => {
    const shell = makeShell({ useParityMaterial: true, parityConfig });
    const color = shell.mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;

    expect(color).toBeDefined();
    expect(color!.count).toBe(shell.mesh.geometry.getAttribute("position").count);
    shell.dispose();
  });

  it("colors the non-parity shell from sampled biome ids", () => {
    const shell = makeShell();

    shell.setHeightProvider({
      sampleHeight: () => 22,
      sampleNormal: () => new THREE.Vector3(0, 1, 0),
      sampleMaterial: () => BIOME_IDS.ocean,
    });

    const color = shell.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const [r, g, b] = biomeRgbForId(BIOME_IDS.ocean);
    expect(color.count).toBe(shell.mesh.geometry.getAttribute("position").count);
    expect(color.getX(0)).toBeCloseTo(r, 5);
    expect(color.getY(0)).toBeCloseTo(g, 5);
    expect(color.getZ(0)).toBeCloseTo(b, 5);
    shell.dispose();
  });

  it("clamps below-sea vertices to sea level and colors them as ocean", () => {
    const shell = makeShell({ useParityMaterial: true, parityConfig, seaLevelMeters: 10 });

    shell.setHeightProvider({
      sampleHeight: () => -40,
      sampleNormal: () => new THREE.Vector3(0.5, 0.5, 0.5),
    });

    const positions = shell.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const normals = shell.mesh.geometry.getAttribute("normal") as THREE.BufferAttribute;
    const color = shell.mesh.geometry.getAttribute("color") as THREE.BufferAttribute;
    const [r, g, b] = biomeRgbForId(BIOME_IDS.ocean);
    expect(positions.getY(0)).toBe(10 + FAR_SHELL_PRIORITY_HEIGHT_OFFSET_M);
    expect(normals.getY(0)).toBe(1);
    expect(color.getX(0)).toBeCloseTo(r, 5);
    expect(color.getY(0)).toBeCloseTo(g, 5);
    expect(color.getZ(0)).toBeCloseTo(b, 5);
    shell.dispose();
  });

  it("updates missing-summary debug fallback through a material uniform", () => {
    const shell = makeShell();
    const material = shell.mesh.material as import("three/webgpu").MeshBasicNodeMaterial;

    shell.setDebugShowMissingFallback(true);

    const refs = material.userData.farShellMaterialUniforms as { uDebugFallback: { value: number } };
    expect(refs.uDebugFallback.value).toBe(1);
    shell.dispose();
  });
});
