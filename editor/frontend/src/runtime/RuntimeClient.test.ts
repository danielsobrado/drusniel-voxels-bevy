import { describe, expect, it } from "vitest";
import { BrowserRuntimeClient } from "./BrowserRuntimeClient";
import { MockRuntimeClient } from "./MockRuntimeClient";
import { runtimeCommandSuccess } from "./runtimeSchemas";
import { mockAtlasMapping } from "../mocks/mockWorld";
import type { TerrainPreviewRequest } from "../types/world";

const testTerrainPreviewRequest: TerrainPreviewRequest = {
  recipe: {
    version: 1,
    seed: 7,
    config: {
      height: { min: 14, max: 118, sea_level: 0 },
      continent: { scale: 0.001, amplitude: 40, octaves: 2, persistence: 0.5, lacunarity: 2 },
      mountains: {
        scale: 0.008,
        amplitude: 120,
        octaves: 7,
        persistence: 0.48,
        lacunarity: 2.3,
        ridge_power: 1.8,
        massif_scale: 0.0035,
        massif_amplitude: 38,
        massif_threshold: 0.38,
        massif_power: 1.65,
      },
      hills: { scale: 0.025, amplitude: 25, octaves: 4, persistence: 0.5, lacunarity: 2 },
      detail: { scale: 0.1, amplitude: 3, octaves: 3, persistence: 0.5, lacunarity: 2 },
      caves: { enabled: false },
      rivers: { enabled: true, scale: 0.003, width: 4, depth: 6, octaves: 3, tributary_scale: 0.008, tributary_width: 2 },
      water_bodies: {
        enabled: true,
        lakes: { enabled: true, spacing: 96, density: 0.38, min_radius: 18, max_radius: 42, min_depth: 3, max_depth: 8, shore_power: 1.45 },
        ponds: { enabled: true, spacing: 48, density: 0.34, min_radius: 7, max_radius: 17, min_depth: 2, max_depth: 5, shore_power: 1.25 },
        aquifers: { enabled: false, max_y: 10, noise_scale: 0.045, threshold: 0.84 },
      },
      biome_modifiers: {},
    },
  },
  origin: [0, 0],
  size: [256, 256],
  resolution: 16,
};

