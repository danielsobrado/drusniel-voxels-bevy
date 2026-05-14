import * as THREE from "three";
import type { AtlasMapping, BlockAtlasMap, BlockType, ChunkSummary, ViewportExposedVoxel, ViewportMeshBuffer, WorldSurfaceSample, WorldViewportPreview } from "../../types/world";

export const MATERIAL_COLORS: Record<string, string> = {
  Air: "#171923",
  TopSoil: "#4d8f4e",
  SubSoil: "#80613c",
  Rock: "#7f8792",
  Bedrock: "#4a4d55",
  Sand: "#d5bd82",
  Clay: "#b07f61",
  Water: "#2a8ecf",
  Wood: "#7a5132",
  Leaves: "#3f8b4d",
  DungeonWall: "#4f5363",
  DungeonFloor: "#585562",
};

export const ATLAS_IMAGE_URLS = ["/assets/textures/atlas.png", "http://127.0.0.1:17777/assets/textures/atlas.png"] as const;
export const ATLAS_COLUMNS = 8;
export const ATLAS_ROWS = 8;
export const ATLAS_TILE_COUNT = ATLAS_COLUMNS * ATLAS_ROWS;

const LEGACY_ATLAS_TILE_IDS: Readonly<Record<string, string>> = {
  "atlas/terrain_grass_top": "tile-3",
  "atlas/terrain_grass_side": "tile-7",
  "atlas/terrain_grass_side_alt": "tile-7",
  "atlas/terrain_dirt": "tile-0",
  "atlas/terrain_rock": "tile-1",
  "atlas/terrain_sand": "tile-4",
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sampleGridKey = (x: number, z: number) => `${x}:${z}`;

const fallbackSamplesFromChunks = (chunks: readonly ChunkSummary[]): readonly WorldSurfaceSample[] =>
  chunks.map((chunk) => {
    const [x, y, z] = chunk.coordinate;
    const material = chunk.waterMeshCount > 0 ? "Water" : chunk.blockCount > 2000 ? "Rock" : "TopSoil";
    return {
      x: x * 16 + 8,
      z: z * 16 + 8,
      height: y * 16 + clamp(Math.round(chunk.blockCount / 220), 2, 15),
      material,
      water: material === "Water",
    };
  });

export const collectSamples = (chunks: readonly ChunkSummary[], worldViewport: WorldViewportPreview | null): readonly WorldSurfaceSample[] => {
  const voxelSamples = samplesFromExposedVoxels(collectExposedVoxels(worldViewport));
  if (voxelSamples.length > 0) {
    return voxelSamples;
  }

  const samples = worldViewport?.chunks.flatMap((chunk) => [...chunk.samples]) ?? [];
  if (samples.length === 0) {
    return fallbackSamplesFromChunks(chunks);
  }

  const byColumn = new Map<string, WorldSurfaceSample>();
  for (const sample of samples) {
    if (sample.material === "Air" && !sample.water) {
      continue;
    }

    const key = sampleGridKey(sample.x, sample.z);
    const current = byColumn.get(key);
    if (!current || sample.height > current.height) {
      byColumn.set(key, sample);
    }
  }

  const mergedSamples = [...byColumn.values()];
  return mergedSamples.length > 0 ? mergedSamples : fallbackSamplesFromChunks(chunks);
};

export const collectExposedVoxels = (worldViewport: WorldViewportPreview | null): readonly ViewportExposedVoxel[] =>
  worldViewport?.chunks.flatMap((chunk) => [...(chunk.voxels ?? [])]) ?? [];

const samplesFromExposedVoxels = (voxels: readonly ViewportExposedVoxel[]): readonly WorldSurfaceSample[] => {
  const byColumn = new Map<string, WorldSurfaceSample>();
  for (const voxel of voxels) {
    if (!voxel.exposedFaces.includes("posY")) {
      continue;
    }

    const [x, y, z] = voxel.position;
    const sample: WorldSurfaceSample = {
      x,
      z,
      height: y + 1,
      material: voxel.material,
      water: voxel.water,
    };
    const key = sampleGridKey(x, z);
    const current = byColumn.get(key);
    if (!current || sample.height > current.height) {
      byColumn.set(key, sample);
    }
  }

  return [...byColumn.values()];
};

export const createViewportMeshGeometry = (mesh: ViewportMeshBuffer): THREE.BufferGeometry | null => {
  if (!mesh.positions || !mesh.indices || mesh.positions.length === 0 || mesh.indices.length < 3) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions.flat(), 3));

  if (mesh.normals?.length === mesh.positions.length) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals.flat(), 3));
  } else {
    geometry.computeVertexNormals();
  }

  if (mesh.uvs?.length === mesh.positions.length) {
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(mesh.uvs.flat(), 2));
  }

  if (mesh.colors?.length === mesh.positions.length) {
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(mesh.colors.flatMap(([red, green, blue]) => [red, green, blue]), 3));
  }

  geometry.setIndex([...mesh.indices]);
  geometry.computeBoundingSphere();
  return geometry;
};

