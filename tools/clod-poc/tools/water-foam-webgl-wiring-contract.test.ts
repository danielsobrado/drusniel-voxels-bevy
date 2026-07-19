import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const RUNNER_SOURCE = readFileSync(
  new URL("./water-foam-visual-acceptance.ts", import.meta.url),
  "utf8",
);
const DEBUG_SOURCE = readFileSync(
  new URL("../src/runtime/water_weather/water_controller_debug.ts", import.meta.url),
  "utf8",
);
const WEBGL_CONTRACT_SOURCE = readFileSync(
  new URL("./water-foam-webgl-runtime-contract.ts", import.meta.url),
  "utf8",
);

describe("WebGL foam acceptance wiring", () => {
  it("keeps WebGPU as the default renderer", () => {
    expect(RUNNER_SOURCE).toContain('stringArg(args, "renderer", "webgpu")');
    expect(RUNNER_SOURCE).toContain("applyWaterFoamRendererProfile(qualityUrl, renderer)");
  });

  it("fails when the runtime backend differs from the requested backend", () => {
    expect(DEBUG_SOURCE).toContain('rendererBackend: deps.isWebGpu ? "webgpu" : "webgl"');
    expect(RUNNER_SOURCE).toContain("assertRendererBackend(renderer, info.rendererBackend)");
    expect(RUNNER_SOURCE).toContain("requested ${expected} but runtime reported");
  });

  it("uses a separate WebGL runtime contract", () => {
    expect(RUNNER_SOURCE).toContain('renderer === "webgl"');
    expect(RUNNER_SOURCE).toContain("evaluateWaterFoamWebGlRuntimeContract");
    expect(RUNNER_SOURCE).toContain("evaluateWaterFoamRuntimeContract");
  });

  it("does not claim WebGL consumes GPU-only sun-visibility authority", () => {
    expect(WEBGL_CONTRACT_SOURCE).not.toContain("sun atlas valid");
    expect(WEBGL_CONTRACT_SOURCE).not.toContain("sunAtlas.valid");
    expect(WEBGL_CONTRACT_SOURCE).not.toContain("shade coverage floor");
    expect(WEBGL_CONTRACT_SOURCE).not.toContain("shadeCoverageFloor");
    expect(WEBGL_CONTRACT_SOURCE).toContain("CPU field samples");
    expect(WEBGL_CONTRACT_SOURCE).toContain("rapid eligibility");
  });

  it("keeps renderer and quality evidence in separate directories", () => {
    expect(RUNNER_SOURCE).toContain("join(rendererProfile.outputSuffix, profile.outputFolder)");
    expect(RUNNER_SOURCE).toContain('join("shots/water/foam-acceptance", defaultFolder)');
  });

  it("records requested and actual renderers in the report", () => {
    expect(RUNNER_SOURCE).toContain("requested: renderer");
    expect(RUNNER_SOURCE).toContain("actual: info.rendererBackend");
    expect(RUNNER_SOURCE).toContain("schemaVersion: 4");
  });
});
