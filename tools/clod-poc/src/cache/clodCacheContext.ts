import type { ClodPagesConfig } from "../config.js";
import type { ClodCacheConfig } from "./cacheConfig.js";
import { parseClodCacheConfig, isCacheEffective } from "./cacheConfig.js";
import type { ClodCacheService } from "./cacheService.js";
import { createClodCacheService } from "./cacheService.js";
import { computeCacheConfigHash } from "./cacheHash.js";
import {
  computeTerrainSourceHash,
  normalizeTerrainSourceInputs,
  type TerrainSourceInputs,
} from "./terrainSource.js";
import type { ClodCacheKeyParts } from "./cacheTypes.js";
import cacheConfigText from "../../config/clod_cache.yaml?raw";
import type { CachePersistenceRole } from "./indexedDbStore.js";

export interface ClodCacheContext {
  config: ClodCacheConfig;
  service: ClodCacheService;
  configHash: string;
  worldSeed: string;
  generatorVersion: string;
  terrainSourceHash: string;
  worldPagesX: number;
  worldPagesZ: number;
  farReduceFactor: number;
  effective: boolean;
}

let activeContext: ClodCacheContext | null = null;

export async function initClodCacheContext(input: {
  cfg: ClodPagesConfig;
  worldPages: number;
  terrainSource: TerrainSourceInputs;
  farReduceFactor?: number;
  cacheConfigText?: string;
  forceDisabled?: boolean;
  role?: CachePersistenceRole;
}): Promise<ClodCacheContext | null> {
  const cacheConfig = parseClodCacheConfig(input.cacheConfigText ?? cacheConfigText);
  if (input.forceDisabled) {
    cacheConfig.enabled = false;
  }

  const terrainSource = normalizeTerrainSourceInputs(input.terrainSource);
  const worldSeed = terrainSource.worldSeed;
  const generatorVersion = input.cfg.meshopt_package_version;
  const terrainSourceHash = await computeTerrainSourceHash(terrainSource);
  const farReduceFactor = input.farReduceFactor ?? 8;
  const configHash = await computeCacheConfigHash(input.cfg, { farReduceFactor });

  const role = input.role ?? (typeof document !== "undefined" ? "main" : "worker");
  const service = createClodCacheService(cacheConfig, undefined, role);
  await service.initialize();

  const ctx: ClodCacheContext = {
    config: cacheConfig,
    service,
    configHash,
    worldSeed,
    generatorVersion,
    terrainSourceHash,
    worldPagesX: input.worldPages,
    worldPagesZ: input.worldPages,
    farReduceFactor,
    effective: isCacheEffective(cacheConfig),
  };
  activeContext = ctx;
  return ctx;
}

export function getClodCacheContext(): ClodCacheContext | null {
  return activeContext;
}

export function buildBaseKeyParts(
  ctx: ClodCacheContext,
  artifactKind: ClodCacheKeyParts["artifactKind"],
  overrides: Partial<ClodCacheKeyParts> = {},
): ClodCacheKeyParts {
  return {
    namespace: ctx.config.namespace,
    schemaVersion: ctx.config.schema_version,
    builderVersion: ctx.config.builder_version,
    artifactKind,
    worldSeed: ctx.worldSeed,
    generatorVersion: ctx.generatorVersion,
    sourceRevision: ctx.terrainSourceHash,
    configHash: ctx.configHash,
    sourceHash: overrides.sourceHash ?? ctx.terrainSourceHash,
    ...overrides,
  };
}

export function pageNodeSourceHash(ctx: ClodCacheContext): string {
  return ctx.terrainSourceHash;
}

/** Clears worker-owned cache artifacts through the worker remote persistent store/RPC path. */
export async function clearWorkerPersistentCache(): Promise<void> {
  const cacheConfig = parseClodCacheConfig(cacheConfigText);
  if (!cacheConfig.persistent.enabled) return;
  const service = createClodCacheService(cacheConfig, undefined, "worker");
  await service.clear();
}
