import { describe, expect, it } from "vitest";
import { resolvePrecisionFrameDelta, precisionDiagnosticUrlOverrides } from "./precision_diagnostics.js";

describe("precision diagnostics", () => {
  it("freezes simulation time only in explicit diagnostic mode", () => {
    expect(resolvePrecisionFrameDelta(1 / 60, false)).toBe(1 / 60);
    expect(resolvePrecisionFrameDelta(1 / 60, true)).toBe(0);
  });

  it("disables animated post effects and fixes exposure for trusted captures", () => {
    expect(precisionDiagnosticUrlOverrides()).toMatchObject({
      precisionDiag: "1",
      freeze: "1",
      clouds: "0",
      froxels: "0",
      treeWind: "0",
      grassWind: "0",
      weather: "off",
      riverCascadeParticles: "0",
      taa: "0",
      taaJitter: "0",
      exposure: "1",
    });
  });
});
