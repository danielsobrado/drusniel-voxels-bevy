import type { BorderCoastOceanConfig } from "../terrain/border_coast_config.js";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import type { WaterConfig } from "../water/waterConfig.js";
import type { ClodPagesConfig } from "../config.js";
import type { SerializedHydrologyTerrain } from "../clod_worker_protocol.js";
import type { DigEdit, TerrainFieldConfig, VoxelEditSnapshot } from "../terrain/terrain.js";
import type { StartupHeightfieldDescriptor } from "../terrain/startup_heightfield_raster.js";
import type { WorldManifest } from "../world/world_manifest.js";
import type { VoxelOverlaySource } from "../terrain/voxel_overlay/voxel_overlay.js";
import { normalizeVoxelOverlaySource } from "../terrain/voxel_overlay/voxel_overlay.js";
import { sha256Hex } from "./checksum.js";

const textEncoder = new TextEncoder();
// v2: border coast is now disabled for infinite-island fields (islandShape.enabled),
// so page geometry outside the startup world is the true procedural field instead of a
// collapsed sea-level sheet. Bump invalidates any pages cached under the old finite coast.
// v3: vertex weld now merges across quantization buckets within epsilon (fixes internal-seam
// weld misses on streamed roots at large world coordinates); welded geometry can differ.
// v4: unified startup hydrology removes the serialized finite carve from terrain geometry;
// cache identity must distinguish that authority from the legacy carved-grid source.
// v5: unified-mode startup builds sampled all coordinates through the exact-res startup
// heightfield raster, so fractional normal/material queries used bilinear reconstruction.
// v6: the startup raster is now integer-lattice-only. Fractional normal, prop, collider,
// raycast, and CPU fallback samples use the direct procedural field, matching GPU streamed
// roots and removing the raster-domain derivative seam. The descriptor includes the policy.
// v7: continent hydrology graph carving makes canonical f32 heightfield tiles authoritative;
// the graph artifact and carve profile now participate in terrain identity.
// v8: sparse voxel-region references and authored stamp hashes change composed terrain geometry.
// v10: traced-channel semantics changed (longer traces, basin termination, distance-based
// widths), moving every traced river/lake carve; pages cached under v9 traces are stale.
export const TERRAIN_SOURCE_VERSION = "world-modes-v10-traced-river-network";

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

async function hashFloat32Array(arr: Float32Array): Promise<string> {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const copy = bytes.slice();
  return sha256Hex(copy.buffer);
}

function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}

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
  terrainFieldConfig?: TerrainFieldConfig;
  worldPages: number;
  worldPagesX?: number;
  worldPagesZ?: number;
  /** finite | infinite_islands — the explicit world identity (see app/world_mode.ts). */
  worldMode?: string;
  /** finite_rect | none — whether the finite border coast shapes the world edge. */
  borderCoastMode?: string;
  generatorVersion: string;
  digRevision: number;
  hydrologyTerrain: SerializedHydrologyTerrain | null;
  /** Descriptor of the bounded integer-lattice startup cache; null when direct field sampling is used. */
  startupHeightfield?: StartupHeightfieldDescriptor | null;
  borderCoastOceanConfig: BorderCoastOceanConfig;
  waterConfig: Pick<WaterConfig, "enabled" | "source"> & {
    fakeBodies: { carveTerrain: boolean };
    hydrology: { enabled: boolean; unifiedStartup: boolean };
  };
  proceduralTextureEnabled: boolean;
  proceduralTextureHash: string | null;
  stagedImportHash: string | null;
  voxelSnapshotHash?: string | null;
  longViewScene: boolean;
  /** Descriptive identity for worker-side future tile caches. Deliberately excluded from v6 hashing. */
  worldManifest?: WorldManifest;
  hydrologyGraphHash?: string | null;
  hydrologyCarve?: { depthM: number; power: number; lakeBedDepthM: number } | null;
  featureStampHash?: string | null;
  featureStampRevision?: number;
  voxelOverlay?: VoxelOverlaySource | null;
}