describe("runtime clients", () => {
  it("browser runtime client sends safe write commands through the bridge", async () => {
    const requests: unknown[] = [];
    const client = new BrowserRuntimeClient({
      executeCommand: async (request) => {
        requests.push(request);
        return runtimeCommandSuccess({
          preset: "Low",
          metrics: {
            propLodDistanceScale: 0.72,
            propShadowDistanceScale: 0.7,
            terrainMaterialLodDistance: 62.4,
            waterReflectionResolutionScale: 0.25,
            waterReflectionUpdateInterval: 1 / 30,
            waterReflectionDistance: 80,
            waterReflectionQualityCode: 0,
            shadowQualityCode: 0,
          },
        });
      },
    });

    const result = await client.setRenderQuality("Low");

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      type: "runtime.setRenderQuality",
      payload: { preset: "Low" },
    });
  });

  it("browser runtime client sends protected area commands through the bridge", async () => {
    const requests: unknown[] = [];
    const client = new BrowserRuntimeClient({
      executeCommand: async (request) => {
        requests.push(request);
        return runtimeCommandSuccess({ areaId: "area-1", deleted: true });
      },
    });

    const result = await client.deleteProtectedArea("area-1");

    expect(result.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      type: "runtime.deleteProtectedArea",
      payload: { areaId: "area-1" },
    });
  });

  it("browser runtime client sends viewport debug overlay commands through the bridge", async () => {
    const requests: unknown[] = [];
    const client = new BrowserRuntimeClient({
      executeCommand: async (request) => {
        requests.push(request);
        return runtimeCommandSuccess({
          chunkBounds: true,
          voxelGrid: true,
          waterDebug: false,
          protectedAreas: true,
          propBounds: true,
          propBillboards: true,
          agentTargets: true,
          atlasPreview: false,
          wireframe: true,
        });
      },
    });

    const result = await client.setViewportDebugOverlay("wireframe", true);

    expect(result.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      type: "runtime.setViewportDebugOverlay",
      payload: { overlay: "wireframe", enabled: true },
    });
  });

  it("browser runtime client sends terrain recipe preview commands through the bridge", async () => {
    const requests: unknown[] = [];
    const client = new BrowserRuntimeClient({
      executeCommand: async (request) => {
        requests.push(request);
        return runtimeCommandSuccess({
          ...testTerrainPreviewRequest,
          samples: [],
          stats: { minHeight: 0, maxHeight: 0, avgHeight: 0, waterCells: 0, treeCells: 0 },
          fingerprint: "0x0",
          timingMs: 0,
        });
      },
    });

    const result = await client.previewTerrainRecipe(testTerrainPreviewRequest);

    expect(result.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      type: "runtime.previewTerrainRecipe",
      payload: { request: testTerrainPreviewRequest },
    });
  });

  it("browser runtime client requests default terrain recipes through the bridge", async () => {
    const requests: unknown[] = [];
    const client = new BrowserRuntimeClient({
      executeCommand: async (request) => {
        requests.push(request);
        return runtimeCommandSuccess({ recipe: testTerrainPreviewRequest.recipe, fingerprint: "0x0" });
      },
    });

    const result = await client.getDefaultTerrainRecipe();

    expect(result.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      type: "runtime.getDefaultTerrainRecipe",
      payload: {},
    });
  });

  it("browser runtime client sends water body updates through the bridge", async () => {
    const requests: unknown[] = [];
    const client = new BrowserRuntimeClient({
      executeCommand: async (request) => {
        requests.push(request);
        return runtimeCommandSuccess({
          waterBody: {
            id: "water-body-42",
            kind: "River",
            reflectionStrength: 0.81,
            fresnelPower: 3.7,
            distortionStrength: 0.16,
          },
        });
      },
    });

    const result = await client.updateWaterBody("water-body-42", { kind: "River", reflectionStrength: 0.81 });

    expect(result.ok).toBe(true);
    expect(requests[0]).toMatchObject({
      type: "runtime.updateWaterBody",
      payload: {
        waterBodyId: "water-body-42",
        patch: { kind: "River", reflectionStrength: 0.81 },
      },
    });
  });

  it("browser runtime client sends prop mutation commands through the bridge", async () => {
    const requests: unknown[] = [];
    const client = new BrowserRuntimeClient({
      executeCommand: async (request) => {
        requests.push(request);
        return runtimeCommandSuccess({
          props: [],
          propStats: {
            totalInstances: 0,
            visibleInstances: 0,
            hiddenInstances: 0,
            billboardedCount: 0,
            threeDCount: 0,
            lodSwitches: 0,
            missingGeneratedAssets: 0,
            boundsWarnings: 0,
            instancedGroups: 0,
            shadowCastCount: 0,
          },
          removedPropIds: [],
        });
      },
    });

    await client.scatterProps([
      {
        id: "prop-1",
        assetId: "oak_tree",
        name: "Oak Tree 001",
        type: "tree",
        billboardMode: "Directional4",
        billboardEnabled: true,
        billboardSwitchDistance: 12,
        currentLod: "High",
        visible: true,
        shadowCast: true,
        boundsWarning: false,
        generatedAssetAvailable: true,
        chunkId: "chunk-0-0-0",
        position: [0, 1, 2],
        assetPath: "assets/models/oak.glb",
        transform: { position: [0, 1, 2], rotation: [0, 0, 0], scale: [1, 1, 1] },
        material: "mat-grass-block",
        lodState: "High",
        collision: true,
        placementRules: {
          avoidWater: true,
          maxSlope: 35,
          minSeparation: 4,
          randomRotation: true,
          scaleJitter: 0.2,
          alignToNormal: true,
          terrainConform: true,
          avoidProtectedAreas: false,
          collisionCheck: true,
          seed: 1,
        },
      },
    ]);
    await client.removeProps({ propIds: ["prop-1"] });

    expect(requests[0]).toMatchObject({
      type: "runtime.scatterProps",
      payload: { props: [{ id: "prop-1", assetId: "oak_tree" }] },
    });
    expect(requests[1]).toMatchObject({
      type: "runtime.removeProps",
      payload: { propIds: ["prop-1"] },
    });
  });

  it("mock runtime client validates atlas write result shape", async () => {
    const client = new MockRuntimeClient();
    const result = await client.setAtlasMapping(mockAtlasMapping);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("Expected mock atlas mapping result.");
    }
    expect(result.data.mapping.grass.top).toBe(mockAtlasMapping.grass.top);
    expect(result.data.dirty).toBe(true);

    const dirtySnapshot = await client.getRuntimeSnapshot();
    expect(dirtySnapshot.ok).toBe(true);
    if (!dirtySnapshot.ok) {
      throw new Error("Expected mock runtime snapshot after atlas update.");
    }
    expect(dirtySnapshot.data.atlasMapping.dirty).toBe(true);

    await client.saveAtlasMapping(mockAtlasMapping);
    const cleanSnapshot = await client.getRuntimeSnapshot();
    expect(cleanSnapshot.ok).toBe(true);
    if (!cleanSnapshot.ok) {
      throw new Error("Expected mock runtime snapshot after atlas save.");
    }
    expect(cleanSnapshot.data.atlasMapping.dirty).toBe(false);
  });

  it("mock runtime client handles protected area validation and rule queries", async () => {
    const client = new MockRuntimeClient();
    const validation = await client.validateProtectedAreaConflicts();
    const query = await client.queryProtectedRulesAtVoxel([64, 24, 64]);

    expect(validation.ok).toBe(true);
    expect(query.ok).toBe(true);
  });

  it("mock runtime client returns deterministic terrain previews", async () => {
    const client = new MockRuntimeClient();
    const first = await client.previewTerrainRecipe(testTerrainPreviewRequest);
    const second = await client.previewTerrainRecipe(testTerrainPreviewRequest);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) {
      throw new Error("Expected mock terrain preview results.");
    }
    expect(first.data.samples).toEqual(second.data.samples);
    expect(first.data.stats).toEqual(second.data.stats);
  });
});
