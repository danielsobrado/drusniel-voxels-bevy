import { afterEach, describe, expect, it } from "vitest";
import type { WorldModeConfig } from "../app/world_mode.js";
import {
  TERRAIN_SOURCE_VERSION,
  computeTerrainSourceHash,
  type TerrainSourceInputs,
} from "../cache/terrainSource.js";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../terrain/border_coast_config.js";
import { resolveTerrainFieldConfig } from "../terrain/terrain.js";
import { EROSION_SCHEMA_VERSION } from "./erosion/constants.js";
import {
  clearActiveErodedMacroField,
  getActiveErodedMacroField,
  setActiveErodedMacroField,
  setLatestErosionArtifactRef,
} from "./erosion/integration.js";
import type { ErodedMacroField } from "./erosion/types.js";
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

function erosionField(): ErodedMacroField {
  return {
    width: 2,
    height: 2,
    cellSizeM: 16,
    originX: 0,
    originZ: 0,
    heightFixed: new Int32Array(4),
    hardness: new Uint16Array(4),
    sediment: new Uint32Array(4),
    deposition: new Int32Array(4),
    sampleHeightMeters: () => 0,
  };
}

afterEach(() => {
  clearActiveErodedMacroField();
  setLatestErosionArtifactRef(null);
});

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

  it("clears stale erosion authority when the world identity changes", () => {
    const field = erosionField();
    setActiveErodedMacroField(field, "world-a");
    setLatestErosionArtifactRef({
      schemaVersion: EROSION_SCHEMA_VERSION,
      id: "erosion:test",
      hash: "11".repeat(32),
      width: 2,
      height: 2,
      cellSizeM: 16,
      originX: 0,
      originZ: 0,
      sourceTerrainHash: "22".repeat(32),
      configHash: "33".repeat(32),
    }, "world-a");
    const manifest = buildWorldManifest({
      worldMode: finiteWorldMode,
      terrainFieldConfig,
      terrainSourceHash: "world-b-terrain",
      worldId: "world-b",
    });
    expect(getActiveErodedMacroField()).toBeNull();
    expect(manifest.artifacts.erosion).toBeUndefined();
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
