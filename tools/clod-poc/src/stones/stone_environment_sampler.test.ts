import { describe, expect, it, vi } from "vitest";
import type { EnvironmentQuery, EnvironmentQueryMeta } from "../environment_query/types.js";
import { DEFAULT_STONE_SETTINGS } from "./stone_config.js";
import {
  DEFAULT_STONE_CPU_SAMPLE_HINT_M,
  StoneEnvironmentSampler,
  type LegacyStoneEnvironmentAuthority,
} from "./stone_environment_sampler.js";

const validMeta: EnvironmentQueryMeta = {
  source: "live-terrain",
  revision: 7,
  valid: true,
  cellSizeM: DEFAULT_STONE_CPU_SAMPLE_HINT_M,
};

function query(overrides: Partial<EnvironmentQuery> = {}): EnvironmentQuery {
  return {
    surfaceHeightBestEffort: vi.fn<EnvironmentQuery["surfaceHeightBestEffort"]>((_x, _z, hint) => ({
      height: 10,
      meta: { ...validMeta, cellSizeM: hint ?? 1 },
    })),
    surfaceNormal: vi.fn<EnvironmentQuery["surfaceNormal"]>((_x, _z, hint) => ({
      x: 0.3,
      y: 0.9,
      z: 0.1,
      meta: { ...validMeta, cellSizeM: hint ?? 1 },
    })),
    materialWeights: vi.fn<EnvironmentQuery["materialWeights"]>((_x, _z, hint) => ({
      grass: 0.2,
      rock: 0.5,
      sand: 0.2,
      snow: 0.1,
      meta: { ...validMeta, cellSizeM: hint ?? 1 },
    })),
    water: vi.fn<EnvironmentQuery["water"]>((_x, _z, hint) => ({
      waterY: 11,
      carvedBedY: 9,
      depth: 2,
      wetMask: 1,
      shoreDistanceM: 2,
      bodyKind: 3,
      bodyId: 42,
      meta: { ...validMeta, source: "hydrology-cpu", cellSizeM: hint ?? 1 },
    })),
    river: vi.fn<EnvironmentQuery["river"]>((_x, _z, hint) => ({
      flowX: 1,
      flowZ: 0,
      flowStrength: 0.5,
      bedDrop: 0,
      rapidMask: 0,
      channelCenterWeight: 1,
      bankContactWeight: 0,
      gravelBarMask: 0,
      meta: { ...validMeta, source: "hydrology-cpu", cellSizeM: hint ?? 1 },
    })),
    visibility: vi.fn<EnvironmentQuery["visibility"]>((_x, _z, hint) => ({
      sunVisibility: 1,
      meta: { ...validMeta, source: "sun-visibility-cache", cellSizeM: hint ?? 1 },
    })),
    ...overrides,
  };
}

function legacyAuthority(): LegacyStoneEnvironmentAuthority {
  return {
    surfaceHeight: vi.fn<LegacyStoneEnvironmentAuthority["surfaceHeight"]>(() => 20),
    surfaceNormal: vi.fn<LegacyStoneEnvironmentAuthority["surfaceNormal"]>(() => [0, 1, 0]),
    terrainWeights: vi.fn<LegacyStoneEnvironmentAuthority["terrainWeights"]>(() => [0.4, 0.3, 0.2, 0.1]),
    waterLevel: 4,
  };
}

describe("StoneEnvironmentSampler", () => {
  it("routes every active-query field through one conservative sample hint", () => {
    const active = query();
    const legacy = legacyAuthority();
    const sampler = new StoneEnvironmentSampler({
      readEnvironmentQuery: () => active,
      legacy,
    });

    const sample = sampler.sampleSite(3, 5, DEFAULT_STONE_SETTINGS);

    expect(sample).toMatchObject({
      height: 10,
      grass: 0.2,
      rock: 0.5,
      sand: 0.2,
      snow: 0.1,
      standingWater: true,
    });
    expect(active.surfaceHeightBestEffort).toHaveBeenCalledWith(3, 5, 16);
    expect(active.surfaceNormal).toHaveBeenCalledWith(3, 5, 16);
    expect(active.materialWeights).toHaveBeenCalledWith(3, 5, 16);
    expect(active.water).toHaveBeenCalledWith(3, 5, 16);
    expect(active.river).not.toHaveBeenCalled();
    expect(legacy.surfaceHeight).not.toHaveBeenCalled();
    expect(sampler.getStats()).toEqual({
      environmentSamples: 1,
      fallbackSamples: 0,
      invalidSamples: 0,
    });
  });

  it("fails closed when an active authority is invalid", () => {
    const active = query({
      water: vi.fn<EnvironmentQuery["water"]>((_x, _z, hint) => ({
        waterY: 0,
        carvedBedY: 0,
        depth: 0,
        wetMask: 0,
        shoreDistanceM: 0,
        bodyKind: 0,
        bodyId: null,
        meta: { ...validMeta, source: "hydrology-cpu", valid: false, cellSizeM: hint ?? 1 },
      })),
    });
    const legacy = legacyAuthority();
    const sampler = new StoneEnvironmentSampler({
      readEnvironmentQuery: () => active,
      legacy,
    });

    expect(sampler.sampleSite(1, 2, DEFAULT_STONE_SETTINGS)).toBeNull();
    expect(legacy.surfaceHeight).not.toHaveBeenCalled();
    expect(sampler.getStats()).toEqual({
      environmentSamples: 1,
      fallbackSamples: 0,
      invalidSamples: 1,
    });
  });

  it("uses the legacy terrain authority only when no active query exists", () => {
    const legacy = legacyAuthority();
    const sampler = new StoneEnvironmentSampler({
      readEnvironmentQuery: () => null,
      legacy,
    });

    expect(sampler.sampleSite(4, 6, DEFAULT_STONE_SETTINGS)).toMatchObject({
      height: 20,
      normalY: 1,
      grass: 0.4,
      rock: 0.3,
      sand: 0.2,
      snow: 0.1,
      standingWater: false,
    });
    expect(legacy.surfaceHeight).toHaveBeenCalledWith(4, 6);
    expect(sampler.getStats()).toEqual({
      environmentSamples: 0,
      fallbackSamples: 1,
      invalidSamples: 0,
    });
  });

  it("preserves a configured coarser hint for cliff-height probes", () => {
    const active = query();
    const sampler = new StoneEnvironmentSampler({
      sampleHintM: 48,
      readEnvironmentQuery: () => active,
    });

    expect(sampler.sampleHeight(8, 9)).toBe(10);
    expect(active.surfaceHeightBestEffort).toHaveBeenCalledWith(8, 9, 48);
  });
});
