export type ContentId = string;

export interface MaterialContent {
  id: string;
  name: string;
  kind: "terrain" | "water" | "organic" | "rock" | "debug" | "system";
  colorRgb: [number, number, number];
  defaultTextureSlotId?: string;
  strength?: number;
  walkable?: boolean;
  diggable?: boolean;
  paintable?: boolean;
  transparent?: boolean;
  notes?: string;
  allowTransparentDigging?: boolean;
}

export interface TextureSlotContent {
  id: string;
  name: string;
  slotIndex: number;
  source: "builtin" | "user" | "generated";
  materialId?: string;
  tags: string[];
  alias?: boolean;
}

export interface TerrainBandContent {
  id: string;
  name: string;
  minHeight: number;
  maxHeight: number;
  materialId: string;
  textureSlotId: string;
}

export interface BiomeContent {
  id: string;
  name: string;
  terrainBands: TerrainBandContent[];
  defaultMaterialId: string;
  waterMaterialId?: string;
  tags: string[];
}

export interface ClodDebugPreset {
  id: string;
  name: string;
  showWireframe: boolean;
  showPageBoundaries: boolean;
  showLockedBorders: boolean;
  showNodeLabels: boolean;
  colorByLod: boolean;
  errorPx: number;
}

export interface SnapPointContent {
  id: string;
  localOffset: [number, number, number];
  direction: [number, number, number];
  group: "floor-edge" | "wall-bottom" | "wall-top" | "wall-side" | "roof-edge" | "generic";
  compatibleGroups: string[];
}

export interface SnapPieceContent {
  id: string;
  name: string;
  category: "foundation" | "wall" | "floor" | "roof" | "stair" | "door" | "window" | "pillar" | "beam" | "prop";
  dimensions: [number, number, number];
  snapPoints: SnapPointContent[];
  materialId?: string;
  meshPath?: string;
  canGround: boolean;
}

export interface ContentValidationIssue {
  severity: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface ContentValidationReport {
  ok: boolean;
  errors: ContentValidationIssue[];
  warnings: ContentValidationIssue[];
}

export interface ContentRegistry {
  materials: Map<string, MaterialContent>;
  textureSlots: Map<string, TextureSlotContent>;
  biomes: Map<string, BiomeContent>;
  clodDebugPresets: Map<string, ClodDebugPreset>;
  snapPieces: Map<string, SnapPieceContent>;
  _errors?: ContentValidationIssue[];
}
