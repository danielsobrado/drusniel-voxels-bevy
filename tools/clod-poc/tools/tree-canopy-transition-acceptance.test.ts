import { describe, expect, it } from "vitest";
import {
  TREE_CANOPY_TRANSITION_COUNTERS,
  evaluateTreeCanopyTransitionContract,
} from "./tree-canopy-transition-acceptance.js";

describe("tree/canopy transition acceptance", () => {
  it("passes the default handoff math and material contract", () => {
    const result = evaluateTreeCanopyTransitionContract();
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("gates the impostor end distance and complementary handoff", () => {
    const result = evaluateTreeCanopyTransitionContract();
    expect(result.impostorEndM).toBe(760);
    for (const gate of result.gates) {
      expect(gate.treeVisibility + gate.canopyVisibility).toBeCloseTo(1);
    }
    expect(result.material).toEqual({ transparent: false, depthWrite: true, alphaTest: 0 });
  });

  it("documents the GPU acceptance counters", () => {
    expect(TREE_CANOPY_TRANSITION_COUNTERS.length).toBeGreaterThan(0);
  });
});
