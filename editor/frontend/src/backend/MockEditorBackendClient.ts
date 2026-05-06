import type { AtlasMappingDto, BackendResult, EditorBackendClient, WorldSaveSummary, WorldSummary } from "./EditorBackendClient";
import { mockAtlasMapping, mockChunks, mockMaterials, mockProtectedAreas, mockWaterBodies } from "../mocks/mockWorld";

const mockWorldSummary = (): WorldSummary => ({
  worldId: "mock-drusniel-world",
  name: "Mock Drusniel World",
  chunks: mockChunks,
  protectedAreas: mockProtectedAreas,
  waterBodies: mockWaterBodies,
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
