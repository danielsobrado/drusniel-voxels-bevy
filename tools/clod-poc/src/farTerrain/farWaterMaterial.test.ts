import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createFarWaterMaterial,
  updateFarWaterMaterialCenter,
  updateFarWaterMaterialSummaryAtlas,
  type FarWaterUniformRefs,
} from "./farWaterMaterial.js";
import type { FarSummaryGpuAtlasView } from "../naadf/gpu/farSummaryAtlas.js";

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
    normalTexture: texture(widthCells, heightCells),
    coverageTexture: texture(widthCells, heightCells),
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

describe("far water material", () => {
  it("creates a transparent alpha-tested render-only material", () => {
    const atlas = atlasView(1);
    const material = createFarWaterMaterial(0, 0, atlas);

    expect(material.name).toBe("naadf-far-water-overlay");
    expect(material.transparent).toBe(true);
    expect(material.alphaTest).toBeGreaterThan(0);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.colorNode).toBeDefined();
    expect(material.opacityNode).toBeDefined();
    expect(material.positionNode).toBeDefined();

    material.dispose();
    disposeAtlas(atlas);
  });

  it("creates summary uniforms for every configured atlas ring", () => {
    const atlas = atlasView(5);
    const material = createFarWaterMaterial(10, 20, atlas);
    const refs = material.userData.farWaterUniforms as FarWaterUniformRefs;

    expect(refs.uSummaryRings).toHaveLength(5);
    expect(refs.uCenterX.value).toBe(10);
    expect(refs.uCenterZ.value).toBe(20);
    expect(refs.uSummaryRings?.[4]?.uOriginX.value).toBe(400);
    material.dispose();
    disposeAtlas(atlas);
  });

  it("updates center and atlas ring uniforms", () => {
    const first = atlasView(2);
    const material = createFarWaterMaterial(0, 0, first);
    const next = atlasView(2);
    next.valid = 0;
    next.rings[1]!.originX = 777;
    next.rings[1]!.rowOffsetCells = 123;
    next.rings[1]!.valid = 0;

    updateFarWaterMaterialCenter(material, 12, 34);
    updateFarWaterMaterialSummaryAtlas(material, next);

    const refs = material.userData.farWaterUniforms as FarWaterUniformRefs;
    expect(refs.uCenterX.value).toBe(12);
    expect(refs.uCenterZ.value).toBe(34);
    expect(refs.uSummaryValid?.value).toBe(0);
    expect(refs.uSummaryRings?.[1]?.uOriginX.value).toBe(777);
    expect(refs.uSummaryRings?.[1]?.uRowOffsetCells.value).toBe(123);
    expect(refs.uSummaryRings?.[1]?.uValid.value).toBe(0);
    material.dispose();
    disposeAtlas(first);
    disposeAtlas(next);
  });
});
