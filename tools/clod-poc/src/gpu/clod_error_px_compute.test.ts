import { describe, expect, it } from "vitest";
import type { ClodErrorPxStats, DispatchOptions } from "./clod_error_px_compute.js";

describe("DispatchOptions", () => {
  it("has readback boolean field", () => {
    const opts: DispatchOptions = { readback: true };
    expect(opts.readback).toBe(true);
    const optsOff: DispatchOptions = { readback: false };
    expect(optsOff.readback).toBe(false);
  });

  it("is type-compatible with optional parameter", () => {
    const fn = (_params: unknown, _frame: number, options?: DispatchOptions): boolean =>
      options?.readback ?? true;
    expect(fn(null, 0)).toBe(true);
    expect(fn(null, 0, { readback: false })).toBe(false);
    expect(fn(null, 0, { readback: true })).toBe(true);
  });
});

describe("ClodErrorPxStats readback fields", () => {
  it("includes readbackMode, dispatchOnlyFrames, readbackFrames", () => {
    const stats: ClodErrorPxStats = {
      enabled: true,
      available: true,
      status: "idle",
      nodeCount: 100,
      version: 1,
      latestAgeFrames: null,
      submitMs: null,
      readbackMs: null,
      skippedDispatches: 0,
      parity: "unchecked",
      parityMaxDelta: null,
      readbackMode: "async",
      dispatchOnlyFrames: 0,
      readbackFrames: 0,
    };
    expect(stats.readbackMode).toBe("async");
    expect(stats.dispatchOnlyFrames).toBe(0);
    expect(stats.readbackFrames).toBe(0);
  });

  it("readbackMode accepts all three modes", () => {
    for (const mode of ["async", "off", "once"] as const) {
      const stats: ClodErrorPxStats = {
        enabled: true,
        available: true,
        status: "idle",
        nodeCount: 0,
        version: 0,
        latestAgeFrames: null,
        submitMs: null,
        readbackMs: null,
        skippedDispatches: 0,
        parity: "unchecked",
        parityMaxDelta: null,
        readbackMode: mode,
        dispatchOnlyFrames: 0,
        readbackFrames: 0,
      };
      expect(stats.readbackMode).toBe(mode);
    }
  });
});
