import type { BorderCoastOceanConfig } from "../terrain/border_coast_config.js";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import type { WaterConfig } from "../water/waterConfig.js";
import type { ClodPagesConfig } from "../config.js";
import type { SerializedHydrologyTerrain } from "../clod_worker_protocol.js";
import type { DigEdit, VoxelEditSnapshot } from "../terrain/terrain.js";
import { sha256Hex } from "./checksum.js";

const textEncoder = new TextEncoder();

async function hashJson(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  return sha256Hex(textEncoder.encode(json).buffer);
}

/** Sampled digest for large mesh payloads in artifact headers — not used for terrain invalidation. */
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

async function hashFloat32Array(arr: Float32Array): Promise<string> {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const copy = bytes.slice();
  return sha256Hex(copy.buffer);
}

function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Stable dig-edit ordering for cache/debug callers that still key on brush metadata. */
export function canonicalizeDigEdits(edits: readonly DigEdit[]) {
  return edits
    .map((e) => ({
      x: roundCoord(e.x),
      y: roundCoord(e.y),
      z: roundCoord(e.z),
      r: roundCoord(e.r),
      shape: e.shape ?? "sphere",
      op: e.op ?? "remove",
      material: e.material ?? 0,
      height: e.height ?? null,
      strength: e.strength ?? null,
      falloff: e.falloff ?? null,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function canonicalizeVoxelEdits(snapshot: VoxelEditSnapshot) {
  return snapshot.deltas
    .map((delta) => ({
      x: delta.x,
      y: delta.y,
      z: delta.z,
      density: Math.round(delta.density * 1_000_000) / 1_000_000,
      materialSlot: delta.materialSlot ?? null,
      revision: delta.revision,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
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

/** Normalize terrain source fields after worker postMessage (defensive against partial payloads). */
export function normalizeTerrainSourceInputs(
  input: TerrainSourceInputs | undefined | null,
): TerrainSourceInputs {
  if (!input) {
    throw new Error("terrainSource is required for CLOD cache invalidation");
  }
  return {
    scene: input.scene ?? "default",
    worldSeed: input.worldSeed ?? "0",
    worldPages: input.worldPages ?? 0,
    generatorVersion: input.generatorVersion ?? "unknown",
    digRevision: input.digRevision ?? 0,
    hydrologyTerrain: input.hydrologyTerrain ?? null,
    borderCoastOceanConfig: input.borderCoastOceanConfig ?? DEFAULT_BORDER_COAST_OCEAN_CONFIG,
    waterConfig: {
      enabled: input.waterConfig?.enabled ?? false,
      source: input.waterConfig?.source ?? "fake_bodies",
      fakeBodies: { carveTerrain: input.waterConfig?.fakeBodies?.carveTerrain ?? false },
      hydrology: { enabled: input.waterConfig?.hydrology?.enabled ?? false },
    },
    proceduralTextureEnabled: input.proceduralTextureEnabled ?? false,
    proceduralTextureHash: input.proceduralTextureHash ?? null,
    stagedImportHash: input.stagedImportHash ?? null,
    longViewScene: input.longViewScene ?? false,
  };
}

export async function hashHydrologyTerrain(
  terrain: SerializedHydrologyTerrain | null,
): Promise<string | null> {
  if (!terrain) return null;
  const carvedBedHash = await hashFloat32Array(terrain.carvedBed);
  return hashJson({
    res: terrain.res,
    worldCells: terrain.worldCells,
    carvedBedHash,
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
  const source = normalizeTerrainSourceInputs(input);
  const hydrologyHash = await hashHydrologyTerrain(source.hydrologyTerrain);
  const borderCoastHash = await hashBorderCoastConfig(source.borderCoastOceanConfig);
  return hashJson({
    scene: source.scene,
    worldSeed: source.worldSeed,
    worldPages: source.worldPages,
    generatorVersion: source.generatorVersion,
    digRevision: source.digRevision,
    hydrologyHash,
    borderCoastHash,
    water: {
      enabled: source.waterConfig.enabled,
      source: source.waterConfig.source,
      carveTerrain: source.waterConfig.fakeBodies.carveTerrain,
      hydrologyEnabled: source.waterConfig.hydrology.enabled,
    },
    proceduralTextureEnabled: source.proceduralTextureEnabled,
    proceduralTextureHash: source.proceduralTextureHash,
    stagedImportHash: source.stagedImportHash,
    longViewScene: source.longViewScene,
  });
}

export async function buildStagedImportHash(manifest: {
  worldSize: number;
  voxelTerrainEdits: VoxelEditSnapshot;
  config: ClodPagesConfig;
} | null): Promise<string | null> {
  if (!manifest) return null;
  const editsCanonical = canonicalizeVoxelEdits(manifest.voxelTerrainEdits);
  const editsDigest = await sha256Hex(textEncoder.encode(JSON.stringify(editsCanonical)).buffer);
  return hashJson({
    worldSize: manifest.worldSize,
    editCount: manifest.voxelTerrainEdits.deltas.length,
    editsRevision: manifest.voxelTerrainEdits.revision,
    editsDigest,
    page: manifest.config.page,
    meshopt: manifest.config.meshopt_package_version,
  });
}

export async function buildProceduralTextureHash(enabled: boolean, recipeKey: string | null): Promise<string | null> {
  if (!enabled || !recipeKey) return null;
  return hashJson({ enabled, recipeKey });
}
