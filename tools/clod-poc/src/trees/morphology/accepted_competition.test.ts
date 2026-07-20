import { describe, expect, it } from "vitest";
import { createAcceptedTreeCompetitionSampler } from "./accepted_competition.js";
import type { TreeIdentity } from "./types.js";

const identity = (value: number): TreeIdentity => ({ stableIdLo: value, stableIdHi: value * 17 });

const record = (
  value: number,
  x: number,
  z: number,
  crownRadiusM = 4,
) => ({ identity: identity(value), positionXZ: [x, z] as const, crownRadiusM });

describe("accepted tree competition", () => {
  it("returns open-canopy defaults for an isolated accepted tree", () => {
    const sampler = createAcceptedTreeCompetitionSampler([record(1, 0, 0)]);

    expect(sampler.sample(identity(1))).toEqual({
      crownPressure: 0,
      directionalPressure: 0,
      openLightDirectionXZ: [1, 0],
    });
  });

  it("raises pressure and points toward the open side of nearby accepted crowns", () => {
    const sampler = createAcceptedTreeCompetitionSampler([
      record(1, 0, 0),
      record(2, 5, 0),
      record(3, 7, 2),
      record(4, 7, -2),
    ]);
    const sample = sampler.sample(identity(1));

    expect(sample.crownPressure).toBeGreaterThan(0);
    expect(sample.directionalPressure).toBeGreaterThan(0);
    expect(sample.openLightDirectionXZ[0]).toBeLessThan(-0.95);
    expect(Math.abs(sample.openLightDirectionXZ[1])).toBeLessThan(0.05);
  });

  it("is independent of accepted-list order", () => {
    const trees = [
      record(1, 0, 0),
      record(2, 6, 1),
      record(3, -5, 2),
      record(4, 14, -3),
    ];
    const forward = createAcceptedTreeCompetitionSampler(trees).sample(identity(1));
    const reverse = createAcceptedTreeCompetitionSampler([...trees].reverse()).sample(identity(1));

    expect(reverse).toEqual(forward);
  });

  it("ignores accepted trees outside the fixed competition radius", () => {
    const sampler = createAcceptedTreeCompetitionSampler([
      record(1, 0, 0),
      record(2, 32.01, 0, 20),
    ]);

    expect(sampler.sample(identity(1)).crownPressure).toBe(0);
  });

  it("fails fast on duplicate stable identities", () => {
    expect(() => createAcceptedTreeCompetitionSampler([
      record(1, 0, 0),
      record(1, 4, 0),
    ])).toThrow(/duplicate accepted tree identity/);
  });
});
