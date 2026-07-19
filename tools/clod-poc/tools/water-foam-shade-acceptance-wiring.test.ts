import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("./water-foam-shade-acceptance.ts", import.meta.url),
  "utf8",
);

describe("water foam shade acceptance wiring", () => {
  it("uses one discovered rapid pose for both visibility states", () => {
    expect(SOURCE.match(/findWaterShotPose\(/g)).toHaveLength(1);
    expect(SOURCE.match(/setCameraPose\(page, rapidPose\)/g)).toHaveLength(1);
    expect(SOURCE).toContain('"rapid-bed-step"');
  });

  it("captures fully lit then fully shaded and restores the real atlas", () => {
    const lit = SOURCE.indexOf("setFoamSunVisibilityOverride(page, 1)");
    const shaded = SOURCE.indexOf("setFoamSunVisibilityOverride(page, 0)");
    const reset = SOURCE.indexOf("setFoamSunVisibilityOverride(page, null)");

    expect(lit).toBeGreaterThan(0);
    expect(shaded).toBeGreaterThan(lit);
    expect(reset).toBeGreaterThan(shaded);
    expect(SOURCE).toContain("finally {");
    expect(SOURCE).toContain("failed to restore the real sun atlas");
  });

  it("uses one water mask and gates runtime diagnostics", () => {
    expect(SOURCE.match(/deriveWaterPixelMask\(/g)).toHaveLength(1);
    expect(SOURCE).toContain("evaluateWaterFoamShadeAcceptance(metrics)");
    expect(SOURCE).toContain("evaluateWaterFoamRuntimeContract(quality, runtimeDiagnostics)");
  });
});
