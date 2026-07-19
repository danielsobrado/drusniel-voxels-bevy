import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateWaterFoamWebGpuErrorGate } from "./water-foam-webgpu-error-gate.js";

const SOURCE = readFileSync(
  new URL("./water-foam-webgpu-error-gate.ts", import.meta.url),
  "utf8",
);

describe("water foam WebGPU error gate", () => {
  it("accepts a zero counter from startup through final capture", () => {
    const result = evaluateWaterFoamWebGpuErrorGate({
      postStartup: 0,
      postCapture: 0,
    });

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("rejects unavailable counters", () => {
    const result = evaluateWaterFoamWebGpuErrorGate({
      postStartup: null,
      postCapture: null,
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/post-startup.*unavailable/);
    expect(result.failures.join("\n")).toMatch(/post-capture.*unavailable/);
  });

  it("rejects errors that already occurred during startup", () => {
    const result = evaluateWaterFoamWebGpuErrorGate({
      postStartup: 2,
      postCapture: 2,
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/post-startup.*2 did not equal 0/);
  });

  it("rejects errors raised during capture", () => {
    const result = evaluateWaterFoamWebGpuErrorGate({
      postStartup: 0,
      postCapture: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/post-capture.*1 did not equal 0/);
  });

  it("rejects a counter that violates cumulative-session semantics", () => {
    const result = evaluateWaterFoamWebGpuErrorGate({
      postStartup: 3,
      postCapture: 1,
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join("\n")).toMatch(/counter decreased from 3 to 1/);
  });

  it("reads only a non-negative integer from the canonical browser hook", () => {
    expect(SOURCE).toContain("window.__drusnielClod?.stats?.counters?.webgpu_uncaptured_errors");
    expect(SOURCE).toContain("Number.isInteger(value) && value >= 0 ? value : null");
  });
});
