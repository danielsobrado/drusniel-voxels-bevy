import { BIOME_IDS, type BiomeId } from "../world_source/biome_region_field.js";
import {
  BIOME_PROCEDURAL_MATERIAL_IDS,
  type BiomeProceduralMaterialId,
  type ProceduralTextureConfig,
  withActiveBiomeProceduralMaterials,
} from "./materialRecipes.js";

export interface BiomeTextureStreamingUpdateInput {
  x: number;
  z: number;
  frameIndex?: number;
}

export interface BiomeTextureStreamingUpdateResult {
  changed: boolean;
  currentBiomeId: BiomeId;
  adjacentBiomeId: BiomeId;
  activeBiomeMaterials: BiomeProceduralMaterialId[];
}

export interface BiomeTextureStreamingStats {
  currentBiomeId: BiomeId | null;
  adjacentBiomeId: BiomeId | null;
  activeBiomeMaterials: BiomeProceduralMaterialId[];
  textureWindowSwaps: number;
  fallbackBiomeTextureCount: number;
  lastRebuildMs: number;
  lastUpdateFrame: number;
  lastError: string | null;
}

export interface BiomeTextureStreamingManager {
  update(input: BiomeTextureStreamingUpdateInput): BiomeTextureStreamingUpdateResult;
  forceActiveBiomes(biomeIds: readonly number[]): BiomeTextureStreamingUpdateResult;
  currentConfig(): ProceduralTextureConfig;
  stats(): BiomeTextureStreamingStats;
}

