import { describe, expect, it } from "vitest";
import { DEFAULT_HYDROLOGY_CONFIG } from "./hydrologyConfig.js";
import { HYDROLOGY_BODY_RIVER, type HydrologySample } from "./hydrologyGrid.js";
import {
  createGravelBarBedCounters,
  DEFAULT_GRAVEL_BAR_BED_CONFIG,
  evaluateGravelBarBedElevation,
  recordGravelBarBedDecision,
} from "./gravel_bar_bed.js";

const BASE_SAMPLE: HydrologySample = {
  terrainY: 0,
  waterY: 1,
  depth: 1,
  bodyMask: 1,
  lakeMask: 0,
  riverMask: 1,
  flowX: 1,
  flowZ: 0,
  flowStrength: 0.5,
  riverDepth: 1,
  waterYFar: 1,
  moisture: 1,
  bodyKind: HYDROLOGY_BODY_RIVER,
  bodyId: 17,
  shoreDistance: 2,
};

const FIELD_CONFIG = {
  ...DEFAULT_HYDROLOGY_CONFIG.gravelBars,
  enabled: true,
  strength: 1,
};

const BED_CONFIG = {
  ...DEFAULT_GRAVEL_BAR_BED_CONFIG,
  enabled: true,
};

function candidate(sample: HydrologySample = BASE_SAMPLE) {
  for (let z = 0; z <= 32; z += 1) {
    for (let x = 0; x <= 128; x += 1) {
      const result = evaluateGravelBarBedElevation(x, z, sample, FIELD_CONFIG, BED_CONFIG, {
        localBankY: 2,
        channelCenterWeight: sample.bodyMask,
      });
      if (result.mask > 0) return { x, z, result };
    }
  }
  throw new Error("expected deterministic gravel-bar candidate");
}

describe("gravel bar bed elevation", () => {
  it("raises eligible beds without violating wet-depth or continuity reserves", () => {
    const { result } = candidate();
    const finalBedY = BASE_SAMPLE.terrainY + result.elevationOffsetM;

    expect(result.elevationOffsetM).toBeGreaterThan(0);
    expect(result.elevationOffsetM).toBeLessThanOrEqual(BED_CONFIG.maxElevationM);
    expect(BASE_SAMPLE.waterY - finalBedY).toBeGreaterThanOrEqual(
      BED_CONFIG.minWetDepthM + BED_CONFIG.continuityReserveM,
    );
    expect(result.rejection).toBeNull();
  });

  it("rejects shallow candidates before they can dry the channel", () => {
    const shallow = { ...BASE_SAMPLE, waterY: 0.1, depth: 0.1, riverDepth: 0.1 };
    const { x, z } = candidate();
    const result = evaluateGravelBarBedElevation(x, z, shallow, FIELD_CONFIG, BED_CONFIG, {
      localBankY: 2,
      channelCenterWeight: 1,
    });

    expect(result.elevationOffsetM).toBe(0);
    expect(result.rejection).toBe("depth");
  });

  it("rejects a candidate when the local bank cannot safely contain it", () => {
    const { x, z } = candidate();
    const result = evaluateGravelBarBedElevation(x, z, BASE_SAMPLE, FIELD_CONFIG, BED_CONFIG, {
      localBankY: 0.1,
      channelCenterWeight: 0,
    });

    expect(result.elevationOffsetM).toBe(0);
    expect(result.rejection).toBe("bank");
  });

  it("is exact identity while elevation is disabled", () => {
    const { x, z } = candidate();
    const result = evaluateGravelBarBedElevation(
      x,
      z,
      BASE_SAMPLE,
      FIELD_CONFIG,
      { ...BED_CONFIG, enabled: false },
    );

    expect(result.elevationOffsetM).toBe(0);
    expect(result.rejection).toBe("disabled");
  });

  it("records deterministic acceptance and rejection counters", () => {
    const counters = createGravelBarBedCounters();
    const accepted = candidate().result;
    recordGravelBarBedDecision(counters, accepted);
    recordGravelBarBedDecision(counters, {
      mask: 0.8,
      desiredElevationM: 0.4,
      elevationOffsetM: 0,
      rejection: "continuity",
    });

    expect(counters).toMatchObject({
      candidates: 2,
      accepted: 1,
      rejectedContinuity: 1,
    });
    expect(counters.maxElevationM).toBe(accepted.elevationOffsetM);
  });
});
