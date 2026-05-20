import type { BlockAtlasMap, ChunkSummary, LightInstance, MaterialAsset, PropAsset, PropInstance, ProtectedArea, ViewportSnapshot, WaterBody, WorldViewportPreview } from "../types/world";

export type BackendResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string; readonly code?: string };

export interface WorldSummary {
  readonly worldId: string;
  readonly name: string;
  readonly chunks: readonly ChunkSummary[];
  readonly protectedAreas: readonly ProtectedArea[];
  readonly waterBodies: readonly WaterBody[];
  readonly lights?: readonly LightInstance[];
  readonly props: readonly PropInstance[];
  readonly propAssets?: readonly PropAsset[];
  readonly materials: readonly MaterialAsset[];
  readonly viewport?: WorldViewportPreview;
  readonly updatedAt: string;
}

export interface WorldSaveSummary {
  readonly worldId: string;
  readonly savedAt: string;
  readonly snapshotId?: string;
}

export type AtlasMappingDto = BlockAtlasMap;
export type VoxelModelFormat = "vox" | "vl32";

export interface VoxelModelExport {
  readonly fileName: string;
  readonly contentType: string;
  readonly blob: Blob;
}

export interface EditorBackendClient {
  readonly saveWorldSnapshot: () => Promise<BackendResult<WorldSaveSummary>>;
  readonly loadDefaultWorld: () => Promise<BackendResult<WorldSummary>>;
  readonly loadWorldFile: (file: File) => Promise<BackendResult<WorldSummary>>;
  readonly exportVoxelModel: (format: VoxelModelFormat) => Promise<BackendResult<VoxelModelExport>>;
  readonly saveDefaultWorld: () => Promise<BackendResult<WorldSaveSummary>>;
  readonly savedWorldExists: () => Promise<BackendResult<boolean>>;
  readonly deleteSavedWorld: () => Promise<BackendResult<{ readonly deleted: boolean }>>;
  readonly getWorldSummary: () => Promise<BackendResult<WorldSummary>>;
  readonly getViewportSnapshot: () => Promise<BackendResult<ViewportSnapshot>>;
  readonly getChunkSummaries: () => Promise<BackendResult<readonly ChunkSummary[]>>;
  readonly loadAtlasMapping: () => Promise<BackendResult<AtlasMappingDto>>;
  readonly saveAtlasMapping: (atlasMapping: AtlasMappingDto) => Promise<BackendResult<WorldSaveSummary>>;
}
