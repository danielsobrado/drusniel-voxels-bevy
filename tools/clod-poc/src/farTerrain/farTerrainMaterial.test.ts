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

function makeUniformData(overrides: Partial<FarTerrainUniformData> = {}): FarTerrainUniformData {
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
    hazeColor: [0.62, 0.70, 0.76] as [number, number, number],
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

function makeLighting() {
  return {
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(1, 1, 1),
    skyLight: new THREE.Color(1, 1, 1),
    groundLight: new THREE.Color(0.2, 0.2, 0.2),
  };
}

function makeSummaryAtlas(ringCount: number): FarSummaryGpuAtlasView {
  const widthCells = 4;
  const ringHeightCells = 4;
  const heightCells = ringHeightCells * ringCount;
  const texture = new THREE.DataTexture(new Float32Array(widthCells * heightCells * 4), widthCells, heightCells, THREE.RGBAFormat, THREE.FloatType);
  const materialTexture = new THREE.DataTexture(new Float32Array(widthCells * heightCells * 4), widthCells, heightCells, THREE.RGBAFormat, THREE.FloatType);
  return {
    texture,
    materialTexture,
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

function makePositions(count: number, scale = 100): Float32Array {
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    p[i * 3] = (i % 10) * scale;
    p[i * 3 + 1] = 50 + Math.sin(i) * 10;
    p[i * 3 + 2] = Math.floor(i / 10) * scale;
  }
  return p;
}

function makeNormals(count: number): Float32Array {
  const n = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    n[i * 3] = 0;
    n[i * 3 + 1] = 1;
    n[i * 3 + 2] = 0;
  }
  return n;
}

describe("createFarTerrainMaterial", () => {
  it("enables vertex colors for far shell parity shading", () => {
    const material = createFarTerrainMaterial(makeLighting(), makeUniformData(), 0, 0, 1024);

    expect(material.vertexColors).toBe(true);
    material.dispose();
  });

  it("creates GPU summary uniforms for every configured atlas ring", () => {
    const atlas = makeSummaryAtlas(9);
    const material = createFarTerrainMaterial(makeLighting(), makeUniformData(), 0, 0, 1024, {
      gpuDisplacement: true,
      summaryAtlas: atlas,
    });
    const refs = material.userData.farTerrainUniforms as FarTerrainUniformRefs;

    expect(refs.uSummaryRings).toHaveLength(9);
    expect(refs.uSummaryRings?.[8]?.uOriginX.value).toBe(800);
    material.dispose();
    atlas.texture.dispose();
    atlas.materialTexture.dispose();
  });

  it("updates all GPU summary ring uniforms from the latest atlas view", () => {
    const first = makeSummaryAtlas(2);
    const material = createFarTerrainMaterial(makeLighting(), makeUniformData(), 0, 0, 1024, {
      gpuDisplacement: true,
      summaryAtlas: first,
    });
    const next = makeSummaryAtlas(2);
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
    first.texture.dispose();
    first.materialTexture.dispose();
    next.texture.dispose();
    next.materialTexture.dispose();
  });
});

describe("computeFarTerrainVertexColors", () => {
  it("returns valid output for a simple grid", () => {
    const pos = makePositions(25);
    const norm = makeNormals(25);
    const result = computeFarTerrainVertexColors(pos, norm, 25, makeUniformData());

    expect(result.baseColor.length).toBe(25 * 3);
    expect(result.debugBand.length).toBe(25 * 3);
    expect(result.macro.length).toBe(25);
    expect(result.slope.length).toBe(25);
    expect(result.materialWeights.length).toBe(25 * 5);
  });

  it("all baseColor values are in [0, 1]", () => {
    const pos = makePositions(16);
    const norm = makeNormals(16);
    const result = computeFarTerrainVertexColors(pos, norm, 16, makeUniformData());

    for (let i = 0; i < result.baseColor.length; i++) {
      expect(result.baseColor[i]).toBeGreaterThanOrEqual(0);
      expect(result.baseColor[i]).toBeLessThanOrEqual(1);
    }
  });

  it("weights sum to ~1 per vertex", () => {
    const pos = makePositions(16);
    const norm = makeNormals(16);
    const result = computeFarTerrainVertexColors(pos, norm, 16, makeUniformData());

    for (let vi = 0; vi < 16; vi++) {
      const sum = result.materialWeights[vi * 5] + result.materialWeights[vi * 5 + 1]
        + result.materialWeights[vi * 5 + 2] + result.materialWeights[vi * 5 + 3]
        + result.materialWeights[vi * 5 + 4];
      expect(Math.abs(sum - 1)).toBeLessThan(0.01);
    }
  });

  it("no NaN values in any output array", () => {
    const pos = makePositions(16);
    const norm = makeNormals(16);
    const result = computeFarTerrainVertexColors(pos, norm, 16, makeUniformData());

    const allArrays = [
      result.baseColor, result.debugBand, result.macro,
      result.slope, result.materialWeights,
    ];
    for (const arr of allArrays) {
      for (let i = 0; i < arr.length; i++) {
        expect(Number.isFinite(arr[i])).toBe(true);
      }
    }
  });
});

describe("createVertexColorBuffer", () => {
  // TODO: assert horizon_proxy, single_projection_far, atlas_only_debug, and debug
  // modes produce meaningfully different buffers (not just length/range/no-crash).
  it("default mode (horizon_proxy) produces non-debug colors", () => {
    const pos = makePositions(9);
    const norm = makeNormals(9);
    const vc = computeFarTerrainVertexColors(pos, norm, 9, makeUniformData());
    const buf = createVertexColorBuffer(vc, makeUniformData());

    expect(buf.length).toBe(9 * 3);
    for (let i = 0; i < buf.length; i++) {
      expect(buf[i]).toBeGreaterThan(0);
    }
  });

  it("atlas_only_debug produces debug band colors", () => {
    const pos = makePositions(9);
    const norm = makeNormals(9);
    const cfg = makeUniformData({ materialQuality: "atlas_only_debug", materialQualityIndex: 4 });
    const vc = computeFarTerrainVertexColors(pos, norm, 9, cfg);
    const buf = createVertexColorBuffer(vc, cfg);

    expect(buf.length).toBe(9 * 3);
  });

  it("debugShowSlope shows red-tinted slope", () => {
    const pos = makePositions(9);
    const norm = makeNormals(9);
    const cfg = makeUniformData({ debugShowSlope: 1 });
    const vc = computeFarTerrainVertexColors(pos, norm, 9, cfg);
    const buf = createVertexColorBuffer(vc, cfg);

    expect(buf.length).toBe(9 * 3);
  });

  it("debugShowFarNormals uses the provided normal buffer", () => {
    const pos = makePositions(1);
    const norm = new Float32Array([1, 0, 0]);
    const cfg = makeUniformData({ debugShowFarNormals: 1 });
    const vc = computeFarTerrainVertexColors(pos, norm, 1, cfg);
    const fallback = createVertexColorBuffer(vc, cfg);
    const actual = createVertexColorBuffer(vc, cfg, norm);

    expect(fallback[0]).toBeCloseTo(0.5, 5);
    expect(fallback[1]).toBeCloseTo(0.5, 5);
    expect(fallback[2]).toBeCloseTo(0.75, 5);
    expect(actual[0]).toBeCloseTo(1.0, 5);
    expect(actual[1]).toBeCloseTo(0.5, 5);
    expect(actual[2]).toBeCloseTo(0.5, 5);
  });

  it("debugShowFarNormals shows normal-map colors", () => {
    const pos = makePositions(9);
    const norm = makeNormals(9);
    const cfg = makeUniformData({ debugShowFarNormals: 1 });
    const vc = computeFarTerrainVertexColors(pos, norm, 9, cfg);
    const buf = createVertexColorBuffer(vc, cfg, norm);

    expect(buf.length).toBe(9 * 3);
    for (let i = 0; i < 9; i++) {
      const g = buf[i * 3 + 1];
      expect(g).toBeCloseTo(1.0, 0);
    }
  });

  it("debugShowHazeFactor does not crash without positions", () => {
    const pos = makePositions(9);
    const norm = makeNormals(9);
    const cfg = makeUniformData({ debugShowHazeFactor: 1 });
    const vc = computeFarTerrainVertexColors(pos, norm, 9, cfg);
    const buf = createVertexColorBuffer(vc, cfg);

    expect(buf.length).toBe(9 * 3);
  });

  it("debugShowHazeFactor spans dark-to-bright blue heatmap by distance", () => {
    const pos = new Float32Array([
      0, 50, 0,
      0, 50, 2500,
      0, 50, 5000,
    ]);
    const norm = makeNormals(3);
    const cfg = makeUniformData({
      debugShowHazeFactor: 1,
      hazeStartM: 1000,
      hazeEndM: 5000,
      hazeStrength: 1,
      hazeEnabled: 1,
    });
    const vc = computeFarTerrainVertexColors(pos, norm, 3, cfg);
    const buf = createVertexColorBuffer(vc, cfg, undefined, 0, 0, pos);

    const nearB = buf[2];
    const midB = buf[5];
    const farB = buf[8];
    expect(nearB).toBeLessThan(0.2);
    expect(farB).toBeGreaterThan(0.8);
    expect(farB - nearB).toBeGreaterThan(0.6);
    expect(midB).toBeGreaterThan(nearB);
    expect(midB).toBeLessThan(farB);
    expect(buf[4]).toBeGreaterThan(buf[3]);
  });

  it("all output values are in [0, 1] for all modes", () => {
    const pos = makePositions(16);
    const norm = makeNormals(16);

    const modes = [
      { materialQuality: "atlas_only_debug", materialQualityIndex: 4 },
      { materialQuality: "slope_tint_debug", materialQualityIndex: 1 },
      { debugShowSlope: 1 },
      { debugShowMacroNoise: 1 },
      { debugShowFarNormals: 1 },
      { debugShowHazeFactor: 1 },
      { materialQuality: "single_projection_far", materialQualityIndex: 2 },
    ];

    for (const mode of modes) {
      const cfg = makeUniformData(mode as Partial<FarTerrainUniformData>);
      const vc = computeFarTerrainVertexColors(pos, norm, 16, cfg);
      const buf = createVertexColorBuffer(vc, cfg, norm, 0, 0, pos);

      for (let i = 0; i < buf.length; i++) {
        expect(buf[i]).toBeGreaterThanOrEqual(0);
        expect(buf[i]).toBeLessThanOrEqual(1);
      }
    }
  });
});
