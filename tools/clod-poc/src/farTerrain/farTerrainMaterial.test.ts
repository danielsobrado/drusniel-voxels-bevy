import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  computeFarTerrainVertexColors,
  createFarTerrainMaterial,
  createVertexColorBuffer,
  updateFarTerrainMaterialSummaryAtlas,
  type FarTerrainUniformRefs,
} from "./farTerrainMaterial.js";
import type { FarTerrainUniformData } from "./farTerrainUniforms.js";
import type { FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";

function uniformData(overrides: Partial<FarTerrainUniformData> = {}): FarTerrainUniformData {
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
    wrapLighting: 0.2,
    roughness: 0.92,
    ambientFloor: 0.16,
    hazeEnabled: 1,
    hazeStartM: 1800,
    hazeEndM: 4096,
    hazeColor: [0.62, 0.7, 0.76],
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
    ...overrides,
  };
}

function lighting() {
  return {
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(1, 1, 1),
    skyLight: new THREE.Color(1, 1, 1),
    groundLight: new THREE.Color(0.2, 0.2, 0.2),
  };
}

function dataTexture(widthCells: number, heightCells: number): THREE.DataTexture {
  return new THREE.DataTexture(new Float32Array(widthCells * heightCells * 4), widthCells, heightCells, THREE.RGBAFormat, THREE.FloatType);
}

function atlasView(ringCount: number): FarSummaryGpuAtlasView {
  const widthCells = 4;
  const ringHeightCells = 4;
  const heightCells = ringHeightCells * ringCount;
  return {
    texture: dataTexture(widthCells, heightCells),
    materialTexture: dataTexture(widthCells, heightCells),
    normalTexture: dataTexture(widthCells, heightCells),
    coverageTexture: dataTexture(widthCells, heightCells),
    rings: Array.from({ length: ringCount }, (_, i) => ({
      originX: i * 100,
      originZ: i * 200,
      cellM: 32 + i,
      startM: i * 1000,
      endM: (i + 1) * 1000,
      rowOffsetCells: i * ringHeightCells,
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
    revision: 0,
  };
}

function disposeAtlas(atlas: FarSummaryGpuAtlasView): void {
  atlas.texture.dispose();
  atlas.materialTexture.dispose();
  atlas.normalTexture.dispose();
  atlas.coverageTexture.dispose();
}

function positions(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = (i % 10) * 100;
    out[i * 3 + 1] = 50;
    out[i * 3 + 2] = Math.floor(i / 10) * 100;
  }
  return out;
}

function normals(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = 0;
    out[i * 3 + 1] = 1;
    out[i * 3 + 2] = 0;
  }
  return out;
}

describe("createFarTerrainMaterial", () => {
  it("enables vertex colors for far shell parity shading", () => {
    const material = createFarTerrainMaterial(lighting(), uniformData(), 0, 0, 1024);
    expect(material.vertexColors).toBe(true);
    material.dispose();
  });

  it("creates GPU summary uniforms for every configured atlas ring", () => {
    const atlas = atlasView(9);
    const material = createFarTerrainMaterial(lighting(), uniformData(), 0, 0, 1024, {
      gpuDisplacement: true,
      summaryAtlas: atlas,
    });
    const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs;
    expect(refs.uSummaryRings).toHaveLength(9);
    expect(refs.uSummaryRings?.[8]?.uOriginX.value).toBe(800);
    material.dispose();
    disposeAtlas(atlas);
  });

  it("updates GPU summary ring uniforms from the latest atlas view", () => {
    const first = atlasView(2);
    const material = createFarTerrainMaterial(lighting(), uniformData(), 0, 0, 1024, {
      gpuDisplacement: true,
      summaryAtlas: first,
    });
    const next = atlasView(2);
    next.valid = 0;
    next.rings[1]!.originX = 777;
    next.rings[1]!.rowOffsetCells = 123;
    next.rings[1]!.valid = 0;
    updateFarTerrainMaterialSummaryAtlas(material, next);
    const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs;
    expect(refs.uSummaryValid?.value).toBe(0);
    expect(refs.uSummaryRings?.[1]?.uOriginX.value).toBe(777);
    expect(refs.uSummaryRings?.[1]?.uRowOffsetCells.value).toBe(123);
    expect(refs.uSummaryRings?.[1]?.uValid.value).toBe(0);
    material.dispose();
    disposeAtlas(first);
    disposeAtlas(next);
  });
});

describe("computeFarTerrainVertexColors", () => {
  it("returns finite color and material-weight buffers", () => {
    const result = computeFarTerrainVertexColors(positions(16), normals(16), 16, uniformData());
    expect(result.baseColor).toHaveLength(48);
    expect(result.materialWeights).toHaveLength(80);
    for (const arr of [result.baseColor, result.debugBand, result.macro, result.slope, result.materialWeights]) {
      for (const value of arr) expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("weights sum to approximately one per vertex", () => {
    const result = computeFarTerrainVertexColors(positions(8), normals(8), 8, uniformData());
    for (let vi = 0; vi < 8; vi++) {
      const sum = result.materialWeights[vi * 5] + result.materialWeights[vi * 5 + 1]
        + result.materialWeights[vi * 5 + 2] + result.materialWeights[vi * 5 + 3]
        + result.materialWeights[vi * 5 + 4];
      expect(Math.abs(sum - 1)).toBeLessThan(0.01);
    }
  });
});

describe("createVertexColorBuffer", () => {
  it("uses provided normals for far-normal debug color", () => {
    const pos = positions(1);
    const norm = new Float32Array([1, 0, 0]);
    const cfg = uniformData({ debugShowFarNormals: 1 });
    const vc = computeFarTerrainVertexColors(pos, norm, 1, cfg);
    const fallback = createVertexColorBuffer(vc, cfg);
    const actual = createVertexColorBuffer(vc, cfg, norm);
    expect(fallback[2]).toBeCloseTo(0.75, 5);
    expect(actual[0]).toBeCloseTo(1.0, 5);
    expect(actual[1]).toBeCloseTo(0.5, 5);
    expect(actual[2]).toBeCloseTo(0.5, 5);
  });

  it("keeps output values in [0, 1] for debug modes", () => {
    const pos = positions(16);
    const norm = normals(16);
    const modes: Partial<FarTerrainUniformData>[] = [
      { materialQuality: "atlas_only_debug", materialQualityIndex: 4 },
      { materialQuality: "slope_tint_debug", materialQualityIndex: 1 },
      { debugShowSlope: 1 },
      { debugShowMacroNoise: 1 },
      { debugShowFarNormals: 1 },
      { debugShowHazeFactor: 1 },
      { materialQuality: "single_projection_far", materialQualityIndex: 2 },
    ];
    for (const mode of modes) {
      const cfg = uniformData(mode);
      const vc = computeFarTerrainVertexColors(pos, norm, 16, cfg);
      const buf = createVertexColorBuffer(vc, cfg, norm, 0, 0, pos);
      for (const value of buf) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});
