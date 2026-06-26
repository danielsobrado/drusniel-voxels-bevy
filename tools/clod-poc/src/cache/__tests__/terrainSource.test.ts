import { describe, expect, it } from "vitest";
import { DEFAULT_BORDER_COAST_OCEAN_CONFIG } from "../../terrain/border_coast_config.js";
import {
  buildStagedImportHash,
  canonicalizeDigEdits,
  computeTerrainSourceHash,
  hashBorderCoastConfig,
  hashHydrologyTerrain,
  type TerrainSourceInputs,
} from "../terrainSource.js";
import { parseConfig } from "../../config.js";
import configText from "../../../config/clod_pages.yaml?raw";

const baseTerrainSource = (): TerrainSourceInputs => ({
  scene: "default",
  worldSeed: "0",
  worldPages: 8,
  generatorVersion: "0.22.0",
  digRevision: 0,
  hydrologyTerrain: null,
  borderCoastOceanConfig: DEFAULT_BORDER_COAST_OCEAN_CONFIG,
  waterConfig: {
    enabled: false,
    source: "fake_bodies",
    fakeBodies: { carveTerrain: false },
    hydrology: { enabled: false },
  },
  proceduralTextureEnabled: false,
  proceduralTextureHash: null,
  stagedImportHash: null,
  longViewScene: false,
});

describe("terrain source hash", () => {
  it("changes when scene changes", async () => {
    const a = await computeTerrainSourceHash(baseTerrainSource());
    const b = await computeTerrainSourceHash({ ...baseTerrainSource(), scene: "long-view" });
    expect(a).not.toBe(b);
  });

  it("changes when dig revision changes", async () => {
    const a = await computeTerrainSourceHash(baseTerrainSource());
    const b = await computeTerrainSourceHash({ ...baseTerrainSource(), digRevision: 3 });
    expect(a).not.toBe(b);
  });

  it("changes when border coast config changes", async () => {
    const input = baseTerrainSource();
    const a = await computeTerrainSourceHash(input);
    const b = await computeTerrainSourceHash({
      ...input,
      borderCoastOceanConfig: {
        ...input.borderCoastOceanConfig,
        coast: { ...input.borderCoastOceanConfig.coast, oceanStartCells: 999 },
      },
    });
    expect(a).not.toBe(b);
  });

  it("changes when hydrology carved bed changes outside sample window", async () => {
    const bedA = new Float32Array(4096);
    const bedB = new Float32Array(4096);
    bedB[4000] = 1.25;
    const base = {
      res: 64,
      worldCells: 512,
    };
    const a = await hashHydrologyTerrain({ ...base, carvedBed: bedA });
    const b = await hashHydrologyTerrain({ ...base, carvedBed: bedB });
    expect(a).not.toBe(b);
  });
});

describe("staged import hash", () => {
  const cfg = parseConfig(configText);

  it("changes when edits differ but edit count matches", async () => {
    const manifest = {
      worldSize: 8,
      terrainEdits: [{ x: 1, y: 0, z: 1, r: 2 }],
      config: cfg,
    };
    const other = {
      ...manifest,
      terrainEdits: [{ x: 9, y: 0, z: 9, r: 2 }],
    };
    const a = await buildStagedImportHash(manifest);
    const b = await buildStagedImportHash(other);
    expect(a).not.toBe(b);
  });

  it("canonicalizes edit field defaults", () => {
    const canonical = canonicalizeDigEdits([{ x: 1, y: 2, z: 3, r: 4 }]);
    expect(canonical[0]).toMatchObject({
      shape: "sphere",
      op: "remove",
      material: 0,
      height: null,
      strength: null,
      falloff: null,
    });
  });
});

describe("border coast hash", () => {
  it("is stable for identical config", async () => {
    const cfg = baseTerrainSource().borderCoastOceanConfig;
    const a = await hashBorderCoastConfig(cfg);
    const b = await hashBorderCoastConfig(cfg);
    expect(a).toBe(b);
  });
});
