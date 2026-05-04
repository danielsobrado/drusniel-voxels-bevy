import type { BlockAtlasMap, ChunkSummary, MaterialAsset, PropInstance, ProtectedArea, VoxelBlock, WaterBody } from "../types/world";

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

export const mockProps: readonly PropInstance[] = Array.from({ length: 40 }, (_, index) => {
  const type = propTypes[index % propTypes.length];
  const ordinal = String(index + 1).padStart(2, "0");

  return {
    id: `prop-${type}-${ordinal}`,
    name: `${type[0].toUpperCase()}${type.slice(1)} ${ordinal}`,
    type,
    billboardMode: billboardModes[index % billboardModes.length],
    position: [(index % 8) * 18 + 8, 18 + (index % 3), Math.floor(index / 8) * 22 + 12],
    material: `mat-${type === "building" ? "building" : "grass-block"}`,
    transform: {
      position: [(index % 8) * 18 + 8, 18 + (index % 3), Math.floor(index / 8) * 22 + 12],
      rotation: [0, (index % 4) * 90, 0],
      scale: [1 + (index % 4) * 0.1, 1, 1 + (index % 4) * 0.1],
    },
    lodState: index % 4 === 3 ? "Culled" : index % 4 === 2 ? "Low" : index % 4 === 1 ? "Medium" : "High",
    collision: index % 5 !== 0,
    placementRules: {
      avoidWater: index % 2 === 0,
      maxSlope: (index % 4) * 8 + 12,
      minSeparation: 2.2 + (index % 5) * 0.35,
    },
    terrainConform: index % 3 !== 0,
    assetPath: `assets/props/mock/${type}_${ordinal}.ron`,
  };
});

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
