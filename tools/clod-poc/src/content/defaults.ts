import {
  MaterialContent,
  TextureSlotContent,
  BiomeContent,
  ClodDebugPreset,
  SnapPieceContent,
} from "./types.js";

export const DEFAULT_MATERIALS: MaterialContent[] = [
  { id: "air", name: "Air", kind: "system", colorRgb: [0, 0, 0], strength: 0.0, transparent: true },
  { id: "top-soil", name: "Top Soil", kind: "organic", colorRgb: [85, 128, 43], strength: 1.0, walkable: true, diggable: true, paintable: true },
  { id: "sub-soil", name: "Sub Soil", kind: "terrain", colorRgb: [120, 80, 50], strength: 1.2, walkable: true, diggable: true, paintable: true },
  { id: "rock", name: "Rock", kind: "rock", colorRgb: [128, 128, 128], strength: 5.0, walkable: true, diggable: true, paintable: true },
  { id: "bedrock", name: "Bedrock", kind: "rock", colorRgb: [64, 64, 64], strength: 100.0, walkable: true, diggable: false, paintable: false },
  { id: "sand", name: "Sand", kind: "terrain", colorRgb: [220, 200, 140], strength: 0.8, walkable: true, diggable: true, paintable: true },
  { id: "clay", name: "Clay", kind: "terrain", colorRgb: [180, 110, 80], strength: 1.5, walkable: true, diggable: true, paintable: true },
  { id: "water", name: "Water", kind: "water", colorRgb: [0, 100, 200], strength: 0.1, walkable: true, diggable: false, paintable: false, transparent: true },
  { id: "snow", name: "Snow", kind: "organic", colorRgb: [240, 240, 250], strength: 0.5, walkable: true, diggable: true, paintable: true },
  { id: "lava", name: "Lava", kind: "terrain", colorRgb: [255, 60, 0], strength: 10.0, walkable: false, diggable: false, paintable: false },
  { id: "debug-error", name: "Debug Error", kind: "debug", colorRgb: [255, 0, 255], strength: 0.0 },
  { id: "debug-locked-border", name: "Debug Locked Border", kind: "debug", colorRgb: [255, 255, 0], strength: 0.0 },
];

export const DEFAULT_TEXTURE_SLOTS: TextureSlotContent[] = [
  { id: "natural", name: "Natural", slotIndex: 0, source: "builtin", tags: ["terrain"] },
  { id: "grass-top", name: "Grass Top", slotIndex: 1, source: "builtin", materialId: "top-soil", tags: ["organic"] },
  { id: "dirt", name: "Dirt", slotIndex: 2, source: "builtin", materialId: "sub-soil", tags: ["terrain"] },
  { id: "rock", name: "Rock", slotIndex: 3, source: "builtin", materialId: "rock", tags: ["rock"] },
  { id: "sand", name: "Sand", slotIndex: 4, source: "builtin", materialId: "sand", tags: ["terrain"] },
  { id: "water", name: "Water", slotIndex: 5, source: "builtin", materialId: "water", tags: ["water"] },
  { id: "snow", name: "Snow", slotIndex: 6, source: "builtin", materialId: "snow", tags: ["organic"] },
  { id: "lava", name: "Lava", slotIndex: 7, source: "builtin", materialId: "lava", tags: ["terrain"] },
];

export const DEFAULT_BIOMES: BiomeContent[] = [
  {
    id: "test-plain",
    name: "Test Plain",
    defaultMaterialId: "top-soil",
    waterMaterialId: "water",
    tags: ["plain"],
    terrainBands: [
      { id: "plain-low", name: "Plain Low", minHeight: -50, maxHeight: 10, materialId: "sand", textureSlotId: "sand" },
      { id: "plain-mid", name: "Plain Mid", minHeight: 10, maxHeight: 100, materialId: "top-soil", textureSlotId: "grass-top" },
    ],
  },
  {
    id: "rocky-hills",
    name: "Rocky Hills",
    defaultMaterialId: "sub-soil",
    waterMaterialId: "water",
    tags: ["hills"],
    terrainBands: [
      { id: "hills-low", name: "Hills Low", minHeight: -50, maxHeight: 30, materialId: "sub-soil", textureSlotId: "dirt" },
      { id: "hills-high", name: "Hills High", minHeight: 30, maxHeight: 200, materialId: "rock", textureSlotId: "rock" },
    ],
  },
  {
    id: "lake-basin",
    name: "Lake Basin",
    defaultMaterialId: "clay",
    waterMaterialId: "water",
    tags: ["basin"],
    terrainBands: [
      { id: "basin-floor", name: "Basin Floor", minHeight: -100, maxHeight: -10, materialId: "clay", textureSlotId: "dirt" },
      { id: "basin-shore", name: "Basin Shore", minHeight: -10, maxHeight: 5, materialId: "sand", textureSlotId: "sand" },
      { id: "basin-bank", name: "Basin Bank", minHeight: 5, maxHeight: 50, materialId: "top-soil", textureSlotId: "grass-top" },
    ],
  },
  {
    id: "snow-peak",
    name: "Snow Peak",
    defaultMaterialId: "rock",
    waterMaterialId: "water",
    tags: ["mountain"],
    terrainBands: [
      { id: "peak-lower", name: "Peak Lower", minHeight: 0, maxHeight: 80, materialId: "rock", textureSlotId: "rock" },
      { id: "peak-upper", name: "Peak Upper", minHeight: 80, maxHeight: 500, materialId: "snow", textureSlotId: "snow" },
    ],
  },
];

