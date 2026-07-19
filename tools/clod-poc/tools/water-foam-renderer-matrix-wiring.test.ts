import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MATRIX_SOURCE = readFileSync(
  new URL("./water-foam-renderer-matrix.ts", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");
const LEG_SOURCE = readFileSync(
  new URL("./water-foam-renderer-matrix-leg.ts", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("water foam renderer matrix wiring", () => {
  it("discovers one canonical WebGPU-high pose set first", () => {
    const canonical = MATRIX_SOURCE.indexOf('renderer: "webgpu",\n    quality: "high"');
    const loop = MATRIX_SOURCE.indexOf("for (const renderer of RENDERERS)");

    expect(canonical).toBeGreaterThan(0);
    expect(loop).toBeGreaterThan(canonical);
    expect(MATRIX_SOURCE).toContain("canonicalReportPath: null");
    expect(MATRIX_SOURCE).toContain(
      "const canonicalReportPath = canonical.poses ? canonical.reportPath : null",
    );
  });

  it("forces renderer and quality on every child and reuses canonical poses", () => {
    expect(LEG_SOURCE).toContain("`--renderer=${options.renderer}`");
    expect(LEG_SOURCE).toContain("`--quality=${options.quality}`");
    expect(LEG_SOURCE).toContain("`--pose-report=${options.canonicalReportPath}`");
    expect(LEG_SOURCE).toContain("assertWaterFoamAcceptancePosesMatch(canonical, poses)");
  });

  it("rejects stale reports, malformed roots, and runtime identity drift", () => {
    const remove = LEG_SOURCE.indexOf("rmSync(reportPath, { force: true })");
    const spawn = LEG_SOURCE.indexOf("spawnSync(process.execPath");

    expect(remove).toBeGreaterThan(0);
    expect(spawn).toBeGreaterThan(remove);
    expect(LEG_SOURCE).toContain("foam acceptance report root must be an object");
    expect(LEG_SOURCE).toContain("report.renderer?.requested !== options.renderer");
    expect(LEG_SOURCE).toContain("report.renderer?.actual !== options.renderer");
    expect(LEG_SOURCE).toContain("report.quality !== options.quality");
  });

  it("requires every leg before quality or renderer comparisons", () => {
    expect(MATRIX_SOURCE).toContain("!high?.passed || !low?.passed");
    expect(MATRIX_SOURCE).toContain("!webGpu?.passed || !webGl?.passed");
    expect(MATRIX_SOURCE).toContain("evaluateWaterFoamQualityParity(high.metrics, low.metrics)");
    expect(MATRIX_SOURCE).toContain("evaluateWaterFoamRendererParity(webGpu.metrics, webGl.metrics)");
  });

  it("gates high and low parity for both renderers", () => {
    expect(MATRIX_SOURCE).toContain('waterFoamRendererMatrixLegKey("webgpu", "high")');
    expect(MATRIX_SOURCE).toContain('waterFoamRendererMatrixLegKey("webgpu", "low")');
    expect(MATRIX_SOURCE).toContain('waterFoamRendererMatrixLegKey("webgl", "high")');
    expect(MATRIX_SOURCE).toContain('waterFoamRendererMatrixLegKey("webgl", "low")');
    expect(MATRIX_SOURCE).toContain("Object.values(rendererParity).every((result) => result.passed)");
  });

  it("clears and rewrites the combined report before failing", () => {
    const remove = MATRIX_SOURCE.indexOf("rmSync(reportPath, { force: true })");
    const write = MATRIX_SOURCE.indexOf("writeFileSync(reportPath");
    const failure = MATRIX_SOURCE.indexOf("if (!passed) {");

    expect(remove).toBeGreaterThan(0);
    expect(write).toBeGreaterThan(remove);
    expect(failure).toBeGreaterThan(write);
    expect(MATRIX_SOURCE).toContain('join(outRoot, "renderer-matrix-report.json")');
  });
});
