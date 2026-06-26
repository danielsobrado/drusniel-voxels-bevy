import type { BorderCoastOceanConfig } from "../terrain/border_coast_config.js";
import type { WaterConfig } from "../water/waterConfig.js";
import type { ClodPagesConfig } from "../config.js";
import type { SerializedHydrologyTerrain } from "../clod_worker_protocol.js";
import { sha256Hex } from "./checksum.js";

const textEncoder = new TextEncoder();

async function hashJson(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  return sha256Hex(textEncoder.encode(json).buffer);
}

export async function lightweightArrayDigest(arr: ArrayLike<number>): Promise<string> {
  const len = arr.length;
  if (len === 0) return "empty";
  const sampleCount = Math.min(64, len);
  const step = Math.max(1, Math.floor(len / sampleCount));
  const samples: number[] = [];
  let sum = 0;
  for (let i = 0; i < len; i += step) {
    const v = arr[i]!;
    samples.push(v);
    sum += v;
  }
  return hashJson({ len, sum, samples });
}

export interface TerrainSourceInputs {
  scene: string;
  worldSeed: string;
  worldPages: number;
  generatorVersion: string;
  digRevision: number;
  hydrologyTerrain: SerializedHydrologyTerrain | null;
  borderCoastOceanConfig: BorderCoastOceanConfig;
  waterConfig: Pick<WaterConfig, "enabled" | "source"> & {
    fakeBodies: { carveTerrain: boolean };
    hydrology: { enabled: boolean };
  };
  proceduralTextureEnabled: boolean;
  proceduralTextureHash: string | null;
  stagedImportHash: string | null;
  longViewScene: boolean;
}

export async function hashHydrologyTerrain(
  terrain: SerializedHydrologyTerrain | null,
): Promise<string | null> {
  if (!terrain) return null;
  const bedDigest = await lightweightArrayDigest(terrain.carvedBed);
  return hashJson({
    res: terrain.res,
    worldCells: terrain.worldCells,
    bedDigest,
  });
}

export async function hashBorderCoastConfig(config: BorderCoastOceanConfig): Promise<string> {
  return hashJson({
    enabled: config.enabled,
    coast: config.coast,
    ocean: config.ocean,
    deepOcean: config.deepOcean,
  });
}

export async function computeTerrainSourceHash(input: TerrainSourceInputs): Promise<string> {
  const hydrologyHash = await hashHydrologyTerrain(input.hydrologyTerrain);
  const borderCoastHash = await hashBorderCoastConfig(input.borderCoastOceanConfig);
  return hashJson({
    scene: input.scene,
    worldSeed: input.worldSeed,
    worldPages: input.worldPages,
    generatorVersion: input.generatorVersion,
    digRevision: input.digRevision,
    hydrologyHash,
    borderCoastHash,
    water: {
      enabled: input.waterConfig.enabled,
      source: input.waterConfig.source,
      carveTerrain: input.waterConfig.fakeBodies.carveTerrain,
      hydrologyEnabled: input.waterConfig.hydrology.enabled,
    },
    proceduralTextureEnabled: input.proceduralTextureEnabled,
    proceduralTextureHash: input.proceduralTextureHash,
    stagedImportHash: input.stagedImportHash,
    longViewScene: input.longViewScene,
  });
}

export async function buildStagedImportHash(manifest: {
  worldSize: number;
  terrainEdits: unknown[];
  config: ClodPagesConfig;
} | null): Promise<string | null> {
  if (!manifest) return null;
  return hashJson({
    worldSize: manifest.worldSize,
    editCount: manifest.terrainEdits.length,
    page: manifest.config.page,
    meshopt: manifest.config.meshopt_package_version,
  });
}

export async function buildProceduralTextureHash(enabled: boolean, recipeKey: string | null): Promise<string | null> {
  if (!enabled || !recipeKey) return null;
  return hashJson({ enabled, recipeKey });
}
