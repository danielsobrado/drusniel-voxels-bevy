import { describe, expect, it } from "vitest";
import { createGrassSuppressionField } from "./grass_suppression.js";

describe("grass suppression contact bands", () => {
  it("keeps the legacy radius as an inner-only suppression disc", () => {
    const field = createGrassSuppressionField();
    field.set("legacy", { x: 0, z: 0, radiusM: 2, weight: 0.75 });

    expect(field.sampleContact(0, 0)).toEqual({ density: 0.25, trample: 0.75 });
    expect(field.sampleContact(3, 0)).toEqual({ density: 1, trample: 0 });
  });

  it("preserves density while exposing a smooth outer trample band", () => {
    const field = createGrassSuppressionField();
    field.set("stone", {
      x: 0,
      z: 0,
      innerRadiusM: 1,
      outerRadiusM: 3,
      weight: 1,
    });

    expect(field.sampleContact(0, 0)).toEqual({ density: 0, trample: 1 });
    const band = field.sampleContact(2, 0);
    expect(band.density).toBe(1);
    expect(band.trample).toBeCloseTo(0.5);
    expect(field.sampleContact(3, 0)).toEqual({ density: 1, trample: 0 });
  });

  it("rejects inverted contact radii", () => {
    const field = createGrassSuppressionField();
    expect(() => field.set("invalid", {
      x: 0,
      z: 0,
      innerRadiusM: 2,
      outerRadiusM: 1,
      weight: 1,
    })).toThrow(/outer radius/i);
  });
});
