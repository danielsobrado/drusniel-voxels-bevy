import type { BlockAtlasMap, ChunkSummary, MaterialAsset, ProtectedArea, WaterBody } from "../types/world";

export interface WorldSummaryPayload {
  readonly chunks: readonly ChunkSummary[];
  readonly protectedAreas: readonly ProtectedArea[];
  readonly waterBodies: readonly WaterBody[];
  readonly materials: readonly MaterialAsset[];
}

export interface EditorBackendClient {
  readonly saveWorldSnapshot: () => Promise<{ readonly ok: true; readonly snapshotId: string }>;
  readonly loadWorldSummary: () => Promise<WorldSummaryPayload>;
  readonly saveDefaultWorld: () => Promise<{ readonly ok: true; readonly savedAt: string }>;
  readonly loadDefaultWorld: () => Promise<WorldSummaryPayload>;
  readonly savedWorldExists: () => Promise<boolean>;
  readonly loadAtlasMapping: () => Promise<BlockAtlasMap>;
  readonly saveAtlasMapping: (atlasMapping: BlockAtlasMap) => Promise<{ readonly ok: true; readonly savedAt: string }>;
}
