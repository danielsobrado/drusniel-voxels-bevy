import type {
  BlockAtlasMap,
  ChunkSummary,
  LightInstance,
  MaterialAsset,
  PropAsset,
  PropInstance,
  PropType,
  ProtectedArea,
  VoxelBlock,
  WaterBody,
} from "../types/world";

const createBounds = (center: [number, number, number], size: [number, number, number]): { readonly min: [number, number, number]; readonly max: [number, number, number] } => {
  const [x, y, z] = center;
  const [sx, sy, sz] = size;
  return {
    min: [x - sx / 2, y - sy / 2, z - sz / 2],
    max: [x + sx / 2, y + sy / 2, z + sz / 2],
  };
};

export const mockVoxelBlocks: readonly VoxelBlock[] = [
  { id: "grass", displayName: "Grass", solid: true, defaultMaterialId: "mat-grass-block" },
  { id: "dirt", displayName: "Dirt", solid: true, defaultMaterialId: "mat-dirt-block" },
  { id: "rock", displayName: "Rock", solid: true, defaultMaterialId: "mat-rock-block" },
  { id: "sand", displayName: "Sand", solid: true, defaultMaterialId: "mat-sand-block" },
];

export const mockChunks: readonly ChunkSummary[] = Array.from({ length: 12 }, (_, index) => {
  const x = index % 4;
  const z = Math.floor(index / 4);
  const id = `chunk-${x}-${z}`;

  return {
    id,
    label: `Chunk ${x},${z}`,
    coordinate: [x, 0, z],
    blockCount: 28600 + index * 317,
    dirty: ["chunk-0-0", "chunk-2-1", "chunk-3-2"].includes(id),
    biome: z === 0 ? "coastal grassland" : z === 1 ? "birch rise" : "rock shelf",
    meshStatus: index % 5 === 0 ? "queued" : ["chunk-0-0", "chunk-2-1", "chunk-3-2"].includes(id) ? "dirty" : "clean",
    meshMode: index % 3 === 0 ? "Greedy" : index % 3 === 1 ? "Mesher" : "LOD",
    vertexCount: 4200 + index * 143,
    triangleCount: 2800 + index * 113,
    waterMeshCount: index % 4 === 0 ? 8 : 5,
    lodGroup: index % 3,
  };
});

export const mockProtectedAreas: readonly ProtectedArea[] = [
  {
    id: "area-spawn-keep",
    name: "Spawn Keep",
    kind: "spawn",
    shape: "box",
    center: [32, 18, 32],
    size: [48, 32, 48],
    priority: 100,
    locked: false,
    color: "#22c55e",
    bounds: createBounds([32, 18, 32], [48, 32, 48]),
    rules: { canMine: false, canPlace: false, canPaint: false, canSpawnProps: false, canEditWater: false, canSaveModify: false },
  },
  {
    id: "area-north-village",
    name: "North Village",
    kind: "no_build",
    shape: "cylinder",
    center: [118, 20, 62],
    size: [36, 24, 36],
    priority: 68,
    locked: true,
    color: "#f59e0b",
    bounds: createBounds([118, 20, 62], [36, 24, 36]),
    rules: { canMine: true, canPlace: false, canPaint: true, canSpawnProps: true, canEditWater: true, canSaveModify: true },
  },
  {
    id: "area-story-grove",
    name: "Story Grove",
    kind: "no_dig",
    shape: "box",
    center: [74, 22, 146],
    size: [54, 30, 54],
    priority: 40,
    locked: false,
    color: "#0ea5e9",
    bounds: createBounds([74, 22, 146], [54, 30, 54]),
    rules: { canMine: false, canPlace: true, canPaint: true, canSpawnProps: false, canEditWater: true, canSaveModify: false },
  },
];

