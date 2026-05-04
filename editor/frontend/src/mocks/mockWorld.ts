import type { BlockAtlasMap, ChunkSummary, MaterialAsset, PropInstance, ProtectedArea, VoxelBlock, WaterBody } from "../types/world";

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
    rules: { allowVoxelEdit: false, allowPropEdit: false, allowWaterEdit: false, allowMaterialEdit: false, agentRequiresApproval: true },
  },
  {
    id: "area-north-village",
    name: "North Village",
    kind: "settlement",
    shape: "cylinder",
    center: [118, 20, 62],
    size: [36, 24, 36],
    rules: { allowVoxelEdit: false, allowPropEdit: true, allowWaterEdit: false, allowMaterialEdit: true, agentRequiresApproval: true },
  },
  {
    id: "area-story-grove",
    name: "Story Grove",
    kind: "story",
    shape: "box",
    center: [74, 22, 146],
    size: [54, 30, 54],
    rules: { allowVoxelEdit: false, allowPropEdit: false, allowWaterEdit: true, allowMaterialEdit: false, agentRequiresApproval: true },
  },
];

export const mockWaterBodies: readonly WaterBody[] = [
  { id: "water-western-ocean", name: "Western Ocean", kind: "Ocean", center: [-42, 12, 68], surfaceY: 12, reflectionStatus: { enabled: true, debugViewMode: "Off", probeValid: true, lastProbeUpdateMs: 13.4 } },
  { id: "water-mirror-lake", name: "Mirror Lake", kind: "Lake", center: [92, 18, 108], surfaceY: 18, reflectionStatus: { enabled: true, debugViewMode: "Mask", probeValid: true, lastProbeUpdateMs: 18.9 } },
  { id: "water-south-river", name: "South River", kind: "River", center: [62, 15, 172], surfaceY: 15, reflectionStatus: { enabled: true, debugViewMode: "BlendFactor", probeValid: false, lastProbeUpdateMs: 42.6 } },
  { id: "water-mill-pond", name: "Mill Pond", kind: "Pond", center: [138, 16, 74], surfaceY: 16, reflectionStatus: { enabled: false, debugViewMode: "Off", probeValid: false, lastProbeUpdateMs: 0 } },
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
