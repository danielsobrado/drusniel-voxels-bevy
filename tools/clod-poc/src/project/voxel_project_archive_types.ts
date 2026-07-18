import type { ClodPagesConfig } from "../config.js";
import type { GrassShaderMode } from "../grass/grass_config.js";
import type { BrushOp, BrushShape, TerrainFieldConfig, VoxelEditSnapshot } from "../terrain/terrain.js";
import type { WeatherMode } from "../app/clod_constants.js";
import type { WaterDebugMode } from "../water/waterConfig.js";
import type { ProjectGeneratorQuery } from "./project_world_identity.js";
import type { ProjectPropInstance } from "./project_props.js";

export const LEGACY_VOXEL_PROJECT_SCHEMA_VERSION = 3 as const;
export const VOXEL_PROJECT_SCHEMA_VERSION = 4 as const;

export type TextureBlendMode = "hard bands" | "blend bands";
export type PostProcessDebugMode = "output" | "copy" | "off";

export interface ProjectWorldIdentity {
  readonly scene: string;
  readonly generatorVersion: string;
  readonly terrainField: TerrainFieldConfig;
  readonly generatorQuery: ProjectGeneratorQuery;
}

export interface ProjectSessionState {
  thresholdPx: number;
  enforce21: boolean;
  freeze: boolean;
  wireframe: boolean;
  showBounds: boolean;
  showSeamPoints: boolean;
  showCrossLodBorders: boolean;
  colorByLod: boolean;
  normalColor: boolean;
  normalDivergence: boolean;
  divergenceGain: number;
  frontSideOnly: boolean;
  recomputedNormals: boolean;
  forceMaxLevel: "auto" | "0" | "1" | "2" | "3";
  textureScale: number;
  triplanar: boolean;
  albedo: boolean;
  normalMap: boolean;
  normalIntensity: number;
  roughness: number;
  metalness: number;
  textureBlendMode: TextureBlendMode;
  textureBlendWidth: number;
  terrainBrightness: number;
  terrainContrast: number;
  terrainSaturation: number;
  terrainWarmth: number;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunIntensity: number;
  skyIntensity: number;
  groundIntensity: number;
  exposure: number;
  horizonSoftness: number;
  sunDiskIntensity: number;
  sunGlowIntensity: number;
  hazeIntensity: number;
  postProcessEnabled: boolean;
  postProcessOpacity: number;
  postProcessExposure: number;
  postProcessContrast: number;
  postProcessSaturation: number;
  postProcessVignette: number;
  postProcessDebugMode: PostProcessDebugMode;
  bubble: boolean;
  bubbleRadius: number;
  tintBubble: boolean;
  digEnabled: boolean;
  digRadius: number;
  brushOp: BrushOp;
  brushShape: BrushShape;
  brushMaterial: number;
  brushHeight: number;
  brushStrength: number;
  brushFalloff: number;
  brushFlowMs: number;
  grassEnabled: boolean;
  grassShaderMode: GrassShaderMode;
  grassAlphaToCoverage: boolean;
  grassDistance: number;
  grassBladeSpacing: number;
  grassBladeHeight: number;
  grassBladeHeightVariation: number;
  grassBladeWidth: number;
  grassWindStrength: number;
  grassWindSpeed: number;
  grassSlopeMinY: number;
  grassMinHeight: number;
  grassMaxHeight: number;
  grassMaxBlades: number;
  grassSeed: number;
  treesEnabled?: boolean;
  treeDistance?: number;
  treeMaxInstances?: number;
  treeDebugColorByLod?: boolean;
  treeWindEnabled?: boolean;
  treeWindStrength?: number;
  treeWindSpeed?: number;
  treeGustStrength?: number;
  treeTrunkSwayStrength?: number;
  treeLeafFlutterStrength?: number;
}

export interface ProjectTextureSlot {
  index: number;
  source: "empty" | "builtin" | "custom";
  name: string;
  selectedId: string;
  scale: number;
  heightMin: number;
  heightMax: number;
  customPath?: string;
  mimeType?: string;
  normalPath?: string;
  normalMimeType?: string;
}

export interface ProjectWaterArchiveState {
  waterEnabled: boolean;
  waterDebugMode: WaterDebugMode;
  waterClipmapTint: boolean;
  waterWireframe: boolean;
  waterDepthWrite: boolean;
}

export interface ProjectWeatherArchiveState {
  weatherMode: WeatherMode;
  weatherIntensity: number;
  weatherWindX: number;
  weatherWindZ: number;
}

interface VoxelProjectManifestBase {
  kind: "drusniel-clod-project";
  exportedAt: string;
  worldSize: number;
  config: ClodPagesConfig;
  state: ProjectSessionState;
  water: ProjectWaterArchiveState;
  weather: ProjectWeatherArchiveState;
  voxelTerrainEdits: VoxelEditSnapshot;
  props: readonly ProjectPropInstance[];
  textures: ProjectTextureSlot[];
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
}

export interface VoxelProjectManifestV3 extends VoxelProjectManifestBase {
  schemaVersion: typeof LEGACY_VOXEL_PROJECT_SCHEMA_VERSION;
}

export interface VoxelProjectManifestV4 extends VoxelProjectManifestBase {
  schemaVersion: typeof VOXEL_PROJECT_SCHEMA_VERSION;
  world: ProjectWorldIdentity;
}

export type VoxelProjectManifest = VoxelProjectManifestV3 | VoxelProjectManifestV4;
export type CurrentVoxelProjectManifest = VoxelProjectManifestV4;

export interface VoxelProjectArchiveContents {
  manifest: VoxelProjectManifest;
  customTextures: Map<string, Uint8Array>;
}