export const mockWaterBodies: readonly WaterBody[] = [
  {
    id: "water-western-ocean",
    name: "Western Ocean",
    kind: "Ocean",
    bodyType: "deep_ocean",
    center: [-42, 12, 68],
    surfaceY: 12,
    waveAmplitude: 0.82,
    waveSpeed: 0.7,
    waveScale: 1.15,
    waveCount: 6,
    reflectionStrength: 0.88,
    fresnelPower: 3,
    distortionStrength: 0.18,
    shallowColor: "#3b82f6",
    deepColor: "#0f172a",
    clarity: 0.86,
    murkiness: 0.11,
    foamEnabled: true,
    shoreFoam: 0.8,
    waveCrestFoam: 0.4,
    baseAlpha: 0.92,
    detailNormalIntensity: 0.78,
    detailScrollSpeed: 0.36,
    reflectionStatus: {
      active: true,
      sampleReflection: true,
      reason: "active",
      resolutionScale: 0.52,
      effectiveHz: 60,
      enabled: true,
      debugViewMode: "Off",
      probeValid: true,
      lastProbeUpdateMs: 13.4,
    },
  },
  {
    id: "water-lk-03",
    name: "LK_03",
    kind: "Lake",
    bodyType: "calm_lake",
    center: [92, 18, 108],
    surfaceY: 18,
    waveAmplitude: 0.34,
    waveSpeed: 0.55,
    waveScale: 0.91,
    waveCount: 4,
    reflectionStrength: 0.94,
    fresnelPower: 2.2,
    distortionStrength: 0.07,
    shallowColor: "#6ee7b7",
    deepColor: "#0f766e",
    clarity: 0.96,
    murkiness: 0.05,
    foamEnabled: false,
    shoreFoam: 0.3,
    waveCrestFoam: 0.12,
    baseAlpha: 0.92,
    detailNormalIntensity: 0.58,
    detailScrollSpeed: 0.33,
    reflectionStatus: {
      active: true,
      sampleReflection: true,
      reason: "active",
      resolutionScale: 0.5,
      effectiveHz: 60,
      enabled: true,
      debugViewMode: "Mask",
      probeValid: true,
      lastProbeUpdateMs: 18.9,
    },
  },
  {
    id: "water-south-river",
    name: "South River",
    kind: "River",
    bodyType: "fast_current",
    center: [62, 15, 172],
    surfaceY: 15,
    waveAmplitude: 0.51,
    waveSpeed: 0.91,
    waveScale: 1.1,
    waveCount: 8,
    reflectionStrength: 0.72,
    fresnelPower: 4.3,
    distortionStrength: 0.12,
    shallowColor: "#60a5fa",
    deepColor: "#1d4ed8",
    clarity: 0.74,
    murkiness: 0.2,
    foamEnabled: true,
    shoreFoam: 0.64,
    waveCrestFoam: 0.52,
    baseAlpha: 0.86,
    detailNormalIntensity: 0.66,
    detailScrollSpeed: 0.2,
    reflectionStatus: {
      active: false,
      sampleReflection: false,
      reason: "disabled",
      resolutionScale: 0.4,
      effectiveHz: 30,
      enabled: true,
      debugViewMode: "BlendFactor",
      probeValid: false,
      lastProbeUpdateMs: 42.6,
    },
  },
  {
    id: "water-mill-pond",
    name: "Mill Pond",
    kind: "Pond",
    bodyType: "slow_eddy",
    center: [138, 16, 74],
    surfaceY: 16,
    waveAmplitude: 0.22,
    waveSpeed: 0.32,
    waveScale: 0.88,
    waveCount: 2,
    reflectionStrength: 0.68,
    fresnelPower: 2.8,
    distortionStrength: 0.04,
    shallowColor: "#93c5fd",
    deepColor: "#1e3a8a",
    clarity: 0.8,
    murkiness: 0.26,
    foamEnabled: false,
    shoreFoam: 0.24,
    waveCrestFoam: 0.2,
    baseAlpha: 0.74,
    detailNormalIntensity: 0.4,
    detailScrollSpeed: 0.1,
    reflectionStatus: {
      active: false,
      sampleReflection: false,
      reason: "disabled",
      resolutionScale: 0.35,
      effectiveHz: 0,
      enabled: false,
      debugViewMode: "Off",
      probeValid: false,
      lastProbeUpdateMs: 0,
    },
  },
];

