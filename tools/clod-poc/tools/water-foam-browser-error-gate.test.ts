import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evaluateWaterFoamBrowserErrorGate,
  isWaterFoamBrowserWarning,
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

  it("captures shader, program, and WebGL warnings", () => {
    for (const message of [
      "THREE.WebGLProgram: Shader Error 0 - VALIDATE_STATUS false",
      "fragment shader compilation failed",
      "program link failed",
      "WebGL context may be lost",
    ]) {
      expect(isWaterFoamBrowserWarning(message), message).toBe(true);
    }
  });

  it("ignores unrelated warnings containing generic words", () => {
    for (const message of [
      "Open this link to learn more",
      "Application program loaded successfully",
      "Compilation completed successfully",
      "The navigation link is deprecated",
    ]) {
      expect(isWaterFoamBrowserWarning(message), message).toBe(false);
    }
  });

  it("uses the same matcher in Node and the injected browser source", () => {
    expect(SOURCE).toContain("WATER_FOAM_BROWSER_WARNING_PATTERN.source");
    expect(SOURCE).toContain("WATER_FOAM_BROWSER_WARNING_PATTERN.flags");
    expect(SOURCE).toContain("const warningPattern = new RegExp");
    expect(SOURCE).toContain("warningPattern.test(message)");
    expect(SOURCE).not.toContain("/webgl|shader|program|compile|link/i");
  });
});
