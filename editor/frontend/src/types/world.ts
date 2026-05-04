export type BlockType = "grass" | "dirt" | "rock" | "sand";

export interface ChunkSummary {
  readonly id: string;
  readonly label: string;
  readonly coordinate: [number, number, number];
  readonly blockCount: number;
  readonly dirty: boolean;
  readonly biome: string;
  readonly meshStatus: "clean" | "dirty" | "queued";
}

export interface VoxelBlock {
  readonly id: BlockType;
  readonly displayName: string;
  readonly solid: boolean;
  readonly defaultMaterialId: string;
}

export type ProtectedAreaKind = "spawn" | "story" | "settlement";
export type ProtectedAreaShape = "box" | "cylinder";

export interface ProtectedAreaRuleMatrix {
  readonly allowVoxelEdit: boolean;
  readonly allowPropEdit: boolean;
  readonly allowWaterEdit: boolean;
  readonly allowMaterialEdit: boolean;
  readonly agentRequiresApproval: boolean;
}

export interface ProtectedArea {
  readonly id: string;
  readonly name: string;
  readonly kind: ProtectedAreaKind;
  readonly shape: ProtectedAreaShape;
  readonly center: [number, number, number];
  readonly size: [number, number, number];
  readonly rules: ProtectedAreaRuleMatrix;
}

export type WaterBodyKind = "Ocean" | "Lake" | "River" | "Pond" | "Unknown";
export type WaterReflectionDebugViewMode = "Off" | "Mask" | "ReflectionOnly" | "BlendFactor";

export interface WaterReflectionStatus {
  readonly enabled: boolean;
  readonly debugViewMode: WaterReflectionDebugViewMode;
  readonly probeValid: boolean;
  readonly lastProbeUpdateMs: number;
}

export interface WaterBody {
  readonly id: string;
  readonly name: string;
  readonly kind: WaterBodyKind;
  readonly center: [number, number, number];
  readonly surfaceY: number;
  readonly reflectionStatus: WaterReflectionStatus;
}

export type PropType = "tree" | "rock" | "bush" | "flower" | "building";
export type BillboardMode = "SingleAxial" | "Directional4" | "Directional8";

export interface PropInstance {
  readonly id: string;
  readonly name: string;
  readonly type: PropType;
  readonly billboardMode: BillboardMode;
  readonly position: [number, number, number];
  readonly assetPath: string;
}

export type MaterialKind = "blocky" | "triplanar" | "building" | "props" | "water";

export interface MaterialAsset {
  readonly id: string;
  readonly name: string;
  readonly kind: MaterialKind;
  readonly sourcePath: string;
}

export interface AtlasMapping {
  readonly top: string;
  readonly side: string;
  readonly bottom: string;
}

export type BlockAtlasMap = Record<BlockType, AtlasMapping>;