const propTypes = ["tree", "rock", "bush", "flower", "building"] as const;
const billboardModes = ["SingleAxial", "Directional4", "Directional8"] as const;
const propBrushAssetSeeds = ["tree", "rock", "bush", "flower", "building"] as const;

export const mockPropAssets: readonly PropAsset[] = [
  { id: "asset-tree-01", name: "Oak Tree", type: "tree", category: "tree", assetPath: "assets/props/tree_oak.ron", defaultMaterial: "mat-grass-block" },
  { id: "asset-tree-02", name: "Pine Tree", type: "tree", category: "tree", assetPath: "assets/props/tree_pine.ron", defaultMaterial: "mat-grass-block" },
  { id: "asset-tree-03", name: "Willow Tree", type: "tree", category: "tree", assetPath: "assets/props/tree_willow.ron", defaultMaterial: "mat-grass-block" },
  { id: "asset-rock-01", name: "Rock Pillar", type: "rock", category: "rock", assetPath: "assets/props/rock_pillar.ron", defaultMaterial: "mat-rock-block" },
  { id: "asset-rock-02", name: "Granite Boulder", type: "rock", category: "rock", assetPath: "assets/props/rock_boulder.ron", defaultMaterial: "mat-rock-block" },
  { id: "asset-bush-01", name: "Berry Bush", type: "bush", category: "bush", assetPath: "assets/props/bush_berry.ron", defaultMaterial: "mat-grass-block" },
  { id: "asset-bush-02", name: "Needle Bush", type: "bush", category: "bush", assetPath: "assets/props/bush_needle.ron", defaultMaterial: "mat-grass-block" },
  { id: "asset-flower-01", name: "Wild Flower", type: "flower", category: "flower", assetPath: "assets/props/flower_wild.ron", defaultMaterial: "mat-grass-block" },
  { id: "asset-flower-02", name: "Blue Flower", type: "flower", category: "flower", assetPath: "assets/props/flower_blue.ron", defaultMaterial: "mat-grass-block" },
  { id: "asset-building-01", name: "Village House", type: "building", category: "building", assetPath: "assets/props/building_house.ron", defaultMaterial: "mat-building" },
  { id: "asset-building-02", name: "Lookout Tower", type: "building", category: "building", assetPath: "assets/props/tower_watch.ron", defaultMaterial: "mat-building" },
];

const buildPlacementRules = (index: number, type: PropType) => {
  const randomSeed = index * 173 + (type === "tree" ? 19 : type === "rock" ? 41 : type === "bush" ? 53 : type === "flower" ? 67 : 79);

  return {
    avoidWater: index % 2 === 0,
    maxSlope: 16 + (index % 5) * 6,
    minSeparation: 2 + (index % 7) * 0.3,
    randomRotation: index % 2 === 0,
    scaleJitter: 0.1 + (index % 5) * 0.05,
    alignToNormal: index % 3 === 0,
    terrainConform: index % 3 !== 0,
    avoidProtectedAreas: index % 4 === 0,
    collisionCheck: index % 3 !== 2,
    seed: randomSeed,
  };
};

const resolvePropAsset = (index: number): PropAsset => {
  const indexByType = index % propBrushAssetSeeds.length;
  const chosenType = propBrushAssetSeeds[indexByType];
  const typeAssets = mockPropAssets.filter((asset) => asset.type === chosenType);
  return typeAssets[index % typeAssets.length];
};

