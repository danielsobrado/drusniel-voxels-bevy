import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PERF_SOURCE = readFileSync(new URL("./waterPerfNodeMaterial.ts", import.meta.url), "utf8");
const HQ_SOURCE = readFileSync(new URL("./waterNodeMaterial_base.ts", import.meta.url), "utf8");
const FOAM_SOURCE = readFileSync(new URL("./water_foam_nodes.ts", import.meta.url), "utf8");

describe("performance water foam shader contract", () => {
  it("uses the same coherent foam authority as HQ water", () => {
    expect(PERF_SOURCE).toContain("buildWaterFoamNodes");
    expect(HQ_SOURCE).toContain("buildWaterFoamNodes");
    expect(FOAM_SOURCE).toContain("getWaterFoamNoiseTexture");
  });

  it("does not restore the old sine-band foam path", () => {
    expect(PERF_SOURCE).not.toContain("foamWaveA");
    expect(PERF_SOURCE).not.toContain("foamWaveB");
    expect(PERF_SOURCE).not.toContain("foamBreakup");
  });

  it("requires speed and drop together for rapid foam", () => {
    expect(PERF_SOURCE).toContain("rapidSpeed.mul(rapidDrop).mul(riverWeight)");
    expect(PERF_SOURCE).not.toContain("rapidSpeed.mul(0.35).add");
  });

  it("uses two-phase flow advection and variance-normalized breakup", () => {
    expect(PERF_SOURCE).toContain("fract(uTime.mul(uRippleCycle))");
    expect(PERF_SOURCE).toContain("phaseA.sub(0.5)");
    expect(FOAM_SOURCE).toContain(".div(variance)");
  });

  it("lights foam from the water environment instead of flat white", () => {
    expect(PERF_SOURCE).toContain("const waterLuminance");
    expect(PERF_SOURCE).toContain("const litFoam");
    expect(PERF_SOURCE).toContain("mix(lit, litFoam, foam)");
    expect(PERF_SOURCE).not.toContain("mix(lit, uFoam, foam)");
  });

  it("uses the shared camera-distance fade instead of clipmap level", () => {
    expect(PERF_SOURCE).toContain("detailFadeStartM: uFoamDetailFadeStartM");
    expect(PERF_SOURCE).toContain("detailFadeEndM: uFoamDetailFadeEndM");
    expect(PERF_SOURCE).toContain("const foam: TslNode = foamNodes.coverage");
    expect(FOAM_SOURCE).toContain("buildWaterFoamDistanceFadeNode");
    expect(PERF_SOURCE).not.toContain("FAR_FOAM_DETAIL_START_LEVEL");
    expect(PERF_SOURCE).not.toContain("farDetailFade");
  });
});
