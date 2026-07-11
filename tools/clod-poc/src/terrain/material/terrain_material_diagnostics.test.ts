import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  createTerrainMaterialDiagnosticSnapshot,
  selectTerrainDiagnosticLayer,
  type TerrainDiagnosticSlot,
} from "./terrain_material_diagnostics.js";

const slots: TerrainDiagnosticSlot[] = [
  {
    index: 0,
    name: "grass",
    selectedId: "generated:grass",
    baseScale: 0.06,
    resolvedScale: 0.24,
    repeatPeriodM: 1 / 0.24,
    heightMin: 0,
    heightMax: 30,
  },
  {
    index: 1,
    name: "rock",
    selectedId: "generated:rock",
    baseScale: 0.04,
    resolvedScale: 0.16,
    repeatPeriodM: 1 / 0.16,
    heightMin: 25,
    heightMax: 80,
  },
  {
    index: 2,
    name: "snow",
    selectedId: "generated:snow",
    baseScale: 0.035,
    resolvedScale: 0.14,
    repeatPeriodM: 1 / 0.14,
    heightMin: 70,
    heightMax: 140,
  },
];

const runtimeSlots = slots.map((slot) => ({
  name: slot.name,
  selectedId: slot.selectedId,
  scale: slot.baseScale,
  heightMin: slot.heightMin,
  heightMax: slot.heightMax,
}));

describe("terrain material diagnostics", () => {
  it("selects an in-band layer before nearest fallback", () => {
    expect(selectTerrainDiagnosticLayer(12, [0, 1, 2], slots, 2)).toEqual({
      layer: 0,
      usedNearestFallback: false,
    });
    expect(selectTerrainDiagnosticLayer(110, [0, 1, 2], slots, 2)).toEqual({
      layer: 2,
      usedNearestFallback: false,
    });
  });

  it("reports nearest fallback when all configured bands miss the height", () => {
    expect(selectTerrainDiagnosticLayer(200, [0, 1, 2], slots, 2)).toEqual({
      layer: 2,
      usedNearestFallback: true,
    });
  });

  it("detects a dominant green layer in visible CLOD geometry", () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 5, 0,
      1, 10, 0,
      0, 15, 1,
      1, 20, 1,
    ], 3));
    geometry.setAttribute("biomeId", new THREE.Float32BufferAttribute([0, 0, 0, 0], 1));
    const mesh = new THREE.Mesh(geometry);
    mesh.updateMatrixWorld(true);
    const albedoArray = new THREE.DataArrayTexture(new Uint8Array(4 * 3), 1, 1, 3);

    const snapshot = createTerrainMaterialDiagnosticSnapshot({
      backend: "webgpu",
      worldCells: 512,
      url: "http://localhost/?scene=infinite-islands&farShell=0&farClipmap=0",
      state: {
        terrainMaterialSource: "procedural",
        albedo: true,
        triplanar: true,
        normalMap: true,
        proceduralMicroNormals: true,
        normalIntensity: 1,
        roughness: 0.9,
        metalness: 0,
        textureScale: 1,
        textureBlendMode: "blend bands",
        textureBlendWidth: 2,
        proceduralDebugMode: "final",
        colorByLod: false,
        wireframe: false,
        clodPerfMode: false,
        normalColor: false,
        normalDivergence: false,
        divergenceGain: 1,
        frontSideOnly: false,
        tintBubble: false,
      },
      slots: runtimeSlots,
      options: {
        enabled: true,
        triplanar: true,
        normalMap: false,
        normalIntensity: 1,
        roughness: 0.9,
        metalness: 0,
        textureScale: 1,
        blendBands: true,
        blendWidth: 2,
        albedoArray,
        normalArray: null,
        procedural: {
          enabled: true,
          noiseA: null,
          noiseB: null,
          debugMode: 0,
          microFadeStart: 45,
          microFadeEnd: 85,
          lodBias: 0,
        },
        biomeSplat: true,
      },
      views: [{ node: { level: 0 }, mat: {} as never, mesh }],
      texturesActive: true,
    });

    expect(snapshot.visible.dominantLayer).toBe("grass");
    expect(snapshot.visible.dominantLayerRatio).toBe(1);
    expect(snapshot.findings.some((finding) => finding.code === "GREEN_LAYER_DOMINANCE")).toBe(true);

    geometry.dispose();
    albedoArray.dispose();
  });
});
