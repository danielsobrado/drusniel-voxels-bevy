import { describe, expect, it } from "vitest";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import { resolveTerrainFieldConfig } from "../terrain/terrain.js";
import {
  TERRAIN_SOURCE_VERSION,
  computeTerrainSourceHash,
  type TerrainSourceInputs,
} from "../cache/terrainSource.js";
import type { WorldModeConfig } from "../app/world_mode.js";
import { buildWorldManifest, withWorldManifestArtifact } from "./world_manifest.js";

const terrainFieldConfig = resolveTerrainFieldConfig({ seed: 73, seaLevel: 18 });

const finiteWorldMode: WorldModeConfig = {
  mode: "finite",
  configuredWorldPages: 8,
  startupWorldPages: 4,
  configuredWorldCells: 512,
  startupWorldCells: 256,
  proceduralWorldRadiusM: null,
  borderCoastEnabled: true,
  farOwner: "legacy_far_shell",
};

function terrainSource(): TerrainSourceInputs {
  return {
    scene: "default",
    worldSeed: String(terrainFieldConfig.seed),
    terrainFieldConfig,
    worldPages: finiteWorldMode.startupWorldPages,
    worldMode: finiteWorldMode.mode,
    borderCoastMode: "finite_rect",
    generatorVersion: "0.22.0",
    digRevision: 0,
    hydrologyTerrain: null,
    startupHeightfield: null,
    borderCoastOceanConfig: DEFAULT_BORDER_COAST_OCEAN_CONFIG,
    waterConfig: {
      enabled: false,
      source: "fake_bodies",
      fakeBodies: { carveTerrain: false },
      hydrology: { enabled: false, unifiedStartup: false },
    },
    proceduralTextureEnabled: false,
    proceduralTextureHash: null,
    stagedImportHash: null,
    voxelSnapshotHash: null,
    longViewScene: false,
  };
}

describe("world manifest", () => {
  it("is a deterministic, immutable description of the boot identity", async () => {
    const terrainSourceHash = await computeTerrainSourceHash(terrainSource());
    const input = { worldMode: finiteWorldMode, terrainFieldConfig, terrainSourceHash };
    const a = buildWorldManifest(input);
    const b = buildWorldManifest(input);

    expect(a).toEqual(b);
    expect(Object.isFrozen(a)).toBe(true);
    expect(a).toMatchObject({
      worldId: "ephemeral:73",
      seed: 73,
      generatorVersion: TERRAIN_SOURCE_VERSION,
      terrainSourceHash,
      mode: "finite",
      sizeM: { x: 512, z: 512 },
      seaLevelM: 18,
      startupWorld: { pages: 4, cells: 256 },
      artifacts: {},
    });
  });

  it("uses the procedural diameter for a bounded continent and null for unbounded mode", () => {
    const bounded = buildWorldManifest({
      worldMode: { ...finiteWorldMode, mode: "infinite_islands", proceduralWorldRadiusM: 8192, borderCoastEnabled: false },
      terrainFieldConfig,
      terrainSourceHash: "bounded",
    });
    const unbounded = buildWorldManifest({
      worldMode: { ...finiteWorldMode, mode: "infinite_islands", proceduralWorldRadiusM: null, borderCoastEnabled: false },
      terrainFieldConfig,
      terrainSourceHash: "unbounded",
    });

    expect(bounded.sizeM).toEqual({ x: 16_384, z: 16_384 });
    expect(unbounded.sizeM).toBeNull();
  });

  it("immutably attaches a generated artifact", () => {
    const manifest = buildWorldManifest({
      worldMode: finiteWorldMode,
      terrainFieldConfig,
      terrainSourceHash: "terrain",
    });
    const next = withWorldManifestArtifact(manifest, "hydrologyGraph", { id: "graph:1", hash: "abc" });
    expect(manifest.artifacts).toEqual({});
    expect(next.artifacts.hydrologyGraph).toEqual({ id: "graph:1", hash: "abc" });
    expect(Object.isFrozen(next.artifacts)).toBe(true);
  });
});
