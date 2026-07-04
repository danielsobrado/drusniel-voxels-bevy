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

type IdleScheduler = (callback: () => void) => unknown;

export function biomeTextureMaterialForBiomeId(biomeId: number): BiomeProceduralMaterialId {
  return BIOME_TEXTURE_MATERIAL_BY_ID[normalizeBiomeId(biomeId)];
}

function scheduleIdleTask(callback: () => void): void {
  const host = globalThis as typeof globalThis & { requestIdleCallback?: IdleScheduler };
  if (host.requestIdleCallback) {
    host.requestIdleCallback(callback);
    return;
  }
  setTimeout(callback, 0);
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
  let activeSignature = config.terrain.active_biome_materials.join("|");
  let pendingSignature: string | null = null;
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

  const sampleBiomeId = (x: number, z: number): BiomeId => normalizeBiomeId(deps.sampleBiome(x, z));

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
    const validBiomeIds = dedupe(biomeIds.map(normalizeBiomeId)).slice(0, 2);
    const currentBiomeId = validBiomeIds[0] ?? BIOME_IDS.meadows;
    const adjacentBiomeId = validBiomeIds[1] ?? currentBiomeId;
    const activeBiomeMaterials = validBiomeIds.map(biomeTextureMaterialForBiomeId).slice(0, 2);
    return applyActiveMaterials(currentBiomeId, adjacentBiomeId, activeBiomeMaterials, frameIndex);
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

    if (pendingSignature === signature) {
      return { changed: true, currentBiomeId, adjacentBiomeId, activeBiomeMaterials: nextActive };
    }

    const nextConfig = withActiveBiomeProceduralMaterials(config, nextActive);
    pendingSignature = signature;
    scheduleIdleTask(() => {
      if (pendingSignature !== signature) return;
      const start = performance.now();
      try {
        deps.onActiveWindowChanged(nextConfig, nextConfig.terrain.active_biome_materials);
        config = nextConfig;
        activeSignature = nextConfig.terrain.active_biome_materials.join("|");
        statsState.textureWindowSwaps++;
        statsState.activeBiomeMaterials = [...nextConfig.terrain.active_biome_materials];
        statsState.fallbackBiomeTextureCount = Math.max(0, BIOME_PROCEDURAL_MATERIAL_IDS.length - statsState.activeBiomeMaterials.length);
        statsState.lastRebuildMs = performance.now() - start;
        statsState.lastError = null;
        logger.info?.(`[texture-streaming] terrain biome window ${statsState.activeBiomeMaterials.join(", ")}`);
      } catch (error) {
        statsState.lastError = error instanceof Error ? error.message : String(error);
        logger.error?.("[texture-streaming] failed to rebuild terrain biome texture window", error);
      } finally {
        if (pendingSignature === signature) pendingSignature = null;
      }
    });

    return { changed: true, currentBiomeId, adjacentBiomeId, activeBiomeMaterials: nextActive };
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

function normalizeBiomeId(value: number): BiomeId {
  const rounded = Math.max(0, Math.round(value)) as BiomeId;
  return BIOME_TEXTURE_MATERIAL_BY_ID[rounded] ? rounded : BIOME_IDS.meadows;
}

function dedupe<T>(values: readonly T[]): T[] {
  const result: T[] = [];
  for (const value of values) {
    if (!result.includes(value)) result.push(value);
  }
  return result;
}
