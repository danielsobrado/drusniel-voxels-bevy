import { describe, expect, it } from "vitest";
import {
  BOUNDARY_GAP_COUNTERS,
  evaluateBoundaryPropClodEvidence,
  type BoundaryPropClodEvidence,
} from "./contract.js";

function passingEvidence(): BoundaryPropClodEvidence {
  return {
    props: [{
      assetId: "crate_a",
      x: 7424,
      z: 0,
      propY: 48,
      clodY: 47.5,
      coverageHeights: [47.5, 47.6, 47.4, 47.7, 47.3],
    }],
    counters: Object.fromEntries(BOUNDARY_GAP_COUNTERS.map((key) => [key, 0])),
    stream: {
      required: 12,
      pending: 0,
      inflight: 0,
      failed: 0,
      safetyPending: 0,
      safetyInflight: 0,
      activeRoots: 12,
    },
  };
}

describe("boundary prop CLOD contract", () => {
  it("passes grounded props with complete converged coverage", () => {
    const result = evaluateBoundaryPropClodEvidence(passingEvidence());

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.maxVerticalDeltaM).toBeCloseTo(0.5);
    expect(result.uncoveredProbeCount).toBe(0);
  });

  it("fails floating props and missing rendered triangles", () => {
    const evidence = passingEvidence();
    evidence.props[0] = {
      ...evidence.props[0]!,
      propY: 62,
      clodY: 47,
      coverageHeights: [47, null, 47, 47, 47],
    };

    const result = evaluateBoundaryPropClodEvidence(evidence);

    expect(result.passed).toBe(false);
    expect(result.failures.some((failure) => failure.includes("prop/CLOD delta"))).toBe(true);
    expect(result.failures.some((failure) => failure.includes("coverage gap"))).toBe(true);
    expect(result.uncoveredProbeCount).toBe(1);
  });

  it("fails ownership gaps and unfinished CLOD streaming", () => {
    const evidence = passingEvidence();
    evidence.counters["clod_far_gap_holes"] = 2;
    evidence.stream.pending = 1;
    evidence.stream.activeRoots = 0;

    const result = evaluateBoundaryPropClodEvidence(evidence);

    expect(result.passed).toBe(false);
    expect(result.failures).toContain("clod_far_gap_holes=2");
    expect(result.failures).toContain("stream pending=1");
    expect(result.failures).toContain("no active streamed CLOD roots after convergence");
  });
});