export const DEFAULT_CLOD_DEBUG_PRESETS: ClodDebugPreset[] = [
  { id: "default", name: "Default View", showWireframe: false, showPageBoundaries: false, showLockedBorders: false, showNodeLabels: false, colorByLod: false, errorPx: 2.0 },
  { id: "seam-debug", name: "Seam Debug", showWireframe: true, showPageBoundaries: true, showLockedBorders: false, showNodeLabels: true, colorByLod: false, errorPx: 1.5 },
  { id: "locked-border-debug", name: "Locked Border Debug", showWireframe: true, showPageBoundaries: false, showLockedBorders: true, showNodeLabels: false, colorByLod: false, errorPx: 2.0 },
  { id: "performance", name: "Performance View", showWireframe: false, showPageBoundaries: false, showLockedBorders: false, showNodeLabels: false, colorByLod: true, errorPx: 4.0 },
  { id: "validation", name: "Validation View", showWireframe: true, showPageBoundaries: true, showLockedBorders: true, showNodeLabels: true, colorByLod: true, errorPx: 1.0 },
];

export const DEFAULT_SNAP_PIECES: SnapPieceContent[] = [
  {
    id: "wood-floor",
    name: "Wood Floor",
    category: "floor",
    dimensions: [4, 0.2, 4],
    canGround: true,
    materialId: "top-soil",
    snapPoints: [
      { id: "north", localOffset: [0, 0, -2], direction: [0, 0, -1], group: "floor-edge", compatibleGroups: ["floor-edge"] },
      { id: "south", localOffset: [0, 0, 2], direction: [0, 0, 1], group: "floor-edge", compatibleGroups: ["floor-edge"] },
      { id: "east", localOffset: [2, 0, 0], direction: [1, 0, 0], group: "floor-edge", compatibleGroups: ["floor-edge"] },
      { id: "west", localOffset: [-2, 0, 0], direction: [-1, 0, 0], group: "floor-edge", compatibleGroups: ["floor-edge"] },
    ],
  },
  {
    id: "wood-wall",
    name: "Wood Wall",
    category: "wall",
    dimensions: [4, 3, 0.2],
    canGround: false,
    materialId: "sub-soil",
    snapPoints: [
      { id: "bottom", localOffset: [0, -1.5, 0], direction: [0, -1, 0], group: "wall-bottom", compatibleGroups: ["floor-edge"] },
      { id: "top", localOffset: [0, 1.5, 0], direction: [0, 1, 0], group: "wall-top", compatibleGroups: ["wall-bottom"] },
    ],
  },
  {
    id: "stone-floor",
    name: "Stone Floor",
    category: "floor",
    dimensions: [4, 0.4, 4],
    canGround: true,
    materialId: "rock",
    snapPoints: [
      { id: "north", localOffset: [0, 0, -2], direction: [0, 0, -1], group: "floor-edge", compatibleGroups: ["floor-edge"] },
      { id: "south", localOffset: [0, 0, 2], direction: [0, 0, 1], group: "floor-edge", compatibleGroups: ["floor-edge"] },
    ],
  },
  {
    id: "stone-wall",
    name: "Stone Wall",
    category: "wall",
    dimensions: [4, 4, 0.4],
    canGround: true,
    materialId: "rock",
    snapPoints: [
      { id: "bottom", localOffset: [0, -2, 0], direction: [0, -1, 0], group: "wall-bottom", compatibleGroups: ["floor-edge"] },
    ],
  },
  {
    id: "debug-column",
    name: "Debug Column",
    category: "pillar",
    dimensions: [0.5, 4, 0.5],
    canGround: true,
    snapPoints: [
      { id: "center-bottom", localOffset: [0, -2, 0], direction: [0, -1, 0], group: "generic", compatibleGroups: ["generic"] },
    ],
  },
];
