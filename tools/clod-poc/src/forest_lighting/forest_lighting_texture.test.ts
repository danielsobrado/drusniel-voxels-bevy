import { describe, expect, it } from "vitest";
import type { ForestLightingField } from "./forest_lighting_fields.js";
import {
  createForestLightingTexture,
  sampleActiveForestCanopyEcology,
} from "./forest_lighting_texture.js";

function field(): ForestLightingField {
  return {
    resolution: 2,
    worldCells: 10,
    canopyHeightScaleM: 20,
    canopyDensity: new Float32Array([0, 1, 1, 0]),
    canopyHeightM: new Float32Array([0, 10, 20, 0]),
    broadleafCoverage: new Float32Array([0.2, 0.4, 0.6, 0.8]),
    coniferCoverage: new Float32Array([0.8, 0.6, 0.4, 0.2]),
    competition: new Float32Array([0.1, 0.3, 0.5, 0.7]),
    grassSuppression: new Float32Array([0.15, 0.35, 0.55, 0.75]),
    understoryDensity: new Float32Array([0.1, 0.3, 0.5, 0.7]),
    ambientOcclusion: new Float32Array(4),
    shadowProxy: new Float32Array(4),
    fogDensity: new Float32Array(4),
    sunShaftMask: new Float32Array(4),
    forestEdge: new Float32Array([0.2, 0.4, 0.6, 0.8]),
  };
}

describe("forest canopy ecology texture", () => {
  it("publishes all canonical canopy channels with bilinear sampling", () => {
    const handle = createForestLightingTexture(field());
    try {
      const sample = sampleActiveForestCanopyEcology(5, 5);

      expect(sample).not.toBeNull();
      expect(sample?.canopyDensity).toBeCloseTo(0.5, 2);
      expect(sample?.forestEdge).toBeCloseTo(0.5, 2);
      expect(sample?.understoryDensity).toBeCloseTo(0.4, 2);
      expect(sample?.grassSuppression).toBeCloseTo(0.45, 2);
      expect(sample?.canopyHeightM).toBeCloseTo(7.5, 1);
      expect(sample?.broadleafCoverage).toBeCloseTo(0.5, 2);
      expect(sample?.coniferCoverage).toBeCloseTo(0.5, 2);
      expect(sample?.competition).toBeCloseTo(0.4, 2);
    } finally {
      handle.dispose();
    }
  });

  it("clears the active CPU sampler when the handle is disposed", () => {
    const handle = createForestLightingTexture(field());
    handle.dispose();

    expect(sampleActiveForestCanopyEcology(5, 5)).toBeNull();
  });
});
