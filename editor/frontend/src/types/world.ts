export type BlockType = "grass" | "dirt" | "rock" | "sand";

export type ChunkMeshMode = "Greedy" | "Mesher" | "LOD" | "Baked";

export interface ChunkSummary {
  readonly id: string;
  readonly label: string;
  readonly coordinate: [number, number, number];
  readonly blockCount: number;
  readonly dirty: boolean;
  readonly biome: string;
  readonly meshStatus: "clean" | "dirty" | "queued";
  readonly meshMode: ChunkMeshMode;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly waterMeshCount: number;
  readonly lodGroup: number;
}

export type ViewportVoxelMaterial =
  | "Air"
  | "TopSoil"
  | "SubSoil"
  | "Rock"
  | "Bedrock"
  | "Sand"
  | "Clay"
  | "Water"
  | "Wood"
  | "Leaves"
  | "DungeonWall"
  | "DungeonFloor";

export interface WorldSurfaceSample {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly material: ViewportVoxelMaterial;
  readonly water: boolean;
}

export interface ChunkViewportPreview {
  readonly chunkId: string;
  readonly coordinate: [number, number, number];
  readonly samples: readonly WorldSurfaceSample[];
}

export interface WorldViewportPreview {
  readonly chunkSize: number;
  readonly sampleResolution: number;
  readonly chunks: readonly ChunkViewportPreview[];
}

export interface VoxelBlock {
  readonly id: BlockType;
  readonly displayName: string;
  readonly solid: boolean;
  readonly defaultMaterialId: string;
}

export type ProtectedAreaKind = "unbreakable" | "spawn" | "spawn_protection" | "story_lock" | "quest_lock" | "no_dig" | "no_build" | "no_prop" | "no_props" | "custom";
export type ProtectedAreaShape = "box" | "sphere" | "cylinder" | "chunk_set" | "polygon";

export interface ProtectedAreaRuleMatrix {
  readonly canMine: boolean;
  readonly canPlace: boolean;
  readonly canPaint: boolean;
  readonly canSpawnProps: boolean;
  readonly canEditWater: boolean;
  readonly canSaveModify: boolean;
}

export interface ProtectedAreaBounds {
  readonly min: [number, number, number];
  readonly max: [number, number, number];
}

export interface ProtectedArea {
  readonly id: string;
  readonly name: string;
  readonly kind: ProtectedAreaKind;
  readonly shape: ProtectedAreaShape;
  readonly priority: number;
  readonly locked: boolean;
  readonly color: string;
  readonly center: [number, number, number];
  readonly size: [number, number, number];
  readonly bounds: ProtectedAreaBounds;
  readonly rules: ProtectedAreaRuleMatrix;
}

export type WaterBodyKind = "Ocean" | "Lake" | "River" | "Pond" | "Unknown";
export type WaterReflectionDebugViewMode = "Off" | "Mask" | "ReflectionOnly" | "BlendFactor";
export type WaterReflectionReason =
  | "disabled"
  | "out-of-range"
  | "no-water-in-view"
  | "too-small"
  | "throttled"
  | "active"
  | "no-water";

export interface WaterPresence {
  readonly nearestWaterDistance: number | null;
  readonly visibleMeshes: number;
  readonly eligibleMeshes: number;
  readonly viewVisibleMeshes: number;
  readonly totalWaterMeshes: number;
}

export interface WaterVisualProbeOutput {
  readonly nearestBodyKind: WaterBodyKind | "Unknown";
  readonly materialMode: "Fancy" | "Cheap" | "Hidden" | "Unknown";
  readonly maxDepth: number;
  readonly triangles: number;
  readonly reflectionEligible: boolean;
  readonly reflectionActive: boolean;
  readonly compositorPixelMatched: boolean;
}

export interface WaterReflectionStatus {
  readonly active: boolean;
  readonly sampleReflection: boolean;
  readonly reason: WaterReflectionReason;
  readonly resolutionScale: number;
  readonly effectiveHz: number;
  readonly enabled: boolean;
  readonly debugViewMode: WaterReflectionDebugViewMode;
  readonly probeValid: boolean;
  readonly lastProbeUpdateMs: number;
}

export interface MockWaterRuntimeSnapshot {
  readonly reflectionStatus: WaterReflectionStatus;
  readonly waterPresence: WaterPresence;
  readonly probe: WaterVisualProbeOutput;
}

export interface WaterBody {
  readonly id: string;
  readonly name: string;
  readonly kind: WaterBodyKind;
  readonly bodyType: string;
  readonly center: [number, number, number];
  readonly surfaceY: number;
  readonly waveAmplitude: number;
  readonly waveSpeed: number;
  readonly waveScale: number;
  readonly waveCount: number;
  readonly reflectionStrength: number;
  readonly fresnelPower: number;
  readonly distortionStrength: number;
  readonly shallowColor: string;
  readonly deepColor: string;
  readonly clarity: number;
  readonly murkiness: number;
  readonly foamEnabled: boolean;
  readonly shoreFoam: number;
  readonly waveCrestFoam: number;
  readonly baseAlpha: number;
  readonly detailNormalIntensity: number;
  readonly detailScrollSpeed: number;
  readonly reflectionStatus: WaterReflectionStatus;
}

export type PropType = "tree" | "rock" | "bush" | "flower" | "building";
export type BillboardMode = "SingleAxial" | "Directional4" | "Directional8";
export type PropLodState = "High" | "Medium" | "Low" | "Culled";

export interface PropAsset {
  readonly id: string;
  readonly name: string;
  readonly type: PropType;
  readonly category: PropType;
  readonly assetPath: string;
  readonly defaultMaterial: string;
}

export interface PropTransform {
  readonly position: [number, number, number];
  readonly rotation: [number, number, number];
  readonly scale: [number, number, number];
}

export interface PlacementRules {
  readonly avoidWater: boolean;
  readonly maxSlope: number;
  readonly minSeparation: number;
  readonly randomRotation: boolean;
  readonly scaleJitter: number;
  readonly alignToNormal: boolean;
  readonly terrainConform: boolean;
  readonly avoidProtectedAreas: boolean;
  readonly collisionCheck: boolean;
  readonly seed: number;
}

export interface PropInstance {
  readonly id: string;
  readonly name: string;
  readonly type: PropType;
  readonly billboardMode: BillboardMode;
  readonly billboardEnabled: boolean;
  readonly billboardSwitchDistance: number;
  readonly currentLod: PropLodState;
  readonly visible: boolean;
  readonly shadowCast: boolean;
  readonly boundsWarning: boolean;
  readonly generatedAssetAvailable: boolean;
  readonly chunkId: string;
  readonly position: [number, number, number];
  readonly assetPath: string;
  readonly transform: PropTransform;
  readonly material: string;
  readonly lodState: PropLodState;
  readonly collision: boolean;
  readonly placementRules: PlacementRules;
}

export interface PropStats {
  readonly totalInstances: number;
  readonly visibleInstances: number;
  readonly hiddenInstances: number;
  readonly billboardedCount: number;
  readonly threeDCount: number;
  readonly lodSwitches: number;
  readonly missingGeneratedAssets: number;
  readonly boundsWarnings: number;
  readonly instancedGroups: number;
  readonly shadowCastCount: number;
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
