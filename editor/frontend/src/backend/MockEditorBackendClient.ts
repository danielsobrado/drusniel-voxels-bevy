import type { EditorBackendClient, WorldSummaryPayload } from "./EditorBackendClient";
import { mockAtlasMapping, mockChunks, mockMaterials, mockProtectedAreas, mockWaterBodies } from "../mocks/mockWorld";
import type { BlockAtlasMap } from "../types/world";

export class MockEditorBackendClient implements EditorBackendClient {
  async saveWorldSnapshot() {
    return { ok: true as const, snapshotId: `mock-snapshot-${Date.now()}` };
  }

  async loadWorldSummary(): Promise<WorldSummaryPayload> {
    return this.loadDefaultWorld();
  }

  async saveDefaultWorld() {
    return { ok: true as const, savedAt: new Date().toISOString() };
  }

  async loadDefaultWorld(): Promise<WorldSummaryPayload> {
    return {
      chunks: mockChunks,
      protectedAreas: mockProtectedAreas,
      waterBodies: mockWaterBodies,
      materials: mockMaterials,
    };
  }

  async savedWorldExists() {
    return true;
  }

  async loadAtlasMapping(): Promise<BlockAtlasMap> {
    return mockAtlasMapping;
  }

  async saveAtlasMapping(_atlasMapping: BlockAtlasMap) {
    return { ok: true as const, savedAt: new Date().toISOString() };
  }
}
