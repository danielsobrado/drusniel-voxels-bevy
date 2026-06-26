import type { ClodPagesConfig } from "../config.js";
import type { ClodCacheConfig } from "./cacheConfig.js";
import { parseClodCacheConfig, isCacheEffective } from "./cacheConfig.js";
import type { ClodCacheService } from "./cacheService.js";
import { createClodCacheService } from "./cacheService.js";
import { computeCacheConfigHash, computePageSourceHash, computeSourceRevisionPoC } from "./cacheHash.js";
import type { ClodCacheKeyParts } from "./cacheTypes.js";
import cacheConfigText from "../../config/clod_cache.yaml?raw";

export interface ClodCacheContext {
  config: ClodCacheConfig;
  service: ClodCacheService;
  configHash: string;
  worldSeed: string;
  generatorVersion: string;
  sourceRevision: string;
  worldPagesX: number;
  worldPagesZ: number;
  farReduceFactor: number;
  effective: boolean;
}

let activeContext: ClodCacheContext | null = null;

export async function initClodCacheContext(input: {
  cfg: ClodPagesConfig;
  worldPages: number;
  worldSeed?: string;
  scene?: string;
  digRevision?: number;
  farReduceFactor?: number;
  cacheConfigText?: string;
  forceDisabled?: boolean;
}): Promise<ClodCacheContext | null> {
  const cacheConfig = parseClodCacheConfig(input.cacheConfigText ?? cacheConfigText);
  if (input.forceDisabled) {
    cacheConfig.enabled = false;
  }

  const worldSeed = input.worldSeed ?? "0";
  const generatorVersion = input.cfg.meshopt_package_version;
  const sourceRevision = await computeSourceRevisionPoC({
    worldSeed,
    scene: input.scene ?? "default",
    worldPages: input.worldPages,
    generatorVersion,
    digRevision: input.digRevision ?? 0,
  });
  const farReduceFactor = input.farReduceFactor ?? 8;
  const configHash = await computeCacheConfigHash(input.cfg, { farReduceFactor });

  const service = createClodCacheService(cacheConfig);
  const ctx: ClodCacheContext = {
    config: cacheConfig,
    service,
    configHash,
    worldSeed,
    generatorVersion,
    sourceRevision,
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
    sourceRevision: ctx.sourceRevision,
    configHash: ctx.configHash,
    sourceHash: overrides.sourceHash ?? ctx.sourceRevision,
    ...overrides,
  };
}

export async function buildPageNodeSourceHash(
  ctx: ClodCacheContext,
  pageX: number,
  pageZ: number,
  lod: number,
): Promise<string> {
  return computePageSourceHash({
    worldSeed: ctx.worldSeed,
    generatorVersion: ctx.generatorVersion,
    worldPagesX: ctx.worldPagesX,
    worldPagesZ: ctx.worldPagesZ,
    sourceRevision: ctx.sourceRevision,
    pageX,
    pageZ,
    lod,
  });
}
