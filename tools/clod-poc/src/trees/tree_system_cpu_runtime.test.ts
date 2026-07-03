import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { unboundedTreePatchCandidates } from "./tree_system_cpu_runtime.js";

describe("unboundedTreePatchCandidates", () => {
  it("creates deterministic positive-route patch IDs around out-of-world centers", () => {
    const candidates = unboundedTreePatchCandidates(new THREE.Vector3(1500, 0, 300), 64, 64);
    const ids = candidates.map((candidate) => candidate.node.id);

    expect(ids).toContain("tree-unbounded:23,4");
    expect(candidates[0]?.distance).toBeLessThanOrEqual(candidates.at(-1)?.distance ?? Number.POSITIVE_INFINITY);
  });

  it("does not return existing synthetic patches", () => {
    const candidates = unboundedTreePatchCandidates(
      new THREE.Vector3(1500, 0, 300),
      64,
      64,
      new Set(["tree-unbounded:23,4"]),
    );

    expect(candidates.map((candidate) => candidate.node.id)).not.toContain("tree-unbounded:23,4");
  });
});
