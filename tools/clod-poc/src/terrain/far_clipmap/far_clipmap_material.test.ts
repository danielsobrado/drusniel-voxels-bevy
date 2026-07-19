import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import farClipmapMaterialSource from "./far_clipmap_material.ts?raw";
import {
  createFarClipmapMaterial,
  setFarClipmapMaterialDebugMode,
  smoothFarClipmapLandHeights,
  updateFarClipmapMaterialFrameUniforms,
  updateFarClipmapMaterialSourceTexture,
  type FarClipmapMaterial,
} from "./far_clipmap_material.js";
import { recordTerrainLayerAverageAlbedos } from "../../textures/terrain_layer_average_albedo.js";

type TraversableNode = { traverse(callback: (node: unknown) => void): void };

function createWebGpuMaterial(): FarClipmapMaterial {
  return createFarClipmapMaterial({
    debugMode: "final",
    clipInnerRadiusM: 100,
    clipOuterRadiusM: 1000,
    webGpuCompatible: true,
    gridResolution: 4,
  });
}

function colorNodeReaches(material: FarClipmapMaterial, target: unknown): boolean {
  const colorNode = (material as { colorNode?: TraversableNode }).colorNode;
  if (!colorNode) return false;
  let found = false;
  colorNode.traverse((node) => {
    if (node === target) found = true;
    if ((node as { value?: unknown }).value === target) found = true;
  });
  return found;
}

function colorNodeHasType(material: FarClipmapMaterial, typeName: string): boolean {
  const colorNode = (material as { colorNode?: TraversableNode }).colorNode;
  if (!colorNode) return false;
  let found = false;
  colorNode.traverse((node) => {
    if ((node as { constructor?: { name?: string } }).constructor?.name === typeName) found = true;
  });
  return found;
}

describe("far clipmap WebGPU material debug modes", () => {
  it("colorNode consumes the uDebugMode uniform so debug modes render differently", () => {
    const material = createWebGpuMaterial();
    const nodeUniforms = material.userData.farClipmapNodeUniforms as { uDebugMode: unknown };
    expect(nodeUniforms?.uDebugMode).toBeDefined();
    expect(colorNodeReaches(material, nodeUniforms.uDebugMode)).toBe(true);
  });

  it("colorNode consumes the ownership mask so ownership mode can prove sector hand-off", () => {
    const material = createWebGpuMaterial();
    const ownershipStorage = material.userData.farClipmapOwnershipStorage as THREE.BufferAttribute;
    expect(ownershipStorage).toBeDefined();
    expect(colorNodeReaches(material, ownershipStorage)).toBe(true);
  });

  it("interpolates per-vertex storage samples instead of indexing storage per fragment", () => {
    const material = createWebGpuMaterial();
    expect(colorNodeHasType(material, "VaryingNode")).toBe(true);
  });

  it("setFarClipmapMaterialDebugMode updates the node uniform value", () => {
    const material = createWebGpuMaterial();
    const nodeUniforms = material.userData.farClipmapNodeUniforms as { uDebugMode: { value: number } };
    expect(nodeUniforms.uDebugMode.value).toBe(0);
    setFarClipmapMaterialDebugMode(material, "ownership");
    expect(nodeUniforms.uDebugMode.value).toBe(3);
    setFarClipmapMaterialDebugMode(material, "final");
    expect(nodeUniforms.uDebugMode.value).toBe(0);
  });
});

describe("far clipmap height smoothing", () => {
  it("rounds an isolated dry-land peak without bleeding across water", () => {
    const source = new Float32Array(3 * 3 * 4);
    const water = new Float32Array(3 * 3 * 4);
    source[(1 * 3 + 1) * 4] = 10;

    smoothFarClipmapLandHeights(source, water, 3);
    expect(source[(1 * 3 + 1) * 4]).toBeCloseTo(5);

    source[(1 * 3 + 1) * 4] = 10;
    water[(1 * 3 + 0) * 4 + 3] = 1;
    smoothFarClipmapLandHeights(source, water, 3);
    expect(source[(1 * 3 + 1) * 4]).toBe(10);
  });
});

describe("far clipmap water routing", () => {
  it("requires positive water depth before water can replace the land material", () => {
    expect(farClipmapMaterialSource).toContain("const waterDepthMask: TslNode");
    expect(farClipmapMaterialSource).toContain(".mul(waterDepthMask)");
  });

  it("colors water cells instead of leaving them land-colored", () => {
    expect(farClipmapMaterialSource).toContain("tslMix(landColor, waterBodyColor, waterMask)");
  });
});

describe("far clipmap ocean fallback", () => {
  function fillWater(heightM: number, seaLevelM?: number): Float32Array {
    const material = createWebGpuMaterial();
    updateFarClipmapMaterialSourceTexture(material, {
      source: { sampleHeight: () => heightM, sampleMaterial: () => 0, sampleBiome: () => 0, sampleWater: () => 0 },
      gridResolution: 4,
      ringOriginX: 0,
      ringOriginZ: 0,
      cellSizeM: 8,
      cameraX: 0,
      cameraZ: 0,
      seaLevelM,
    });
    return material.userData.farClipmapWaterData as Float32Array;
  }

  it("synthesizes open ocean for below-sea cells without summary tiles", () => {
    const water = fillWater(0, 18);
    expect(water[0]).toBe(18);
    expect(water[3]).toBe(1);
  });

  it("keeps dry fallback cells and unset sea level water-free", () => {
    expect(fillWater(30, 18)[3]).toBe(-1);
    expect(fillWater(0, undefined)[3]).toBe(-1);
  });
});

// Mutates the module-level average-albedo registry; keep this describe last.
describe("far clipmap near-palette matching", () => {
  it("colorNode consumes palette uniforms derived from near-terrain layer averages", () => {
    const material = createWebGpuMaterial();
    const palette = material.userData.farClipmapPaletteUniforms as { uRock: unknown; uSnow: unknown };
    expect(palette?.uRock).toBeDefined();
    expect(colorNodeReaches(material, palette.uRock)).toBe(true);
    expect(colorNodeReaches(material, palette.uSnow)).toBe(true);
  });

  it("re-resolves palette uniforms after a texture re-bake", () => {
    const material = createWebGpuMaterial();
    const palette = material.userData.farClipmapPaletteUniforms as { uRock: { value: { x: number } } };
    const before = palette.uRock.value.x;
    recordTerrainLayerAverageAlbedos(["rock"], new Uint8Array(2 * 2 * 4).fill(255), 2);
    updateFarClipmapMaterialFrameUniforms(material, {
      cameraX: 0,
      cameraZ: 0,
      clipInnerRadiusM: 100,
      clipOuterRadiusM: 1000,
      ringOriginX: 0,
      ringOriginZ: 0,
      cellSizeM: 8,
      heightScale: 1,
      yOffset: 0,
    });
    expect(palette.uRock.value.x).toBeCloseTo(1, 5);
    expect(palette.uRock.value.x).not.toBe(before);
  });
});