export interface BiomeTextureStreamingManagerDeps {
  baseConfig: ProceduralTextureConfig;
  sampleBiome: (x: number, z: number) => number;
  onActiveWindowChanged: (
    nextConfig: ProceduralTextureConfig,
    activeBiomeMaterials: readonly BiomeProceduralMaterialId[],
  ) => void;
  probeDistanceM?: number;
  minMoveDistanceM?: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

const BIOME_TEXTURE_MATERIAL_BY_ID: Record<BiomeId, BiomeProceduralMaterialId> = {
  [BIOME_IDS.meadows]: "meadows-ground",
  [BIOME_IDS.forest]: "forest-floor",
  [BIOME_IDS.swamp]: "swamp-muck",
  [BIOME_IDS.mountain]: "mountain-scree",
  [BIOME_IDS.plains]: "plains-grass",
  [BIOME_IDS.coast]: "coast-sand",
  [BIOME_IDS.ocean]: "ocean-floor",
};

const DEFAULT_PROBE_DISTANCE_M = 96;
const DEFAULT_MIN_MOVE_DISTANCE_M = 8;

export function biomeTextureMaterialForBiomeId(biomeId: number): BiomeProceduralMaterialId {
  const rounded = Math.max(0, Math.round(biomeId)) as BiomeId;
  return BIOME_TEXTURE_MATERIAL_BY_ID[rounded] ?? "meadows-ground";
}

export function createBiomeTextureStreamingManager(
  deps: BiomeTextureStreamingManagerDeps,
): BiomeTextureStreamingManager {
  const logger = deps.logger ?? console;
  const probeDistanceM = Math.max(1, deps.probeDistanceM ?? DEFAULT_PROBE_DISTANCE_M);
  const minMoveDistanceM = Math.max(0, deps.minMoveDistanceM ?? DEFAULT_MIN_MOVE_DISTANCE_M);
  let config = deps.baseConfig;
  let lastX: number | null = null;
  let lastZ: number | null = null;
  let activeSignature = "";
  const statsState: BiomeTextureStreamingStats = {
    currentBiomeId: null,
    adjacentBiomeId: null,
    activeBiomeMaterials: [...config.terrain.active_biome_materials],
    textureWindowSwaps: 0,
    fallbackBiomeTextureCount: Math.max(0, BIOME_PROCEDURAL_MATERIAL_IDS.length - config.terrain.active_biome_materials.length),
    lastRebuildMs: 0,
    lastUpdateFrame: -1,
    lastError: null,
  };

  const sampleBiomeId = (x: number, z: number): BiomeId => {
    const id = Math.max(0, Math.round(deps.sampleBiome(x, z))) as BiomeId;
    return BIOME_TEXTURE_MATERIAL_BY_ID[id] ? id : BIOME_IDS.meadows;
  };

  const resolveAdjacentBiome = (x: number, z: number, current: BiomeId): BiomeId => {
    if (lastX !== null && lastZ !== null) {
      const dx = x - lastX;
      const dz = z - lastZ;
      const len = Math.hypot(dx, dz);
      if (len >= minMoveDistanceM) {
        return sampleBiomeId(x + (dx / len) * probeDistanceM, z + (dz / len) * probeDistanceM);
      }
    }

    const candidates = [
      sampleBiomeId(x + probeDistanceM, z),
      sampleBiomeId(x - probeDistanceM, z),
      sampleBiomeId(x, z + probeDistanceM),
      sampleBiomeId(x, z - probeDistanceM),
    ];
    return candidates.find((id) => id !== current) ?? current;
  };

  const applyBiomeIds = (
    biomeIds: readonly number[],
    frameIndex: number,
  ): BiomeTextureStreamingUpdateResult => {
    const currentBiomeId = sampleBiomeId(0, 0);
    const validBiomeIds = biomeIds.map((id) => sampleBiomeId(id, 0));
    const activeBiomeMaterials = dedupe(validBiomeIds.map(biomeTextureMaterialForBiomeId)).slice(0, 2);
    const adjacentBiomeId = validBiomeIds[1] ?? validBiomeIds[0] ?? currentBiomeId;
    const result = applyActiveMaterials(currentBiomeId, adjacentBiomeId, activeBiomeMaterials, frameIndex);
    return result;
  };

  const applyActiveMaterials = (
    currentBiomeId: BiomeId,
    adjacentBiomeId: BiomeId,
    activeBiomeMaterials: readonly BiomeProceduralMaterialId[],
    frameIndex: number,
  ): BiomeTextureStreamingUpdateResult => {
    const nextActive = activeBiomeMaterials.length > 0
      ? [...activeBiomeMaterials]
      : [biomeTextureMaterialForBiomeId(currentBiomeId)];
    const signature = nextActive.join("|");
    const changed = signature !== activeSignature;

    statsState.currentBiomeId = currentBiomeId;
    statsState.adjacentBiomeId = adjacentBiomeId;
    statsState.lastUpdateFrame = frameIndex;

    if (!changed) {
      return { changed: false, currentBiomeId, adjacentBiomeId, activeBiomeMaterials: [...statsState.activeBiomeMaterials] };
    }

    const nextConfig = withActiveBiomeProceduralMaterials(config, nextActive);
    const start = performance.now();
    try {
      deps.onActiveWindowChanged(nextConfig, nextConfig.terrain.active_biome_materials);
      config = nextConfig;
      activeSignature = signature;
      statsState.textureWindowSwaps++;
      statsState.activeBiomeMaterials = [...nextConfig.terrain.active_biome_materials];
      statsState.fallbackBiomeTextureCount = Math.max(0, BIOME_PROCEDURAL_MATERIAL_IDS.length - statsState.activeBiomeMaterials.length);
      statsState.lastRebuildMs = performance.now() - start;
      statsState.lastError = null;
      logger.info?.(`[texture-streaming] terrain biome window ${statsState.activeBiomeMaterials.join(", ")}`);
    } catch (error) {
      statsState.lastError = error instanceof Error ? error.message : String(error);
      logger.error?.("[texture-streaming] failed to rebuild terrain biome texture window", error);
    }

    return { changed: true, currentBiomeId, adjacentBiomeId, activeBiomeMaterials: [...statsState.activeBiomeMaterials] };
  };

  return {
    update(input) {
      const frameIndex = input.frameIndex ?? statsState.lastUpdateFrame + 1;
      const currentBiomeId = sampleBiomeId(input.x, input.z);
      const adjacentBiomeId = resolveAdjacentBiome(input.x, input.z, currentBiomeId);
      const activeBiomeMaterials = dedupe([
        biomeTextureMaterialForBiomeId(currentBiomeId),
        biomeTextureMaterialForBiomeId(adjacentBiomeId),
      ]).slice(0, 2);
      const result = applyActiveMaterials(currentBiomeId, adjacentBiomeId, activeBiomeMaterials, frameIndex);
      lastX = input.x;
      lastZ = input.z;
      return result;
    },
    forceActiveBiomes(biomeIds) {
      return applyBiomeIds(biomeIds, statsState.lastUpdateFrame + 1);
    },
    currentConfig() {
      return config;
    },
    stats() {
      return { ...statsState, activeBiomeMaterials: [...statsState.activeBiomeMaterials] };
    },
  };
}

function dedupe<T>(values: readonly T[]): T[] {
  const result: T[] = [];
  for (const value of values) {
    if (!result.includes(value)) result.push(value);
  }
  return result;
}
