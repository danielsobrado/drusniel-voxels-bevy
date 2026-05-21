import type { CanonicalBlockType } from "./world";

export const EDITOR_MODES = [
  "select",
  "voxel_sculpt",
  "voxel_paint",
  "area",
  "props",
  "water",
  "material",
  "lighting",
  "debug",
  "agent",
] as const;

export type EditorMode = (typeof EDITOR_MODES)[number];
export type RuntimeState = "mock" | "connected" | "disconnected" | "stale" | "error";
export type RenderQualityPreset = "Low" | "Medium" | "High" | "Performance100";
export type ViewportModifierKey = "none" | "shift" | "alt" | "control" | "meta";

export const EDITOR_VIEWPORT_ROLES = ["authoring", "validation"] as const;
export type EditorViewportRole = (typeof EDITOR_VIEWPORT_ROLES)[number];

export const EDITOR_VIEWPORT_IMPLEMENTATIONS = ["liteVoxel", "nativeBevy"] as const;
export type EditorViewportImplementation = (typeof EDITOR_VIEWPORT_IMPLEMENTATIONS)[number];

export interface EditorViewportContract {
  readonly role: EditorViewportRole;
  readonly implementation: EditorViewportImplementation;
  readonly ownsRuntimeRendering: boolean;
  readonly ownsWorldPersistence: boolean;
}

export const EDITOR_DIAGNOSTIC_CATEGORIES = [
  "nativeViewport",
  "frontend",
  "input",
  "selection",
  "hover",
  "highlight",
  "runtime",
] as const;
export type EditorDiagnosticsCategory = (typeof EDITOR_DIAGNOSTIC_CATEGORIES)[number];

export interface EditorDiagnosticsState {
  readonly enabled: boolean;
  readonly categories: readonly EditorDiagnosticsCategory[];
}

export type Selection =
  | { readonly kind: "voxel"; readonly chunkId: string; readonly position: [number, number, number]; readonly label: string }
  | { readonly kind: "chunk"; readonly id: string; readonly label: string }
  | { readonly kind: "area"; readonly id: string; readonly label: string }
  | { readonly kind: "prop"; readonly id: string; readonly label: string }
  | { readonly kind: "water"; readonly id: string; readonly label: string }
  | { readonly kind: "light"; readonly id: string; readonly label: string }
  | { readonly kind: "material"; readonly id: string; readonly label: string }
  | { readonly kind: "debug_resource"; readonly id: string; readonly label: string };

export interface BrushSettings {
  readonly radius: number;
  readonly strength: number;
  readonly materialBlockId: CanonicalBlockType;
  readonly falloff: "linear" | "smooth" | "constant";
  readonly action: "set" | "delete" | "paint";
  readonly brushShape: "single" | "box" | "sphere" | "cylinder";
  readonly size: [number, number, number];
  readonly continuous: boolean;
  readonly mask: "any" | "empty" | "occupied" | "material";
  readonly maskBlockId: CanonicalBlockType;
  readonly targetFace: "top" | "side" | "bottom" | "all";
}

export interface PropBrushSettings {
  readonly density: number;
  readonly spacing: number;
  readonly slopeLimit: number;
  readonly randomRotation: boolean;
  readonly scaleJitter: number;
  readonly alignToNormal: boolean;
  readonly terrainConform: boolean;
  readonly avoidProtectedAreas: boolean;
  readonly avoidWater: boolean;
  readonly collisionCheck: boolean;
  readonly seed: number;
}

export interface PropPlacementSettings {
  readonly rotateDragModifier: ViewportModifierKey;
  readonly fineScaleModifier: ViewportModifierKey;
  readonly rotationSensitivity: number;
  readonly rotationSnapDegrees: number;
  readonly scaleStep: number;
  readonly minScale: number;
  readonly maxScale: number;
}

export interface ViewportOverlayState {
  readonly chunkBounds: boolean;
  readonly voxelGrid: boolean;
  readonly waterDebug: boolean;
  readonly protectedAreas: boolean;
  readonly propBounds: boolean;
  readonly propBillboards: boolean;
  readonly agentTargets: boolean;
  readonly atlasPreview: boolean;
  readonly wireframe: boolean;
}

export interface DirtyState {
  readonly hasUnsavedChanges: boolean;
  readonly dirtyChunkIds: readonly string[];
  readonly dirtyAreaIds: readonly string[];
  readonly dirtyWaterBodyIds: readonly string[];
  readonly dirtyLightIds: readonly string[];
  readonly dirtyPropIds: readonly string[];
  readonly dirtyAtlas: boolean;
  readonly layoutDirty: boolean;
  readonly lastSavedAt?: string;
}

export interface CommandHistoryEntry {
  readonly commandId: string;
  readonly label: string;
  readonly createdAt: string;
  readonly status?: "success" | "failure" | "validation_error" | "runtime_unavailable" | "unsupported";
  readonly message?: string;
}

export interface EditorUndoSnapshot {
  readonly activeMode: EditorMode;
  readonly activeTool: string;
  readonly viewportRole: EditorViewportRole;
  readonly selection: Selection;
  readonly brushSettings: BrushSettings;
  readonly propBrushSettings: PropBrushSettings;
  readonly propPlacementSettings: PropPlacementSettings;
  readonly viewportOverlays: ViewportOverlayState;
  readonly renderQualityPreset: RenderQualityPreset;
  readonly chunks: readonly ChunkSummary[];
  readonly worldViewport: WorldViewportPreview | null;
  readonly viewportSnapshot: ViewportSnapshot | null;
  readonly protectedAreas: readonly ProtectedArea[];
  readonly waterBodies: readonly WaterBody[];
  readonly lights: readonly LightInstance[];
  readonly props: readonly PropInstance[];
  readonly propAssets: readonly PropAsset[];
  readonly materials: readonly MaterialAsset[];
  readonly atlasMapping: BlockAtlasMap;
  readonly selectedAtlasTileId: string;
  readonly selectedPropAssetId: string;
  readonly dirtyState: DirtyState;
}

export interface EditorUndoEntry {
  readonly id: string;
  readonly commandId: string;
  readonly label: string;
  readonly createdAt: string;
  readonly actor: "user" | "agent" | "system";
  readonly snapshot: EditorUndoSnapshot;
}

export interface EditorSavedSnapshot extends EditorUndoEntry {
  readonly note: string;
}

export interface LargeWorldStats {
  readonly enabled: boolean;
  readonly chunkCount: number;
  readonly propCount: number;
  readonly protectedAreaCount: number;
  readonly waterBodyCount: number;
  readonly lightCount: number;
  readonly consoleMessageCount: number;
}
import type { BlockAtlasMap, ChunkSummary, LightInstance, MaterialAsset, PropAsset, PropInstance, ProtectedArea, ViewportSnapshot, WaterBody, WorldViewportPreview } from "./world";
