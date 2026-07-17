import { describe, expect, it } from "vitest";
import { defaultSwimConfig } from "./swim_config.js";
import {
  DRY_SWIM_CONTACT,
  applySwimForces,
  resolveSwimContact,
  type SwimContactState,
} from "./swim_locomotion.js";
import type { WaterSample } from "../water/water_authority.js";

function water(surfaceY: number, flow: readonly [number, number] = [0, 0]): WaterSample {
  return {
    state: "water",
    surfaceY,
    bottomY: surfaceY - 8,
    bodyId: "lake:1",
    bodyKind: "lake",
    flow,
    sourceRevision: 1,
  };
}

describe("swim contact hysteresis", () => {
  it("enters above the enter threshold and stays until below the exit threshold", () => {
    const entered = resolveSwimContact(DRY_SWIM_CONTACT, water(0.7), 0, 1.8, defaultSwimConfig);
    expect(entered.mode).toBe("surface");

    const shoreJitter = resolveSwimContact(entered, water(0.5), 0, 1.8, defaultSwimConfig);
    expect(shoreJitter.mode).toBe("surface");

    const exited = resolveSwimContact(shoreJitter, water(0.2), 0, 1.8, defaultSwimConfig);
    expect(exited.mode).toBe("dry");
  });

  it("never treats unknown water as dry", () => {
    const swimming: SwimContactState = {
      mode: "surface",
      submersionM: 0.8,
      bodyId: "lake:1",
      sourceRevision: 1,
    };
    const unknown: WaterSample = {
      state: "unknown",
      surfaceY: Number.NaN,
      bodyId: "",
      bodyKind: "pond",
      flow: [0, 0],
      sourceRevision: 2,
    };

    const contact = resolveSwimContact(swimming, unknown, 0, 1.8, defaultSwimConfig);
    expect(contact.mode).toBe("blocked_unknown");
    expect(contact.bodyId).toBe("lake:1");
  });

  it("classifies deep immersion as submerged", () => {
    const contact = resolveSwimContact(DRY_SWIM_CONTACT, water(2), 0, 1.8, defaultSwimConfig);
    expect(contact.mode).toBe("submerged");
  });
});

describe("swim immersion forces", () => {
  it("pushes a surface swimmer toward the configured immersion", () => {
    const sample = water(2);
    const contact = resolveSwimContact(DRY_SWIM_CONTACT, sample, 1, 1.8, defaultSwimConfig);
    const result = applySwimForces({
      velocity: { x: 0, y: 0, z: 0 },
      desiredX: 0,
      desiredZ: 0,
      ascend: false,
      dive: false,
      capsuleBottomY: 1,
      sample,
      contact,
      stepSeconds: 1 / 120,
      config: defaultSwimConfig,
    });

    expect(result.velocity.y).toBeGreaterThan(0);
    expect(result.targetSubmersionM).toBe(defaultSwimConfig.surfaceSubmersionM);
  });

  it("applies river flow to horizontal velocity", () => {
    const sample = water(2, [3, 0]);
    const contact = resolveSwimContact(DRY_SWIM_CONTACT, sample, 1, 1.8, defaultSwimConfig);
    let velocity = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 120; i++) {
      velocity = applySwimForces({
        velocity,
        desiredX: 0,
        desiredZ: 0,
        ascend: false,
        dive: false,
        capsuleBottomY: 1,
        sample,
        contact,
        stepSeconds: 1 / 120,
        config: defaultSwimConfig,
      }).velocity;
    }
    expect(velocity.x).toBeGreaterThan(1);
    expect(Math.abs(velocity.z)).toBeLessThan(1e-6);
  });

  it("supports explicit ascend and dive controls", () => {
    const sample = water(2);
    const contact = resolveSwimContact(DRY_SWIM_CONTACT, sample, 1, 1.8, defaultSwimConfig);
    const ascend = applySwimForces({
      velocity: { x: 0, y: 0, z: 0 }, desiredX: 0, desiredZ: 0,
      ascend: true, dive: false, capsuleBottomY: 1, sample, contact,
      stepSeconds: 1 / 30, config: defaultSwimConfig,
    });
    const dive = applySwimForces({
      velocity: { x: 0, y: 0, z: 0 }, desiredX: 0, desiredZ: 0,
      ascend: false, dive: true, capsuleBottomY: 1, sample, contact,
      stepSeconds: 1 / 30, config: defaultSwimConfig,
    });

    expect(ascend.velocity.y).toBeGreaterThan(0);
    expect(dive.velocity.y).toBeLessThan(0);
    expect(dive.targetSubmersionM).toBe(defaultSwimConfig.diveSubmersionM);
  });

  it("converges similarly across 60, 30, and 20 fps frame chunking", () => {
    const sample = water(2, [1, 0.25]);
    const contact = resolveSwimContact(DRY_SWIM_CONTACT, sample, 1, 1.8, defaultSwimConfig);
    const simulate = (frameRate: number) => {
      let velocity = { x: 0, y: 0, z: 0 };
      const fixedStep = 1 / 120;
      const stepsPerFrame = 120 / frameRate;
      for (let frame = 0; frame < frameRate * 2; frame++) {
        for (let step = 0; step < stepsPerFrame; step++) {
          velocity = applySwimForces({
            velocity, desiredX: 1, desiredZ: 0, ascend: false, dive: false,
            capsuleBottomY: 1, sample, contact, stepSeconds: fixedStep,
            config: defaultSwimConfig,
          }).velocity;
        }
      }
      return velocity;
    };

    const at60 = simulate(60);
    for (const rate of [30, 20]) {
      const actual = simulate(rate);
      expect(actual.x).toBeCloseTo(at60.x, 10);
      expect(actual.y).toBeCloseTo(at60.y, 10);
      expect(actual.z).toBeCloseTo(at60.z, 10);
    }
  });
});
