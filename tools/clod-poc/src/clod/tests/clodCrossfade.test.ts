import { describe, expect, it } from "vitest";
import { createTransition, computeFadeStates, isTransitionComplete, generateDitherPattern } from "../runtime/clodCrossfade.js";
import type { ClodCut, ClodNodeId } from "../runtime/clodRuntimeTypes.js";
import type { ClodSelectedNode } from "../runtime/clodRuntimeTypes.js";

function makeCut(frame: number, ids: ClodNodeId[]): ClodCut {
  const nodes = new Map<ClodNodeId, ClodSelectedNode>();
  for (const id of ids) {
    nodes.set(id, { nodeId: id, level: 0, errorPx: 0, distanceToCamera: 0, reason: "accepted" });
  }
  return { frame, nodes };
}

describe("clodCrossfade", () => {
  it("no transition when cut unchanged", () => {
    const prev = makeCut(0, ["a", "b"]);
    const next = makeCut(1, ["a", "b"]);
    const result = createTransition({ previousCut: prev, nextCut: next, frame: 1, durationFrames: 12 });
    expect(result).toBeNull();
  });

  it("transition created when nodes change", () => {
    const prev = makeCut(0, ["a", "b"]);
    const next = makeCut(1, ["a", "c"]);
    const result = createTransition({ previousCut: prev, nextCut: next, frame: 1, durationFrames: 12 });
    expect(result).not.toBeNull();
    expect(result!.fromNodeIds).toContain("b");
    expect(result!.toNodeIds).toContain("c");
  });

  it("no transition without previous cut", () => {
    const next = makeCut(0, ["a"]);
    const result = createTransition({ previousCut: null, nextCut: next, frame: 0, durationFrames: 12 });
    expect(result).toBeNull();
  });

  it("no transition with zero duration", () => {
    const prev = makeCut(0, ["a"]);
    const next = makeCut(1, ["b"]);
    const result = createTransition({ previousCut: prev, nextCut: next, frame: 1, durationFrames: 0 });
    expect(result).toBeNull();
  });

  it("added node fades in", () => {
    const prev = makeCut(0, ["a"]);
    const next = makeCut(1, ["a", "b"]);

    const transition = createTransition({ previousCut: prev, nextCut: next, frame: 0, durationFrames: 12 });
    expect(transition).not.toBeNull();

    const fadeStates = computeFadeStates({ activeTransition: transition, stableCut: next, frame: 6 });
    const bState = fadeStates.get("b");
    expect(bState).toBeDefined();
    expect(bState!.ditherRole).toBe("fade-in");
    expect(bState!.fadeAlpha).toBeCloseTo(0.5, 1);
    expect(bState!.visible).toBe(true);
  });

  it("removed node fades out", () => {
    const prev = makeCut(0, ["a", "b"]);
    const next = makeCut(1, ["a"]);

    const transition = createTransition({ previousCut: prev, nextCut: next, frame: 0, durationFrames: 12 });
    expect(transition).not.toBeNull();

    const fadeStates = computeFadeStates({ activeTransition: transition, stableCut: next, frame: 6 });
    const bState = fadeStates.get("b");
    expect(bState).toBeDefined();
    expect(bState!.ditherRole).toBe("fade-out");
    expect(bState!.fadeAlpha).toBeCloseTo(0.5, 1);
  });

  it("stable nodes stay visible", () => {
    const prev = makeCut(0, ["a", "b"]);
    const next = makeCut(1, ["a", "c"]);

    const transition = createTransition({ previousCut: prev, nextCut: next, frame: 0, durationFrames: 12 });
    const fadeStates = computeFadeStates({ activeTransition: transition, stableCut: next, frame: 6 });
    const aState = fadeStates.get("a");
    expect(aState).toBeDefined();
    expect(aState!.ditherRole).toBe("stable");
    expect(aState!.fadeAlpha).toBe(1);
  });

  it("transition completes after configured frames", () => {
    const transition = { id: "t", fromNodeIds: ["b"], toNodeIds: ["c"], startFrame: 0, durationFrames: 12 };
    expect(isTransitionComplete(transition, 11)).toBe(false);
    expect(isTransitionComplete(transition, 12)).toBe(true);
    expect(isTransitionComplete(transition, 20)).toBe(true);
  });

  it("generates deterministic dither pattern", () => {
    const p1 = generateDitherPattern(8);
    const p2 = generateDitherPattern(8);
    expect(p1).toEqual(p2);
    expect(p1.length).toBe(64);
    expect(p1.every((v) => v >= 0 && v < 16)).toBe(true);
  });
});
