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
export type RuntimeState = "disconnected" | "mocked" | "playing" | "paused" | "simulating";
export type RenderQualityPreset = "Low" | "Medium" | "High" | "Performance100";

export type Selection =
  | { readonly kind: "voxel"; readonly chunkId: string; readonly position: [number, number, number]; readonly label: string }
  | { readonly kind: "chunk"; readonly id: string; readonly label: string }
  | { readonly kind: "area"; readonly id: string; readonly label: string }
  | { readonly kind: "prop"; readonly id: string; readonly label: string }
  | { readonly kind: "water"; readonly id: string; readonly label: string }
  | { readonly kind: "material"; readonly id: string; readonly label: string }
  | { readonly kind: "debug_resource"; readonly id: string; readonly label: string };

export interface BrushSettings {
  readonly radius: number;
  readonly strength: number;
  readonly materialBlockId: "grass" | "dirt" | "rock" | "sand";
  readonly falloff: "linear" | "smooth" | "constant";
  readonly brushShape: "cube" | "sphere" | "cylinder";
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

export interface ViewportOverlayState {
  readonly chunkBounds: boolean;
  readonly voxelGrid: boolean;
  readonly waterDebug: boolean;
  readonly protectedAreas: boolean;
  readonly propBounds: boolean;
  readonly propBillboards: boolean;
  readonly agentTargets: boolean;
  readonly atlasPreview: boolean;
}

export interface DirtyState {
  readonly hasUnsavedChanges: boolean;
  readonly dirtyChunkIds: readonly string[];
  readonly dirtyAreaIds: readonly string[];
  readonly dirtyWaterBodyIds: readonly string[];
  readonly dirtyAtlas: boolean;
  readonly lastSavedAt?: string;
}

export interface CommandHistoryEntry {
  readonly commandId: string;
  readonly label: string;
  readonly createdAt: string;
}
