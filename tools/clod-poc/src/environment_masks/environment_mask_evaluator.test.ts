import { describe, expect, it, vi } from "vitest";
import type { BiomeVisualState } from "../environment/biome_visual_state.js";
import type {
  EnvironmentQuery,
  EnvironmentQueryMeta,
  NormalQueryResult,
  RiverQueryResult,
  VisibilityQueryResult,
  WaterQueryResult,
} from "../environment_query/types.js";
import { HYDROLOGY_BODY_LAKE, HYDROLOGY_BODY_RIVER } from "../water/hydrologyGrid.js";
import { cloneEnvironmentalMaskSettings } from "./environment_mask_config.js";
import { evaluateEnvironmentalMasks } from "./environment_mask_evaluator.js";

const biome: BiomeVisualState = Object.freeze({
  enabled: true,
  seasonT: 0.9,
  green: 0.8,
  autumn: 0.1,
  bloom: 0.2,
  snowlineM: 70,
  glacialMurkiness: 0.9,
  morningMist: 0.8,
  pollenAmount: 0.4,
  frostAmount: 0.7,
  wetness: 0.65,
});

describe("environmental mask evaluator", () => {
  it("produces river cobble, mist, rapid, mote, frost, dew, and shore masks from shared inputs", () => {
    const query = makeQuery();
    const sample = evaluateEnvironmentalMasks({
      query,
      settings: cloneEnvironmentalMaskSettings(),
      biome,
      x: 12,
      z: 24,
      hintM: 8,
    });

    expect(sample.riverCobble).toBeGreaterThan(0);
    expect(sample.riverMist).toBeGreaterThan(0);
    expect(sample.rapidSplash).toBeGreaterThan(0);
    expect(sample.sunbeamMote).toBeGreaterThan(0);
    expect(sample.calmPool).toBe(0);
    expect(sample.frost).toBeGreaterThan(0);
    expect(sample.dew).toBeGreaterThan(0);
    expect(sample.shoreDebris).toBeGreaterThan(0);
    for (const value of maskValues(sample)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("selects calm pools only for still water bodies", () => {
    const query = makeQuery({
      water: { bodyKind: HYDROLOGY_BODY_LAKE, depth: 1.2, shoreDistanceM: 18 },
      river: { flowStrength: 0.01, bedDrop: 0, rapidMask: 0 },
    });
    const sample = evaluateEnvironmentalMasks({
      query,
      settings: cloneEnvironmentalMaskSettings(),
      biome,
      x: 4,
      z: 9,
    });

    expect(sample.calmPool).toBeGreaterThan(0);
    expect(sample.riverCobble).toBe(0);
    expect(sample.riverMist).toBe(0);
    expect(sample.rapidSplash).toBe(0);
  });

  it("fails individual visibility-driven masks closed when visibility is invalid", () => {
    const query = makeQuery({ visibility: { meta: meta("sun-visibility-cache", false, 9) } });
    const sample = evaluateEnvironmentalMasks({
      query,
      settings: cloneEnvironmentalMaskSettings(),
      biome,
      x: 0,
      z: 0,
    });

    expect(sample.sunbeamMote).toBe(0);
    expect(sample.frost).toBe(0);
    expect(sample.dew).toBeGreaterThan(0);
    expect(sample.meta.validity.visibility).toBe(false);
  });

  it("preserves the caller sampling hint for every authority query", () => {
    const query = makeQuery();
    evaluateEnvironmentalMasks({
      query,
      settings: cloneEnvironmentalMaskSettings(),
      biome,
      x: 32,
      z: 48,
      hintM: 64,
    });

    expect(query.water).toHaveBeenCalledWith(32, 48, 64);
    expect(query.river).toHaveBeenCalledWith(32, 48, 64);
    expect(query.surfaceNormal).toHaveBeenCalledWith(32, 48, 64);
    expect(query.visibility).toHaveBeenCalledWith(32, 48, 64);
    expect(query.surfaceHeightBestEffort).not.toHaveBeenCalled();
    expect(query.materialWeights).not.toHaveBeenCalled();
  });

  it("returns immutable zeros when the shared mask layer or biome state is disabled", () => {
    const settings = cloneEnvironmentalMaskSettings();
    settings.enabled = false;
    const sample = evaluateEnvironmentalMasks({ query: makeQuery(), settings, biome, x: 0, z: 0 });
    expect(maskValues(sample)).toEqual(new Array(8).fill(0));
    expect(Object.isFrozen(sample)).toBe(true);

    const biomeDisabled = { ...biome, enabled: false };
    const second = evaluateEnvironmentalMasks({
      query: makeQuery(),
      settings: cloneEnvironmentalMaskSettings(),
      biome: biomeDisabled,
      x: 0,
      z: 0,
    });
    expect(maskValues(second)).toEqual(new Array(8).fill(0));
  });

  it("publishes the coarsest cell size and newest revision in metadata", () => {
    const query = makeQuery({
      water: { meta: meta("hydrology-atlas", true, 3, 4) },
      river: { meta: meta("hydrology-atlas", true, 7, 16) },
      normal: { meta: meta("live-terrain", true, 5, 2) },
      visibility: { meta: meta("sun-visibility-cache", true, 11, 8) },
    });
    const sample = evaluateEnvironmentalMasks({
      query,
      settings: cloneEnvironmentalMaskSettings(),
      biome,
      x: 1,
      z: 2,
    });

    expect(sample.meta.revision).toBe(11);
    expect(sample.meta.cellSizeM).toBe(16);
  });
});

interface QueryOverrides {
  water?: Partial<WaterQueryResult>;
  river?: Partial<RiverQueryResult>;
  normal?: Partial<NormalQueryResult>;
  visibility?: Partial<VisibilityQueryResult>;
}

function makeQuery(overrides: QueryOverrides = {}): EnvironmentQuery {
  const water: WaterQueryResult = {
    waterY: 6,
    carvedBedY: 5.5,
    depth: 0.5,
    wetMask: 1,
    shoreDistanceM: 3,
    bodyKind: HYDROLOGY_BODY_RIVER,
    bodyId: 4,
    meta: meta("hydrology-atlas", true, 4),
    ...overrides.water,
  };
  const river: RiverQueryResult = {
    flowX: 0.8,
    flowZ: 0.2,
    flowStrength: 0.45,
    bedDrop: 0.8,
    rapidMask: 0.25,
    channelCenterWeight: 0.7,
    bankContactWeight: 0.4,
    gravelBarMask: 0,
    meta: meta("hydrology-atlas", true, 5),
    ...overrides.river,
  };
  const normal: NormalQueryResult = {
    x: 0.1,
    y: 0.9,
    z: 0.1,
    meta: meta("live-terrain", true, 6),
    ...overrides.normal,
  };
  const visibility: VisibilityQueryResult = {
    sunVisibility: 0.62,
    meta: meta("sun-visibility-cache", true, 7),
    ...overrides.visibility,
  };
  return {
    surfaceHeightBestEffort: vi.fn(() => ({ height: 5.5, meta: meta("live-terrain", true, 2) })),
    surfaceNormal: vi.fn(() => normal),
    materialWeights: vi.fn(() => ({ grass: 0.4, rock: 0.3, sand: 0.2, snow: 0.1, meta: meta("live-terrain", true, 2) })),
    water: vi.fn(() => water),
    river: vi.fn(() => river),
    visibility: vi.fn(() => visibility),
  };
}

function meta(
  source: EnvironmentQueryMeta["source"],
  valid: boolean,
  revision: number,
  cellSizeM = 4,
): EnvironmentQueryMeta {
  return { source, valid, revision, cellSizeM };
}

function maskValues(sample: ReturnType<typeof evaluateEnvironmentalMasks>): number[] {
  return [
    sample.riverCobble,
    sample.riverMist,
    sample.rapidSplash,
    sample.sunbeamMote,
    sample.calmPool,
    sample.frost,
    sample.dew,
    sample.shoreDebris,
  ];
}
