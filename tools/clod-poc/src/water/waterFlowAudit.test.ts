import { describe, expect, it } from "vitest";
import { WaterField, cloneWaterConfig } from "./index.js";

function createRiverField(downstreamDrop: number): WaterField {
  const config = cloneWaterConfig();
  config.source = "fake_bodies";
  config.fakeBodies.lakes = [];
  config.fakeBodies.rivers = [{
    points: [[0, 0], [100, 0]],
    width: 20,
    levelOffset: 4,
    downstreamDrop,
  }];
  return new WaterField(config, { surfaceHeight: () => 10 });
}

describe("water flow audit", () => {
  it("keeps slow rivers below the foam speed and drop thresholds", () => {
    const config = cloneWaterConfig();
    const field = createRiverField(0.1);
    const sample = field.sample(50, 0);

    expect(sample.flow.x).toBeCloseTo(1, 4);
    expect(sample.flow.z).toBeCloseTo(0, 4);
    expect(sample.flow.speed).toBeLessThan(config.visual.foam.speedStart);
    expect(sample.flow.drop).toBeLessThan(config.visual.foam.dropStart);
  });

  it("marks steep rivers as eligible for rapid foam", () => {
    const config = cloneWaterConfig();
    const field = createRiverField(10);
    const sample = field.sample(50, 0);

    expect(sample.flow.x).toBeCloseTo(1, 4);
    expect(sample.flow.z).toBeCloseTo(0, 4);
    expect(sample.flow.speed).toBeGreaterThan(config.visual.foam.speedEnd);
    expect(sample.flow.drop).toBeGreaterThan(config.visual.foam.dropEnd);
  });

  it("fades river flow near banks before the mask reaches dry land", () => {
    const field = createRiverField(6);
    const center = field.sample(50, 0);
    const nearBank = field.sample(50, 8);

    expect(nearBank.bodyMask).toBeGreaterThan(0);
    expect(nearBank.flow.speed).toBeLessThan(center.flow.speed);
    expect(nearBank.flow.drop).toBe(center.flow.drop);
  });

  it("keeps lake and dry samples still", () => {
    const config = cloneWaterConfig();
    config.source = "fake_bodies";
    config.fakeBodies.lakes = [{ center: [50, 50], radius: [25, 25], levelOffset: 2 }];
    config.fakeBodies.rivers = [];
    const field = new WaterField(config, { surfaceHeight: () => 10 });

    expect(field.sample(50, 50).flow.speed).toBe(0);
    expect(field.sample(200, 200).flow.speed).toBe(0);
    expect(field.sample(200, 200).bodyMask).toBe(0);
  });
});
