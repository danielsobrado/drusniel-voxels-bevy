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
  { id: "meadows-ground", name: "Meadows Ground", slotIndex: 8, source: "generated", materialId: "top-soil", tags: ["terrain", "biome", "meadows"] },
  { id: "forest-floor", name: "Forest Floor", slotIndex: 9, source: "generated", materialId: "top-soil", tags: ["terrain", "biome", "forest"] },
  { id: "swamp-muck", name: "Swamp Muck", slotIndex: 10, source: "generated", materialId: "clay", tags: ["terrain", "biome", "swamp"] },
  { id: "mountain-scree", name: "Mountain Scree", slotIndex: 11, source: "generated", materialId: "rock", tags: ["terrain", "biome", "mountain"] },
  { id: "plains-grass", name: "Plains Grass", slotIndex: 12, source: "generated", materialId: "top-soil", tags: ["terrain", "biome", "plains"] },
  { id: "coast-sand", name: "Coast Sand", slotIndex: 13, source: "generated", materialId: "sand", tags: ["terrain", "biome", "coast"] },
  { id: "ocean-floor", name: "Ocean Floor", slotIndex: 14, source: "generated", materialId: "sand", tags: ["terrain", "biome", "ocean"] },
];

function biome(
  id: string,
  name: string,
  biomeId: number,
  textureSlotSet: string[],
  defaultMaterialId: string,
  debugColorRgb: [number, number, number],
  canopyDensity: number,
): BiomeContent {
  const primarySlot = textureSlotSet[0] ?? "natural";
  const lowMaterial = primarySlot === "sand" ? "sand" : defaultMaterialId;
  const highSlot = textureSlotSet[2] ?? textureSlotSet[1] ?? primarySlot;
  const highMaterial = highSlot === "snow" ? "snow" : highSlot === "rock" ? "rock" : defaultMaterialId;
  return {
    id,
    name,
    biomeId,
    region: {
      kind: "spatial",
      biomeId,
      debugColorRgb,
      canopyDensity,
      terrainTextureSlots: textureSlotSet.length > 0 ? textureSlotSet : [primarySlot],
    },
    defaultMaterialId,
    waterMaterialId: "water",
    textureSlotSet: Array.from(new Set(textureSlotSet.length > 0 ? textureSlotSet : [primarySlot])),
    tags: ["islands", "spatial-region"],
    terrainBands: [
      { id: `${id}-low`, name: `${name} Low`, minHeight: -120, maxHeight: 24, materialId: lowMaterial, textureSlotId: primarySlot },
      { id: `${id}-mid`, name: `${name} Mid`, minHeight: 24, maxHeight: 64, materialId: defaultMaterialId, textureSlotId: textureSlotSet[1] ?? primarySlot },
      { id: `${id}-high`, name: `${name} High`, minHeight: 64, maxHeight: 132, materialId: highMaterial, textureSlotId: highSlot },
    ],
  };
}

export const DEFAULT_BIOMES: BiomeContent[] = [
  biome("meadows", "Meadows", 0, ["sand", "meadows-ground", "rock"], "top-soil", [77, 97, 54], 0.2),
  biome("forest", "Forest", 1, ["sand", "forest-floor", "rock"], "top-soil", [46, 79, 36], 1.0),
  biome("swamp", "Swamp", 2, ["dirt", "swamp-muck", "rock"], "clay", [48, 71, 51], 0.65),
  biome("mountain", "Mountain", 3, ["rock", "mountain-scree", "snow"], "rock", [107, 102, 92], 0.0),
  biome("plains", "Plains", 4, ["sand", "plains-grass", "rock"], "top-soil", [120, 110, 64], 0.05),
  biome("coast", "Coast", 5, ["sand", "coast-sand", "rock"], "sand", [163, 140, 87], 0.0),
  biome("ocean", "Ocean", 6, ["sand", "ocean-floor", "rock"], "sand", [26, 51, 77], 0.0),
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
