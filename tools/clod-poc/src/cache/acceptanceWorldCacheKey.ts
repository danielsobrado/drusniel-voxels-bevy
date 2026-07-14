import type { ClodPagesConfig } from "../config.js";
import { computeCacheConfigHash } from "./cacheHash.js";
import { computeTerrainSourceHash, normalizeTerrainSourceInputs, type TerrainSourceInputs } from "./terrainSource.js";

export interface AcceptanceWorldCacheKeyInput {
  cfg: ClodPagesConfig;
  terrainSource: TerrainSourceInputs;
  farReduceFactor?: number;
}

export interface AcceptanceWorldCacheKey {
  key: string;
  terrainSourceHash: string;
  configHash: string;
  fields: Record<string, unknown>;
}

export async function buildAcceptanceWorldCacheKey(
  input: AcceptanceWorldCacheKeyInput,
): Promise<AcceptanceWorldCacheKey> {
  const terrainSource = normalizeTerrainSourceInputs(input.terrainSource);
  const farReduceFactor = input.farReduceFactor ?? 8;
  const terrainSourceHash = await computeTerrainSourceHash(terrainSource);
  const configHash = await computeCacheConfigHash(input.cfg, { farReduceFactor });
  const fields: Record<string, unknown> = {
    scene: terrainSource.scene,
    seed: terrainSource.worldSeed,
    worldPages: terrainSource.worldPages,
    worldPagesX: terrainSource.worldPagesX,
    worldPagesZ: terrainSource.worldPagesZ,
    generatorVersion: terrainSource.generatorVersion,
    digRevision: terrainSource.digRevision,
    terrainFieldConfig: terrainSource.terrainFieldConfig,
    hydrologyTerrain: terrainSource.hydrologyTerrain,
    waterConfig: terrainSource.waterConfig,
    borderCoastOceanConfig: terrainSource.borderCoastOceanConfig,
    proceduralTextureEnabled: terrainSource.proceduralTextureEnabled,
    proceduralTextureHash: terrainSource.proceduralTextureHash,
    stagedImportHash: terrainSource.stagedImportHash,
    voxelSnapshotHash: terrainSource.voxelSnapshotHash,
    voxelOverlay: terrainSource.voxelOverlay,
    longViewScene: terrainSource.longViewScene,
    clodPage: input.cfg.page,
    clodSimplify: input.cfg.simplify,
    meshoptPackageVersion: input.cfg.meshopt_package_version,
    farReduceFactor,
    terrainSourceHash,
    configHash,
  };
  return {
    key: `${terrainSourceHash}:${configHash}`,
    terrainSourceHash,
    configHash,
    fields,
  };
}

export function diffAcceptanceWorldCacheKeyFields(
  a: AcceptanceWorldCacheKey,
  b: AcceptanceWorldCacheKey,
): string[] {
  const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
  return [...keys].filter((key) => JSON.stringify(a.fields[key]) !== JSON.stringify(b.fields[key])).sort();
}
