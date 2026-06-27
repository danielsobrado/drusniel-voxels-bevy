import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createFarTerrainMaterial, type FarTerrainUniformRefs } from "./farTerrainMaterial.js";
import type { FarTerrainUniformData } from "./farTerrainUniforms.js";
import type { FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";

function uniformData(): FarTerrainUniformData {
  return {
    materialQuality: "horizon_proxy",
    materialQualityIndex: 3,
    waterlineM: 0,
    sandMaxHeightM: 4,
    grassMaxSlope: 0.62,
    dirtMaxSlope: 0.82,
    rockMinSlope: 0.72,
    snowMinHeightM: 96,
    snowMinSlope: 0.15,
    macroEnabled: 1,
    macroScale1: 180,
    macroScale2: 720,
    macroStrength: 0.18,
    macroSlopeStrength: 0.12,
    macroHeightStrength: 0.10,
    farNormalStrength: 0.65,
    farNormalFiniteDiffM: 8,
    farNormalFlattenStartM: 2200,
    farNormalFlattenEndM: 4096,
    hemiStrength: 0.45,
    sunStrength: 0.85,
    wrapLighting: 0.20,
    roughness: 0.92,
    ambientFloor: 0.16,
    hazeEnabled: 1,
    hazeStartM: 1800,
    hazeEndM: 4096,
    hazeColor: [0.62, 0.70, 0.76],
    hazeStrength: 0.72,
    hazeHeightFalloff: 0.035,
    shellInnerDropM: 2,
    normalBlendM: 128,
    materialBlendM: 192,
    pageToShellBlendM: 160,
    debugShowMaterialBands: 0,
    debugShowSlope: 0,
    debugShowMacroNoise: 0,
    debugShowFarNormals: 0,
    debugShowHazeFactor: 0,
    freezeMaterialLod: 0,
  };
}

function texture(widthCells: number, heightCells: number): THREE.DataTexture {
  return new THREE.DataTexture(
    new Float32Array(widthCells * heightCells * 4),
    widthCells,
    heightCells,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
}

function atlasView(ringCount: number): FarSummaryGpuAtlasView {
  const widthCells = 4;
  const ringHeightCells = 4;
  const heightCells = ringHeightCells * ringCount;

  return {
    texture: texture(widthCells, heightCells),
    materialTexture: texture(widthCells, heightCells),
    rings: Array.from({ length: ringCount }, (_, index) => ({
      originX: 0,
      originZ: 0,
      cellM: 32 * (index + 1),
      startM: index * 4096,
      endM: (index + 1) * 4096,
      rowOffsetCells: index * ringHeightCells,
      widthCells,
      heightCells: ringHeightCells,
      valid: 1,
    })),
    originX: 0,
    originZ: 0,
    cellM: 32,
    widthCells,
    heightCells,
    valid: 1,
    revision: 1,
  };
}

describe("far terrain GPU atlas material", () => {
  it("keeps more than the current three configured summary rings", () => {
    const atlas = atlasView(4);
    const material = createFarTerrainMaterial({
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: new THREE.Color(1, 1, 1),
      skyLight: new THREE.Color(1, 1, 1),
      groundLight: new THREE.Color(0.2, 0.2, 0.2),
    }, uniformData(), 0, 0, 16384, {
      gpuDisplacement: true,
      summaryAtlas: atlas,
    });

    const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs;
    expect(refs.uSummaryRings?.length).toBe(4);
    material.dispose();
    atlas.texture.dispose();
    atlas.materialTexture.dispose();
  });
});