export function normalizeTerrainSourceInputs(
  input: TerrainSourceInputs | undefined | null,
): TerrainSourceInputs {
  if (!input) {
    throw new Error("terrainSource is required");
  }
  return {
    scene: input.scene ?? "default",
    worldSeed: input.worldSeed ?? "0",
    terrainFieldConfig: input.terrainFieldConfig,
    worldPages: input.worldPages ?? 0,
    worldPagesX: input.worldPagesX ?? input.worldPages ?? 0,
    worldPagesZ: input.worldPagesZ ?? input.worldPagesX ?? input.worldPages ?? 0,
    worldMode: input.worldMode ?? "finite",
    borderCoastMode: input.borderCoastMode ?? (input.borderCoastOceanConfig?.enabled ? "finite_rect" : "none"),
    generatorVersion: input.generatorVersion ?? "unknown",
    digRevision: input.digRevision ?? 0,
    hydrologyTerrain: input.hydrologyTerrain ?? null,
    startupHeightfield: input.startupHeightfield ?? null,
    borderCoastOceanConfig: input.borderCoastOceanConfig ?? DEFAULT_BORDER_COAST_OCEAN_CONFIG,
    waterConfig: {
      enabled: input.waterConfig?.enabled ?? false,
      source: input.waterConfig?.source ?? "fake_bodies",
      fakeBodies: { carveTerrain: input.waterConfig?.fakeBodies?.carveTerrain ?? false },
      hydrology: {
        enabled: input.waterConfig?.hydrology?.enabled ?? false,
        unifiedStartup: input.waterConfig?.hydrology?.unifiedStartup ?? false,
      },
    },
    proceduralTextureEnabled: input.proceduralTextureEnabled ?? false,
    proceduralTextureHash: input.proceduralTextureHash ?? null,
    stagedImportHash: input.stagedImportHash ?? null,
    voxelSnapshotHash: input.voxelSnapshotHash ?? null,
    longViewScene: input.longViewScene ?? false,
    worldManifest: input.worldManifest,
    hydrologyGraphHash: input.hydrologyGraphHash ?? null,
    hydrologyCarve: input.hydrologyCarve ?? null,
    featureStampHash: input.featureStampHash ?? null,
    featureStampRevision: input.featureStampRevision ?? 0,
    voxelOverlay: normalizeVoxelOverlaySource(input.voxelOverlay),
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
    terrainSourceVersion: TERRAIN_SOURCE_VERSION,
    scene: source.scene,
    worldSeed: source.worldSeed,
    terrainFieldConfig: source.terrainFieldConfig,
    worldPages: source.worldPages,
    worldPagesX: source.worldPagesX,
    worldPagesZ: source.worldPagesZ,
    worldMode: source.worldMode,
    borderCoastMode: source.borderCoastMode,
    generatorVersion: source.generatorVersion,
    digRevision: source.digRevision,
    hydrologyHash,
    hydrologyGraphHash: source.hydrologyGraphHash,
    hydrologyCarve: source.hydrologyCarve,
    featureStampHash: source.featureStampHash,
    featureStampRevision: source.featureStampRevision,
    startupHeightfield: source.startupHeightfield ?? null,
    borderCoastHash,
    water: {
      enabled: source.waterConfig.enabled,
      source: source.waterConfig.source,
      carveTerrain: source.waterConfig.fakeBodies.carveTerrain,
      hydrologyEnabled: source.waterConfig.hydrology.enabled,
      unifiedStartup: source.waterConfig.hydrology.unifiedStartup,
    },
    proceduralTextureEnabled: source.proceduralTextureEnabled,
    proceduralTextureHash: source.proceduralTextureHash,
    stagedImportHash: source.stagedImportHash,
    voxelSnapshotHash: source.voxelSnapshotHash,
    voxelOverlay: source.voxelOverlay,
    longViewScene: source.longViewScene,
  });
}

export async function buildVoxelSnapshotHash(snapshot: VoxelEditSnapshot): Promise<string> {
  const editsCanonical = canonicalizeVoxelEdits(snapshot);
  const editsDigest = await sha256Hex(textEncoder.encode(JSON.stringify(editsCanonical)).buffer);
  return hashJson({
    editCount: snapshot.deltas.length,
    editsRevision: snapshot.revision,
    editsDigest,
  });
}

export async function buildStagedImportHash(manifest: {
  worldSize: number;
  voxelTerrainEdits: VoxelEditSnapshot;
  config: ClodPagesConfig;
} | null): Promise<string | null> {
  if (!manifest) return null;
  const voxelSnapshotHash = await buildVoxelSnapshotHash(manifest.voxelTerrainEdits);
  return hashJson({
    worldSize: manifest.worldSize,
    editCount: manifest.voxelTerrainEdits.deltas.length,
    editsRevision: manifest.voxelTerrainEdits.revision,
    voxelSnapshotHash,
    page: manifest.config.page,
    meshopt: manifest.config.meshopt_package_version,
  });
}

export async function buildProceduralTextureHash(enabled: boolean, recipeKey: string | null): Promise<string | null> {
  if (!enabled || !recipeKey) return null;
  return hashJson({ enabled, recipeKey });
}
