import {
  getDigEditRevision,
  type BorderCoastOceanConfig,
  type TerrainFieldConfig,
  type VoxelEditSnapshot,
} from "../../terrain/terrain.js";
import {
  startupHeightfieldDescriptor,
  type StartupHeightfieldRaster,
} from "../../terrain/startup_heightfield_raster.js";
import { buildWorldManifest, withWorldManifestArtifact, type WorldManifest } from "../../world/world_manifest.js";
import type { HydrologyGraphArtifact } from "../../world/hydrology_graph/index.js";
import { buildAcceptanceWorldCacheKey } from "../../cache/index.js";
import {
  buildProceduralTextureHash,
  buildStagedImportHash,
  buildVoxelSnapshotHash,
  type TerrainSourceInputs,
} from "../../cache/terrainSource.js";
import type { ClodPagesConfig } from "../../config.js";
import type { WaterConfig } from "../../water/index.js";
import type { VoxelProjectArchiveContents } from "../../project/voxel_project_archive.js";
import type { WorldModeConfig } from "../world_mode.js";
import type { FeatureStampField } from "../../world/feature_stamps.js";
import type { VoxelOverlaySource } from "../../terrain/terrain.js";
import type { HydrologyCarveConfig } from "./world_build_hydrology_startup.js";

export interface AssembleTerrainSourceResult {
  terrainSource: TerrainSourceInputs;
  acceptanceCacheKey: Awaited<ReturnType<typeof buildAcceptanceWorldCacheKey>>;
  worldManifest: WorldManifest;
}

export async function assembleTerrainSourceInputs(input: {
  cfg: ClodPagesConfig;
  sceneName: string;
  seed: number;
  seaLevel: number;
  terrainFieldConfig: TerrainFieldConfig;
  WORLD: number;
  worldMode: WorldModeConfig;
  hydrologyTerrain: {
    res: number;
    worldCells: number;
    carvedBed: Float32Array;
  } | null;
  startupHeightfield: StartupHeightfieldRaster | null;
  effectiveBorderCoast: BorderCoastOceanConfig;
  waterConfig: WaterConfig;
  unifiedHydrology: boolean;
  proceduralTextureConfig: { enabled: boolean; seed: number; noise: { resolution: number } };
  stagedImport: VoxelProjectArchiveContents | null;
  voxelSnapshot: VoxelEditSnapshot;
  queryLongViewScene: boolean;
  tracedCarveConfig: HydrologyCarveConfig | null;
  featureStamps: FeatureStampField | null | undefined;
  voxelOverlay: VoxelOverlaySource | null;
  heightmapSourceHash: string | null;
}): Promise<AssembleTerrainSourceResult> {
  const {
    cfg,
    sceneName,
    seed,
    seaLevel,
    terrainFieldConfig,
    WORLD,
    worldMode,
    hydrologyTerrain,
    startupHeightfield,
    effectiveBorderCoast,
    waterConfig,
    unifiedHydrology,
    proceduralTextureConfig,
    stagedImport,
    voxelSnapshot,
    queryLongViewScene,
    tracedCarveConfig,
    featureStamps,
    voxelOverlay,
    heightmapSourceHash,
  } = input;

  const proceduralTextureHash = await buildProceduralTextureHash(
    proceduralTextureConfig.enabled,
    proceduralTextureConfig.enabled ? `${proceduralTextureConfig.seed}:${proceduralTextureConfig.noise.resolution}` : null,
  );
  const stagedImportHash = await buildStagedImportHash(stagedImport?.manifest ?? null);
  const voxelSnapshotHash = await buildVoxelSnapshotHash(voxelSnapshot);
  const terrainSource: TerrainSourceInputs = {
    scene: sceneName,
    worldSeed: String(seed),
    terrainFieldConfig,
    worldPages: WORLD,
    worldMode: worldMode.mode,
    borderCoastMode: worldMode.borderCoastEnabled ? "finite_rect" : "none",
    generatorVersion: cfg.meshopt_package_version,
    digRevision: getDigEditRevision(),
    hydrologyTerrain,
    startupHeightfield: startupHeightfieldDescriptor(startupHeightfield),
    borderCoastOceanConfig: effectiveBorderCoast,
    waterConfig: {
      enabled: waterConfig.enabled,
      source: waterConfig.source,
      fakeBodies: { carveTerrain: waterConfig.fakeBodies.carveTerrain },
      hydrology: { enabled: waterConfig.hydrology.enabled, unifiedStartup: unifiedHydrology },
    },
    proceduralTextureEnabled: proceduralTextureConfig.enabled,
    stagedImportHash,
    voxelSnapshotHash,
    proceduralTextureHash,
    longViewScene: queryLongViewScene,
    hydrologyGraphHash: null,
    hydrologyCarve: tracedCarveConfig,
    featureStampHash: featureStamps?.hash ?? null,
    featureStampRevision: featureStamps?.revision ?? 0,
    voxelOverlay,
    heightmapSourceHash,
  };
  const acceptanceCacheKey = await buildAcceptanceWorldCacheKey({ cfg, terrainSource });
  window.__drusnielAcceptanceWorldCacheKey = acceptanceCacheKey;
  const worldManifest = buildWorldManifest({
    worldMode,
    terrainFieldConfig,
    terrainSourceHash: acceptanceCacheKey.terrainSourceHash,
    seaLevelM: seaLevel,
  });
  return { terrainSource, acceptanceCacheKey, worldManifest };
}

/** Second terrainSource mutation + cache/manifest re-key after continent graph install. */
export async function rekeyContinentTerrainSource(input: {
  cfg: ClodPagesConfig;
  terrainSource: TerrainSourceInputs;
  worldMode: WorldModeConfig;
  terrainFieldConfig: TerrainFieldConfig;
  seaLevel: number;
  startupHeightfield: StartupHeightfieldRaster | null;
  hydrologyGraphArtifact: HydrologyGraphArtifact;
  graphCarveConfig: HydrologyCarveConfig;
  voxelOverlay: VoxelOverlaySource | null;
}): Promise<{
  acceptanceCacheKey: Awaited<ReturnType<typeof buildAcceptanceWorldCacheKey>>;
  worldManifest: WorldManifest;
}> {
  const {
    cfg,
    terrainSource,
    worldMode,
    terrainFieldConfig,
    seaLevel,
    startupHeightfield,
    hydrologyGraphArtifact,
    graphCarveConfig,
    voxelOverlay,
  } = input;

  terrainSource.startupHeightfield = startupHeightfieldDescriptor(startupHeightfield);
  terrainSource.hydrologyGraphHash = hydrologyGraphArtifact.ref.hash;
  terrainSource.hydrologyCarve = graphCarveConfig;
  terrainSource.voxelOverlay = voxelOverlay;

  const acceptanceCacheKey = await buildAcceptanceWorldCacheKey({ cfg, terrainSource });
  window.__drusnielAcceptanceWorldCacheKey = acceptanceCacheKey;
  const worldManifest = withWorldManifestArtifact(buildWorldManifest({
    worldMode,
    terrainFieldConfig,
    terrainSourceHash: acceptanceCacheKey.terrainSourceHash,
    seaLevelM: seaLevel,
  }), "hydrologyGraph", hydrologyGraphArtifact.ref);
  return { acceptanceCacheKey, worldManifest };
}
