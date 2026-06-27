import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { InfiniteFarShell, type InfiniteFarShellOptions } from "./infiniteFarShell.js";
import type { FarTerrainUniformData } from "../farTerrain/farTerrainUniforms.js";

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

describe("InfiniteFarShell height sampling mode", () => {
  it("keeps CPU provider heights as the default with parity material", () => {
    const shell = makeShell({ useParityMaterial: true, parityConfig });

    shell.setHeightProvider({
      sampleHeight: () => 123,
      sampleNormal: () => new THREE.Vector3(0, 1, 0),
    });

    const positions = shell.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    expect(positions.getY(0)).toBe(123);
    shell.dispose();
  });

  it("attaches initial vertex colors for parity material before provider rebuild", () => {
    const shell = makeShell({ useParityMaterial: true, parityConfig });
    const color = shell.mesh.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;

    expect(color).toBeDefined();
    expect(color!.count).toBe(shell.mesh.geometry.getAttribute("position").count);
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
