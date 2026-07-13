import { TERRAIN_SOURCE_VERSION } from "../cache/terrainSource.js";
import type { WorldMode, WorldModeConfig } from "../app/world_mode.js";
import type { TerrainFieldConfig } from "../terrain/terrain.js";

export interface WorldArtifactRef {
  readonly id: string;
  readonly hash: string;
}

export interface WorldManifest {
  readonly worldId: string;
  readonly seed: number;
  readonly generatorVersion: string;
  readonly terrainSourceHash: string;
  readonly mode: WorldMode;
  readonly sizeM: { readonly x: number; readonly z: number } | null;
  readonly seaLevelM: number;
  readonly startupWorld: {
    readonly pages: number;
    readonly cells: number;
  };
  readonly artifacts: {
    readonly hydrologyGraph?: WorldArtifactRef;
    readonly macroFields?: WorldArtifactRef;
  };
}

export interface BuildWorldManifestInput {
  readonly worldMode: WorldModeConfig;
  readonly terrainFieldConfig: TerrainFieldConfig;
  readonly terrainSourceHash: string;
  readonly worldId?: string;
  readonly generatorVersion?: string;
  readonly seaLevelM?: number;
}

function manifestSizeM(worldMode: WorldModeConfig): { x: number; z: number } | null {
  if (worldMode.mode === "finite") {
    return Object.freeze({
      x: worldMode.configuredWorldCells,
      z: worldMode.configuredWorldCells,
    });
  }
  if (worldMode.proceduralWorldRadiusM === null) return null;
  const diameter = worldMode.proceduralWorldRadiusM * 2;
  return Object.freeze({ x: diameter, z: diameter });
}

export function buildWorldManifest(input: BuildWorldManifestInput): WorldManifest {
  if (!input.terrainSourceHash) throw new Error("terrainSourceHash is required");
  const seed = input.terrainFieldConfig.seed;
  return Object.freeze({
    worldId: input.worldId ?? `ephemeral:${seed}`,
    seed,
    generatorVersion: input.generatorVersion ?? TERRAIN_SOURCE_VERSION,
    terrainSourceHash: input.terrainSourceHash,
    mode: input.worldMode.mode,
    sizeM: manifestSizeM(input.worldMode),
    seaLevelM: input.seaLevelM ?? input.terrainFieldConfig.seaLevel,
    startupWorld: Object.freeze({
      pages: input.worldMode.startupWorldPages,
      cells: input.worldMode.startupWorldCells,
    }),
    artifacts: Object.freeze({}),
  });
}

export function withWorldManifestArtifact(
  manifest: WorldManifest,
  name: keyof WorldManifest["artifacts"],
  artifact: WorldArtifactRef,
): WorldManifest {
  return Object.freeze({
    ...manifest,
    artifacts: Object.freeze({ ...manifest.artifacts, [name]: Object.freeze({ ...artifact }) }),
  });
}
