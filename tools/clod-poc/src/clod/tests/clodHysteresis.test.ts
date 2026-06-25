import { describe, expect, it } from "vitest";
import { shouldSplitNode, shouldMergeToParent, shouldKeepSplit } from "../runtime/clodHysteresis.js";

describe("clodHysteresis", () => {
  it("splits when error is above threshold", () => {
    expect(shouldSplitNode({ errorPx: 2, thresholdPx: 1 })).toBe(true);
  });

  it("does not split when error is below threshold", () => {
    expect(shouldSplitNode({ errorPx: 0.5, thresholdPx: 1 })).toBe(false);
  });

  it("splits when error equals threshold", () => {
    expect(shouldSplitNode({ errorPx: 1, thresholdPx: 1 })).toBe(false);
  });

  it("merges when error is far below threshold", () => {
    expect(shouldMergeToParent({ parentErrorPx: 0.5, thresholdPx: 1, hysteresisMergeFactor: 1.5 })).toBe(true);
  });

  it("does not merge when error is above merge threshold", () => {
    expect(shouldMergeToParent({ parentErrorPx: 0.8, thresholdPx: 1, hysteresisMergeFactor: 1.5 })).toBe(false);
  });

  it("merge threshold is threshold / factor", () => {
    const factor = 1.5;
    const threshold = 1;
    const mergeAt = threshold / factor;
    expect(shouldMergeToParent({ parentErrorPx: mergeAt, thresholdPx: threshold, hysteresisMergeFactor: factor })).toBe(true);
    expect(shouldMergeToParent({ parentErrorPx: mergeAt + 0.01, thresholdPx: threshold, hysteresisMergeFactor: factor })).toBe(false);
  });

  it("keepSplit is true when was split and error above merge threshold", () => {
    expect(shouldKeepSplit({ wasSplit: true, errorPx: 0.9, thresholdPx: 1, hysteresisMergeFactor: 1.5 })).toBe(true);
  });

  it("keepSplit is false when error falls below merge threshold", () => {
    expect(shouldKeepSplit({ wasSplit: true, errorPx: 0.6, thresholdPx: 1, hysteresisMergeFactor: 1.5 })).toBe(false);
  });

  it("keepSplit is false when was not split", () => {
    expect(shouldKeepSplit({ wasSplit: false, errorPx: 2, thresholdPx: 1, hysteresisMergeFactor: 1.5 })).toBe(false);
  });
});
