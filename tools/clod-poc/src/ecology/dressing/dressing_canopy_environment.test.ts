import { describe, expect, it } from "vitest";
import { resolveDressingCanopyEcology } from "./dressing_canopy_environment.js";

describe("dressing canopy ecology", () => {
  it("uses canonical accepted-tree channels when available", () => {
    const result = resolveDressingCanopyEcology({
      canopyDensity: 0.8,
      canopyHeightM: 18,
      broadleafCoverage: 0.65,
      coniferCoverage: 0.25,
      competition: 0.9,
      forestEdge: 0.4,
      understoryDensity: 0.5,
      grassSuppression: 0.85,
    }, {
      forest: 0.1,
      forestEdge: 0.2,
      snowWeight: 0,
    });

    expect(result.forest).toBeCloseTo(0.8);
    expect(result.forestEdge).toBeCloseTo(0.4);
    expect(result.moistureFloor).toBeCloseTo(0.405);
    expect(result.broadleafCoverage).toBeCloseTo(0.65);
    expect(result.coniferCoverage).toBeCloseTo(0.25);
    expect(result.skyExposure).toBeCloseTo(0.325);
    expect(result.sunExposure).toBeCloseTo(0.37);
  });

  it("keeps the deterministic fallback before the canonical field is ready", () => {
    const result = resolveDressingCanopyEcology(null, {
      forest: 0.6,
      forestEdge: 0.3,
      snowWeight: 0.4,
    });

    expect(result.forest).toBeCloseTo(0.6);
    expect(result.broadleafCoverage).toBeCloseTo(0.12);
    expect(result.coniferCoverage).toBeCloseTo(0.45);
    expect(result.skyExposure).toBeCloseTo(0.55);
  });
});
