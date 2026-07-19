import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DEBUG_SOURCE = readFileSync(
  new URL("../src/runtime/water_weather/water_controller_debug.ts", import.meta.url),
  "utf8",
);
const RUNNER_SOURCE = readFileSync(new URL("./water-foam-visual-acceptance.ts", import.meta.url), "utf8");

describe("water foam runtime diagnostic wiring", () => {
  it("publishes diagnostics from the browser debug API", () => {
    expect(DEBUG_SOURCE).toContain("getWaterFoamRuntimeDiagnostics");
    expect(DEBUG_SOURCE).toContain("foam: getWaterFoamRuntimeDiagnostics(deps.searchParams)");
  });

  it("records and gates diagnostics in headed acceptance", () => {
    expect(RUNNER_SOURCE).toContain("window.waterDebugInfo().foam");
    expect(RUNNER_SOURCE).toContain("evaluateWaterFoamRuntimeContract");
    expect(RUNNER_SOURCE).toContain("runtimeDiagnostics");
  });
});
