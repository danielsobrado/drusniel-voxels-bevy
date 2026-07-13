import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildCanopyTextureSet, buildCanopyTextureSetFromFarSummary, disposeCanopyTextureSet, updateCanopyTextureSetInPlace } from "./canopy_texture.js";
import { parseCanopyShellConfig } from "./canopy_config.js";
import canopyYaml from "../../config/canopy_shell.yaml?raw";
import { buildCanopySummaryTile, tileResolutionForCellSize } from "./canopy_summary_builder.js";
import { buildTerrainSummary } from "../clod/terrain_summary.js";
import { createBlendedTerrainSampler } from "./canopy_terrain_sampler.js";
import { createTreeDistribution } from "./deterministic_tree_distribution.js";
import type { CanopySummaryTile } from "./canopy_types.js";

describe("canopy texture", () => {
  const config = parseCanopyShellConfig(canopyYaml);
  const summary = buildTerrainSummary([], 512, 8);
  const terrain = createBlendedTerrainSampler(summary, 2048);
  const trees = createTreeDistribution(config.treeDistribution, config.seed);
  const tile = buildCanopySummaryTile({
    key: { tileX: 0, tileZ: 0, ring: 0 },
    originX: -256,
    originZ: -256,
    cellSizeM: 8,
    resolution: tileResolutionForCellSize(config.clipmap.tileSizeM, 8),
    config,
    terrainSampler: terrain,
    treeDistribution: trees,
  });

  it("builds canopy textures directly from unified far-summary samples", () => {
    const unifiedConfig = structuredClone(config);
    unifiedConfig.distances.shellEndM = 64;
    const built = buildCanopyTextureSetFromFarSummary({
      provider: {
        sampleHeight: () => 10,
        sampleNormal: () => new THREE.Vector3(0, 1, 0),
        revision: () => 7,
        sampleSummaryInto: (_x, _z, _distance, out) => {
          Object.assign(out, {
            height: 10,
            normalX: 0,
            normalY: 1,
            normalZ: 0,
            material: 1,
            canopyCoverage: 0.5,
            canopyHeightAvg: 26,
            speciesPine: 0.6,
            speciesBroadleaf: 0.3,
            speciesDeadwood: 0.1,
            roughness: 0.4,
          });
          return true;
        },
      },
      config: unifiedConfig,
      centerX: 128,
      centerZ: -64,
    });

    expect(built.hits).toBeGreaterThan(0);
    expect(built.hits).toBeLessThan(built.set.resolution ** 2);
    expect(built.misses).toBe(0);
    expect(built.averageCoverage).toBeGreaterThan(0);
    expect(built.maxCoverage + 1e-6).toBeGreaterThanOrEqual(built.averageCoverage);
    expect(built.set.revision).toBe(7);
    const centerIndex = Math.floor(built.set.resolution / 2) * built.set.resolution
      + Math.floor(built.set.resolution / 2);
    expect((built.set.heightTexture.image.data as Float32Array)[centerIndex]).toBe(26);
    expect((built.set.coverageTexture.image.data as Float32Array)[centerIndex])
      .toBeCloseTo(Math.pow(0.5, unifiedConfig.material.coverageAlphaPower));
    expect((built.set.roughnessTexture.image.data as Float32Array)[centerIndex]).toBeCloseTo(0.4);
    disposeCanopyTextureSet(built.set);
  });

  it("updates fixed texture storage in place", () => {
    const first = buildCanopyTextureSet({ visibleTiles: [tile], config, centerX: 0, centerZ: 0 });
    const second = buildCanopyTextureSet({ visibleTiles: [tile], config, centerX: 128, centerZ: 0 });
    const heightTexture = first.heightTexture;
    const nextRevision = second.revision;

    expect(updateCanopyTextureSetInPlace(first, second)).toBe(true);
    expect(first.heightTexture).toBe(heightTexture);
    expect(first.originX).toBe(second.originX);
    expect(first.revision).toBe(nextRevision);

    disposeCanopyTextureSet(first);
    disposeCanopyTextureSet(second);
  });

  it("clamps coverage values and avoids NaNs", () => {
    const set = buildCanopyTextureSet({
      visibleTiles: [tile],
      config,
      centerX: 0,
      centerZ: 0,
      syntheticFallback: false,
    });
    const cov = set.coverageTexture.image.data as Float32Array;
    expect(summarizeTextureValues(cov)).toMatchObject({ finite: true, minAtLeastZero: true, maxAtMostOne: true });
    expect(set.syntheticFallback).toBe(false);
  });

  it("sanitizes invalid summary cell values before texture upload", { timeout: 60000 }, () => {
    const badTile: CanopySummaryTile = {
      ...tile,
      originX: 0,
      originZ: 0,
      resolution: 1,
      cellSizeM: config.clipmap.tileSizeM,
      cells: [{
        groundHeight: Number.NaN,
        canopyHeight: Number.NaN,
        coverage: -0.25,
        crownRoughness: Number.POSITIVE_INFINITY,
        slope: 0,
        moisture: 0,
        speciesPine: Number.NaN,
        speciesBroadleaf: -2,
        speciesDeadwood: 0,
      }],
    };

    const set = buildCanopyTextureSet({
      visibleTiles: [badTile],
      config,
      centerX: config.distances.shellEndM,
      centerZ: config.distances.shellEndM,
      syntheticFallback: false,
    });

    const height = set.heightTexture.image.data as Float32Array;
    const coverage = set.coverageTexture.image.data as Float32Array;
    const species = set.speciesTexture.image.data as Float32Array;
    const roughness = set.roughnessTexture.image.data as Float32Array;

    expect(summarizeTextureValues(height).finite).toBe(true);
    expect(summarizeTextureValues(coverage)).toMatchObject({ finite: true, minAtLeastZero: true, maxAtMostOne: true });
    expect(summarizeTextureValues(species)).toMatchObject({ finite: true, minAtLeastZero: true, maxAtMostOne: true });
    expect(summarizeTextureValues(roughness)).toMatchObject({ finite: true, minAtLeastZero: true, maxAtMostOne: true });
  });

  it("uses synthetic fallback only when requested", () => {
    const set = buildCanopyTextureSet({
      visibleTiles: [],
      config,
      centerX: 0,
      centerZ: 0,
      syntheticFallback: true,
      terrainSummary: summary,
      farRadius: 1024,
    });
    expect(set.syntheticFallback).toBe(true);
  });
});

function summarizeTextureValues(data: Float32Array): {
  finite: boolean;
  minAtLeastZero: boolean;
  maxAtMostOne: boolean;
} {
  let finite = true;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < data.length; i++) {
    const value = data[i]!;
    if (!Number.isFinite(value)) {
      finite = false;
      continue;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return {
    finite,
    minAtLeastZero: min >= 0,
    maxAtMostOne: max <= 1,
  };
}
