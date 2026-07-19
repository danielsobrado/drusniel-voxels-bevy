import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateWaterFoamBrowserErrorGate,
  type WaterFoamBrowserError,
} from "./water-foam-browser-error-gate.js";

const SOURCE = readFileSync(
  new URL("./water-foam-browser-error-gate.ts", import.meta.url),
  "utf8",
);

describe("water foam browser error gate", () => {
  it("accepts an error-free browser run", () => {
    expect(evaluateWaterFoamBrowserErrorGate([])).toEqual({
      passed: true,
      failures: [],
    });
  });

  it("fails on every normalized browser error", () => {
    const errors: WaterFoamBrowserError[] = [
      { source: "console", message: "THREE.WebGLProgram: Shader Error" },
      { source: "rejection", message: "pipeline setup failed" },
      { source: "webgl-context", message: "WebGL context lost" },
    ];
    const result = evaluateWaterFoamBrowserErrorGate(errors);

    expect(result.passed).toBe(false);
    expect(result.failures).toEqual([
      "console: THREE.WebGLProgram: Shader Error",
      "rejection: pipeline setup failed",
      "webgl-context: WebGL context lost",
    ]);
  });

  it("installs capture before navigation and keeps the buffer bounded", () => {
    expect(SOURCE).toContain("Page.addScriptToEvaluateOnNewDocument");
    expect(SOURCE).toContain("const MAX_BROWSER_ERRORS = 32");
    expect(SOURCE).toContain("errors.length >= MAX_ERRORS");
    expect(SOURCE).toContain('addEventListener("unhandledrejection"');
    expect(SOURCE).toContain('addEventListener("webglcontextlost"');
  });

  it("captures only shader-specific warnings while recording all console errors", () => {
    expect(SOURCE).toContain("console.error = (...values)");
    expect(SOURCE).toContain("webgl(?:program|shader|context)?");
    expect(SOURCE).toContain("program\\\\s+(?:link|compile)");
    expect(SOURCE).not.toContain("/webgl|shader|program|compile|link/i");
  });
});
