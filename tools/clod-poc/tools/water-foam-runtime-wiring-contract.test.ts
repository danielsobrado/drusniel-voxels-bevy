import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DEBUG_SOURCE = readFileSync(
  new URL("../src/runtime/water_weather/water_controller_debug.ts", import.meta.url),
  "utf8",
);
const DIAGNOSTICS_SOURCE = readFileSync(
  new URL("../src/water/water_foam_diagnostics.ts", import.meta.url),
  "utf8",
);
const VISUAL_RUNNER_SOURCE = readFileSync(
  new URL("./water-foam-visual-acceptance.ts", import.meta.url),
  "utf8",
);
const SHADE_RUNNER_SOURCE = readFileSync(
  new URL("./water-foam-shade-acceptance.ts", import.meta.url),
  "utf8",
);
const RUNTIME_CONTRACT_SOURCE = readFileSync(
  new URL("./water-foam-runtime-contract.ts", import.meta.url),
  "utf8",
);

describe("water foam runtime diagnostic wiring", () => {
  it("publishes diagnostics from the browser debug API", () => {
    expect(DEBUG_SOURCE).toContain("getWaterFoamRuntimeDiagnostics");
    expect(DEBUG_SOURCE).toContain("foam: getWaterFoamRuntimeDiagnostics(deps.searchParams)");
  });

  it("records the session-cumulative WebGPU error authority", () => {
    expect(DIAGNOSTICS_SOURCE).toContain("webGpuUncapturedErrorCount");
    expect(DIAGNOSTICS_SOURCE).toContain("webGpuUncapturedErrors: webGpuUncapturedErrorCount()");
    expect(RUNTIME_CONTRACT_SOURCE).toContain(
      'requireEqual(failures, "WebGPU uncaptured errors", diagnostics.webGpuUncapturedErrors, 0)',
    );
  });

  it("gates the same diagnostics in visual and shade acceptance", () => {
    for (const source of [VISUAL_RUNNER_SOURCE, SHADE_RUNNER_SOURCE]) {
      expect(source).toContain("window.waterDebugInfo().foam");
      expect(source).toContain("evaluateWaterFoamRuntimeContract");
      expect(source).toContain("runtimeDiagnostics");
    }
  });
});
