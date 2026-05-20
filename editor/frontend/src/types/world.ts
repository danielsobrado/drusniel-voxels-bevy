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

export interface TerrainHeightConfig {
  readonly min: number;
  readonly max: number;
  readonly sea_level: number;
}

export interface TerrainNoiseLayer {
  readonly scale: number;
  readonly amplitude: number;
  readonly octaves: number;
  readonly persistence: number;
  readonly lacunarity: number;
}

export interface TerrainMountainConfig extends TerrainNoiseLayer {
  readonly ridge_power: number;
  readonly massif_scale: number;
  readonly massif_amplitude: number;
  readonly massif_threshold: number;
  readonly massif_power: number;
}

export interface TerrainCaveConfig {
  readonly enabled: boolean;
}

export interface TerrainRiverConfig {
  readonly enabled: boolean;
  readonly scale: number;
  readonly width: number;
  readonly depth: number;
  readonly octaves: number;
  readonly tributary_scale: number;
  readonly tributary_width: number;
}

export interface TerrainBasinConfig {
  readonly enabled: boolean;
  readonly spacing: number;
  readonly density: number;
  readonly min_radius: number;
  readonly max_radius: number;
  readonly min_depth: number;
  readonly max_depth: number;
  readonly shore_power: number;
}

export interface TerrainAquiferConfig {
  readonly enabled: boolean;
  readonly max_y: number;
  readonly noise_scale: number;
  readonly threshold: number;
}

export interface TerrainWaterBodiesConfig {
  readonly enabled: boolean;
  readonly lakes: TerrainBasinConfig;
  readonly ponds: TerrainBasinConfig;
  readonly aquifers: TerrainAquiferConfig;
}

export interface TerrainGenerationConfig {
  readonly height: TerrainHeightConfig;
  readonly continent: TerrainNoiseLayer;
  readonly mountains: TerrainMountainConfig;
  readonly hills: TerrainNoiseLayer;
  readonly detail: TerrainNoiseLayer;
  readonly caves: TerrainCaveConfig;
  readonly rivers: TerrainRiverConfig;
  readonly water_bodies: TerrainWaterBodiesConfig;
  readonly biome_modifiers: Record<string, number>;
}

export interface TerrainRecipe {
  readonly version: 1;
  readonly seed: number;
  readonly config: TerrainGenerationConfig;
}

export interface TerrainPreviewRequest {
  readonly recipe: TerrainRecipe;
  readonly origin: readonly [number, number];
  readonly size: readonly [number, number];
  readonly resolution: number;
}

export interface TerrainPreviewSample {
  readonly x: number;
  readonly z: number;
  readonly height: number;
  readonly biome: "Grassland" | "Sandy" | "Rocky" | "Clay";
  readonly material: ViewportVoxelMaterial;
  readonly water: boolean;
  readonly waterKind: "Ocean" | "LakeBasin" | "RiverChannel" | "Pond" | "CaveWaterAquifer" | "None";
  readonly waterDepth: number;
  readonly surfaceY: number;
  readonly tree: boolean;
}

export interface TerrainPreviewResult {
  readonly recipe: TerrainRecipe;
  readonly origin: readonly [number, number];
  readonly size: readonly [number, number];
  readonly resolution: number;
  readonly samples: readonly TerrainPreviewSample[];
  readonly stats: {
    readonly minHeight: number;
    readonly maxHeight: number;
    readonly avgHeight: number;
    readonly waterCells: number;
    readonly treeCells: number;
  };
  readonly fingerprint: string;
  readonly timingMs: number;
}

export type ViewportVoxelFace = "posY" | "negY" | "negX" | "posX" | "negZ" | "posZ";

export interface ViewportExposedVoxel {
  readonly position: readonly [number, number, number];
  readonly material: ViewportVoxelMaterial;
  readonly water: boolean;
  readonly exposedFaces: readonly ViewportVoxelFace[];
}

export interface ChunkViewportPreview {
  readonly chunkId: string;
  readonly coordinate: [number, number, number];
  readonly samples: readonly WorldSurfaceSample[];
  readonly voxels?: readonly ViewportExposedVoxel[];
}

export interface WorldViewportPreview {
  readonly chunkSize: number;
  readonly sampleResolution: number;
  readonly chunks: readonly ChunkViewportPreview[];
}

export interface ViewportSnapshotBounds {
  readonly minChunk: [number, number, number];
  readonly maxChunk: [number, number, number];
  readonly minWorldY: number;
  readonly maxWorldY: number;
  readonly horizontalMin: [number, number];
  readonly horizontalMax: [number, number];
}

export interface ViewportSnapshotCamera {
  readonly target: [number, number, number];
  readonly distance: number;
}

export interface ViewportMeshBuffer {
  readonly vertexCount: number;
  readonly indexCount: number;
  readonly triangleCount: number;
  readonly positions: readonly [number, number, number][] | null;
  readonly normals: readonly [number, number, number][] | null;
  readonly uvs: readonly [number, number][] | null;
  readonly colors: readonly [number, number, number, number][] | null;
  readonly indices: readonly number[] | null;
}

export interface ViewportMeshPayload {
  readonly included: boolean;
  readonly reason: "included" | "chunk_limit" | "vertex_limit" | "missing_chunk";
  readonly terrain: ViewportMeshBuffer;
  readonly water: ViewportMeshBuffer;
  readonly stats?: {
    readonly waterAirBoundariesTotal: number;
    readonly waterAirBoundariesExposed: number;
    readonly waterAirBoundariesSealed: number;
    readonly waterTrianglesRemovedSealed: number;
  };
}

export interface ViewportSnapshotChunk extends ChunkViewportPreview {
  readonly payloadId: string;
  readonly dirty: boolean;
  readonly meshState: "queued" | "clean";
  readonly materialStats: {
    readonly nonAirVoxels: number;
    readonly waterVoxels: number;
  };
  readonly water: {
    readonly voxelCount: number;
    readonly present: boolean;
  };
  readonly mesh: ViewportMeshPayload;
}

export interface ViewportSnapshot {
  readonly protocolVersion: 1;
  readonly worldId: string;
  readonly chunkSize: number;
  readonly sampleResolution: number;
  readonly bounds: ViewportSnapshotBounds;
  readonly camera: ViewportSnapshotCamera;
  readonly chunks: readonly ViewportSnapshotChunk[];
  readonly generatedAt: string;
}

export interface VoxelBlock {
  readonly id: string;
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

export interface WaterRuntimeSnapshot {
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
  readonly assetId?: string;
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

export type LightKind = "directional" | "point" | "spot";
export type LightSource = "editor" | "runtime" | "sun";

export interface LightInstance {
  readonly id: string;
  readonly name: string;
  readonly kind: LightKind;
  readonly enabled: boolean;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly position: [number, number, number];
  readonly rotation: [number, number, number];
  readonly color: string;
  readonly intensity: number;
  readonly range: number;
  readonly radius: number;
  readonly innerConeAngle: number;
  readonly outerConeAngle: number;
  readonly shadowsEnabled: boolean;
  readonly volumetric: boolean;
  readonly source: LightSource;
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
