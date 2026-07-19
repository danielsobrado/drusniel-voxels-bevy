import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  new URL("./water-foam-renderer-matrix.ts", import.meta.url),
  "utf8",
);

describe("water foam renderer matrix wiring", () => {
  it("discovers one canonical WebGPU-high pose set first", () => {
    const canonical = SOURCE.indexOf('renderer: "webgpu",\n    quality: "high"');
    const loop = SOURCE.indexOf("for (const renderer of RENDERERS)");

    expect(canonical).toBeGreaterThan(0);
    expect(loop).toBeGreaterThan(canonical);
    expect(SOURCE).toContain("canonicalReportPath: null");
    expect(SOURCE).toContain("const canonicalReportPath = canonical.poses ? canonical.reportPath : null");
  });

  it("forces renderer and quality on every child and reuses canonical poses", () => {
    expect(SOURCE).toContain("`--renderer=${options.renderer}`");
    expect(SOURCE).toContain("`--quality=${options.quality}`");
    expect(SOURCE).toContain("`--pose-report=${options.canonicalReportPath}`");
    expect(SOURCE).toContain("assertWaterFoamAcceptancePosesMatch(options.canonicalPoses, poses)");
  });

  it("rejects stale reports and validates actual runtime identity", () => {
    const remove = SOURCE.indexOf("rmSync(reportPath, { force: true })");
    const spawn = SOURCE.indexOf("spawnSync(process.execPath");

    expect(remove).toBeGreaterThan(0);
    expect(spawn).toBeGreaterThan(remove);
    expect(SOURCE).toContain("parsed.renderer?.requested !== options.renderer");
    expect(SOURCE).toContain("parsed.renderer?.actual !== options.renderer");
    expect(SOURCE).toContain("parsed.quality !== options.quality");
  });

  it("requires every leg before quality or renderer comparisons", () => {
    expect(SOURCE).toContain("!high?.passed || !low?.passed");
    expect(SOURCE).toContain("!webGpu?.passed || !webGl?.passed");
    expect(SOURCE).toContain("evaluateWaterFoamQualityParity(high.metrics, low.metrics)");
    expect(SOURCE).toContain("evaluateWaterFoamRendererParity(webGpu.metrics, webGl.metrics)");
  });

  it("gates high and low parity for both renderers", () => {
    expect(SOURCE).toContain('legKey("webgpu", "high")');
    expect(SOURCE).toContain('legKey("webgpu", "low")');
    expect(SOURCE).toContain('legKey("webgl", "high")');
    expect(SOURCE).toContain('legKey("webgl", "low")');
    expect(SOURCE).toContain("Object.values(rendererParity).every((result) => result.passed)");
  });

  it("writes the combined report before failing the process", () => {
    const write = SOURCE.indexOf("writeFileSync(reportPath");
    const failure = SOURCE.indexOf("if (!passed) {");

    expect(write).toBeGreaterThan(0);
    expect(failure).toBeGreaterThan(write);
    expect(SOURCE).toContain('join(outRoot, "renderer-matrix-report.json")');
  });
});
