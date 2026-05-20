import type { AtlasMappingDto, BackendResult, EditorBackendClient, VoxelModelExport, VoxelModelFormat, WorldSaveSummary, WorldSummary } from "./EditorBackendClient";
import { mockAtlasMapping, mockChunks, mockLights, mockMaterials, mockPropAssets, mockProps, mockProtectedAreas, mockWaterBodies } from "../mocks/mockWorld";
import type { ViewportSnapshot } from "../types/world";

const mockWorldSummary = (): WorldSummary => ({
  worldId: "mock-drusniel-world",
  name: "Mock Drusniel World",
  chunks: mockChunks,
  protectedAreas: mockProtectedAreas,
  waterBodies: mockWaterBodies,
  lights: mockLights,
  props: mockProps,
  propAssets: mockPropAssets,
  materials: mockMaterials,
  updatedAt: new Date().toISOString(),
});

const mockSaveSummary = (snapshotId?: string): WorldSaveSummary => ({
  worldId: "mock-drusniel-world",
  savedAt: new Date().toISOString(),
  snapshotId,
});

export class MockEditorBackendClient implements EditorBackendClient {
  async saveWorldSnapshot(): Promise<BackendResult<WorldSaveSummary>> {
    return { ok: true, data: mockSaveSummary(`mock-snapshot-${Date.now()}`) };
  }

  async loadDefaultWorld(): Promise<BackendResult<WorldSummary>> {
    return { ok: true, data: mockWorldSummary() };
  }

  async loadWorldFile(_file: File): Promise<BackendResult<WorldSummary>> {
    return { ok: true, data: mockWorldSummary() };
  }

  async exportVoxelModel(format: VoxelModelFormat): Promise<BackendResult<VoxelModelExport>> {
    return {
      ok: true,
      data: {
        fileName: `mock-drusniel-world.${format}`,
        contentType: format === "vox" ? "model/x-vox" : "model/x-vl32",
        blob: new Blob([new Uint8Array(format === "vox" ? [86, 79, 88, 32] : [])]),
      },
    };
  }

  async saveDefaultWorld(): Promise<BackendResult<WorldSaveSummary>> {
    return { ok: true, data: mockSaveSummary() };
  }

  async savedWorldExists(): Promise<BackendResult<boolean>> {
    return { ok: true, data: true };
  }

  async deleteSavedWorld(): Promise<BackendResult<{ readonly deleted: boolean }>> {
    return { ok: true, data: { deleted: true } };
  }

  async getWorldSummary(): Promise<BackendResult<WorldSummary>> {
    return { ok: true, data: mockWorldSummary() };
  }

  async getViewportSnapshot(): Promise<BackendResult<ViewportSnapshot>> {
    return {
      ok: true,
      data: {
        protocolVersion: 1,
        worldId: "mock-drusniel-world",
        chunkSize: 16,
        sampleResolution: 1,
        bounds: {
          minChunk: [0, 0, 0],
          maxChunk: [3, 0, 3],
          minWorldY: 0,
          maxWorldY: 15,
          horizontalMin: [0, 0],
          horizontalMax: [63, 63],
        },
        camera: {
          target: [32, 8, 32],
          distance: 72,
        },
        chunks: mockChunks.map((chunk) => ({
          payloadId: `${chunk.id}-mock`,
          chunkId: chunk.id,
          coordinate: chunk.coordinate,
          dirty: chunk.dirty,
          meshState: chunk.dirty ? "queued" : "clean",
          materialStats: {
            nonAirVoxels: chunk.blockCount,
            waterVoxels: chunk.waterMeshCount,
          },
          water: {
            voxelCount: chunk.waterMeshCount,
            present: chunk.waterMeshCount > 0,
          },
          mesh: {
            included: true,
            reason: "included",
            terrain: {
              vertexCount: 0,
              indexCount: 0,
              triangleCount: 0,
              positions: [],
              normals: [],
              uvs: [],
              colors: [],
              indices: [],
            },
            water: {
              vertexCount: 0,
              indexCount: 0,
              triangleCount: 0,
              positions: [],
              normals: [],
              uvs: [],
              colors: [],
              indices: [],
            },
          },
          samples: [
            {
              x: chunk.coordinate[0] * 16 + 8,
              z: chunk.coordinate[2] * 16 + 8,
              height: 8,
              material: chunk.waterMeshCount > 0 ? "Water" : "TopSoil",
              water: chunk.waterMeshCount > 0,
            },
          ],
        })),
        generatedAt: new Date().toISOString(),
      },
    };
  }

  async getChunkSummaries(): Promise<BackendResult<typeof mockChunks>> {
    return { ok: true, data: mockChunks };
  }

  async loadAtlasMapping(): Promise<BackendResult<AtlasMappingDto>> {
    return { ok: true, data: mockAtlasMapping };
  }

  async saveAtlasMapping(_atlasMapping: AtlasMappingDto): Promise<BackendResult<WorldSaveSummary>> {
    return { ok: true, data: mockSaveSummary() };
  }
}