export const blockForViewportMaterial = (material: WorldSurfaceSample["material"]): BlockType | null => {
  switch (material) {
    case "TopSoil":
      return "grass";
    case "SubSoil":
      return "dirt";
    case "Sand":
      return "sand";
    case "Rock":
    case "Bedrock":
    case "Clay":
    case "DungeonWall":
    case "DungeonFloor":
      return "rock";
    default:
      return null;
  }
};

const normalizeAtlasTileId = (tileId: string) => LEGACY_ATLAS_TILE_IDS[tileId] ?? tileId;

export const parseAtlasTileIndex = (tileId: string): number | null => {
  const match = /^tile-(\d+)$/.exec(normalizeAtlasTileId(tileId));
  if (!match) {
    return null;
  }

  const index = Number.parseInt(match[1], 10);
  return Number.isInteger(index) && index >= 0 && index < ATLAS_TILE_COUNT ? index : null;
};

export const atlasTileIndexForMaterial = (
  atlasMapping: BlockAtlasMap,
  material: WorldSurfaceSample["material"],
  face: keyof AtlasMapping = "top",
): number | null => {
  const block = blockForViewportMaterial(material);
  return block ? parseAtlasTileIndex(atlasMapping[block][face]) : null;
};

export const tileTextureForIndex = (atlasTexture: THREE.Texture, tileIndex: number) => {
  const texture = atlasTexture.clone();
  const column = tileIndex % ATLAS_COLUMNS;
  const row = Math.floor(tileIndex / ATLAS_COLUMNS);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(1 / ATLAS_COLUMNS, 1 / ATLAS_ROWS);
  texture.offset.set(column / ATLAS_COLUMNS, 1 - (row + 1) / ATLAS_ROWS);
  texture.needsUpdate = true;
  return texture;
};

export const sampleMaterialKey = (sample: WorldSurfaceSample, atlasMapping: BlockAtlasMap, atlasPreviewEnabled: boolean) => {
  if (sample.water) {
    return "Water";
  }

  const tileIndex = atlasPreviewEnabled ? atlasTileIndexForMaterial(atlasMapping, sample.material, "top") : null;
  return tileIndex === null ? sample.material : `${sample.material}:tile-${tileIndex}`;
};

export const exposedVoxelMaterialKey = (voxel: ViewportExposedVoxel, atlasMapping: BlockAtlasMap, atlasPreviewEnabled: boolean) => {
  if (voxel.water) {
    return "Water";
  }

  const tileIndex = atlasPreviewEnabled ? atlasTileIndexForMaterial(atlasMapping, voxel.material, "top") : null;
  return tileIndex === null ? voxel.material : `${voxel.material}:tile-${tileIndex}`;
};

export const exposedVoxelTransform = (voxel: ViewportExposedVoxel) => {
  const [x, y, z] = voxel.position;
  return {
    position: new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5),
    scale: new THREE.Vector3(1, 1, 1),
  };
};

export const sampleColumnTransform = (sample: WorldSurfaceSample, cellSize: number) => {
  const height = sample.water ? 0.16 : Math.max(0.5, sample.height);
  return {
    position: new THREE.Vector3(sample.x + cellSize * 0.5, sample.water ? sample.height + 0.04 : height * 0.5, sample.z + cellSize * 0.5),
    scale: new THREE.Vector3(cellSize, height, cellSize),
  };
};

export const viewportBoundsFromSamples = (samples: readonly WorldSurfaceSample[]) => {
  if (samples.length === 0) {
    return {
      center: new THREE.Vector3(32, 8, 32),
      radius: 64,
    };
  }

  const minX = Math.min(...samples.map((sample) => sample.x));
  const maxX = Math.max(...samples.map((sample) => sample.x));
  const minY = Math.min(...samples.map((sample) => sample.height));
  const maxY = Math.max(...samples.map((sample) => sample.height));
  const minZ = Math.min(...samples.map((sample) => sample.z));
  const maxZ = Math.max(...samples.map((sample) => sample.z));
  const center = new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  const radius = Math.max(16, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) * 0.55);
  return { center, radius };
};