export const mockProps: readonly PropInstance[] = Array.from({ length: 40 }, (_, index) => {
  const type = propTypes[index % propTypes.length];
  const ordinal = String(index + 1).padStart(2, "0");
  const chunkIndex = index % mockChunks.length;
  const sourceAsset = resolvePropAsset(index);

  return {
    id: `prop-${type}-${ordinal}`,
    name: `${type[0].toUpperCase()}${type.slice(1)} ${ordinal}`,
    type,
    billboardMode: billboardModes[index % billboardModes.length],
    billboardEnabled: index % 2 === 0,
    billboardSwitchDistance: 10 + (index % 8) * 2.5,
    currentLod: (index % 4 === 0 ? "High" : index % 4 === 1 ? "Medium" : index % 4 === 2 ? "Low" : "Culled") as PropInstance["lodState"],
    visible: index % 6 !== 0,
    shadowCast: index % 3 !== 0,
    boundsWarning: index % 8 === 0,
    generatedAssetAvailable: index % 9 !== 0,
    chunkId: mockChunks[chunkIndex].id,
    position: [(index % 8) * 18 + 8, 18 + (index % 3), Math.floor(index / 8) * 22 + 12],
    material: sourceAsset.defaultMaterial,
    transform: {
      position: [(index % 8) * 18 + 8, 18 + (index % 3), Math.floor(index / 8) * 22 + 12],
      rotation: [0, (index % 4) * 90, 0],
      scale: [1 + (index % 4) * 0.1, 1, 1 + (index % 4) * 0.1],
    },
    assetPath: sourceAsset.assetPath,
    lodState: index % 4 === 3 ? "Culled" : index % 4 === 2 ? "Low" : index % 4 === 1 ? "Medium" : "High",
    collision: index % 5 !== 0,
    placementRules: buildPlacementRules(index, type),
  };
});

export const mockLights: readonly LightInstance[] = [
  {
    id: "sun",
    name: "Sun",
    kind: "directional",
    enabled: true,
    visible: true,
    locked: true,
    position: [0, 80, 0],
    rotation: [-45, -35, 0],
    color: "#fff8f0",
    intensity: 5000,
    range: 0,
    radius: 0,
    innerConeAngle: 0,
    outerConeAngle: 0,
    shadowsEnabled: true,
    volumetric: true,
    source: "sun",
  },
  {
    id: "light-point-01",
    name: "Point Light 01",
    kind: "point",
    enabled: true,
    visible: true,
    locked: false,
    position: [74, 31, 88],
    rotation: [0, 0, 0],
    color: "#ffd6a3",
    intensity: 900,
    range: 24,
    radius: 0.4,
    innerConeAngle: 25,
    outerConeAngle: 45,
    shadowsEnabled: true,
    volumetric: false,
    source: "editor",
  },
];

export const mockMaterials: readonly MaterialAsset[] = [
  { id: "mat-grass-block", name: "Grass Block", kind: "blocky", sourcePath: "assets/textures/blocks/grass.png" },
  { id: "mat-dirt-block", name: "Dirt Block", kind: "blocky", sourcePath: "assets/textures/blocks/dirt.png" },
  { id: "mat-rock-block", name: "Rock Block", kind: "triplanar", sourcePath: "assets/textures/blocks/rock.png" },
  { id: "mat-sand-block", name: "Sand Block", kind: "blocky", sourcePath: "assets/textures/blocks/sand.png" },
  { id: "mat-village-building", name: "Village Building", kind: "building", sourcePath: "assets/materials/building.ron" },
  { id: "mat-billboard-props", name: "Billboard Props", kind: "props", sourcePath: "assets/textures/billboards/generated" },
  { id: "mat-water-surface", name: "Water Surface", kind: "water", sourcePath: "assets/materials/water.ron" },
];

export const mockAtlasMapping: BlockAtlasMap = {
  grass: { top: "atlas/terrain_grass_top", side: "atlas/terrain_grass_side", bottom: "atlas/terrain_dirt" },
  dirt: { top: "atlas/terrain_dirt", side: "atlas/terrain_dirt", bottom: "atlas/terrain_dirt" },
  rock: { top: "atlas/terrain_rock", side: "atlas/terrain_rock", bottom: "atlas/terrain_rock" },
  sand: { top: "atlas/terrain_sand", side: "atlas/terrain_sand", bottom: "atlas/terrain_sand" },
};
