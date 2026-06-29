import { describe, expect, it } from "vitest";
import { wireTreeRingWgslExpansionSource } from "./wire-tree-ring-wgsl-expansion.mjs";

const FIXTURE = `
import { treeRingSpeciesLayout } from "./tree_ring_species_layout.js";
import { applyTreeRingWgslLayoutConstants } from "./tree_ring_wgsl_layout.js";

export function composeTreeRingShader(workgroupSize = 64): string {
  const size = 64;
  const treeLayout = treeRingSpeciesLayout(TREE_SPECIES.length, TREE_RING_SHADOW_CASCADE_COUNT);
  const treeEntry = applyTreeRingWgslLayoutConstants(withTreeFinalPlacementHeight(withRiverEcologyConstants(treeRingEntry)), treeLayout).replace(
    /const TREE_WORKGROUP_SIZE: u32 = \\d+u;/,
    ` + "`const TREE_WORKGROUP_SIZE: u32 = ${size}u;`" + `,
  );
  return composeShader("tree ring shader", [treeBindings, terrainCommon, placementHeight, treeEntry]);
}
`;

const EDIT_COUNT = 2;

describe("TREE-9 WGSL expansion wiring script", () => {
  it("wires conditional species expansion into the tree shader composer", () => {
    const result = wireTreeRingWgslExpansionSource(FIXTURE);

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(EDIT_COUNT);
    expect(result.source).toContain("applyTreeRingSpeciesWgslExpansion");
    expect(result.source).toContain("const baseTreeEntry = withTreeFinalPlacementHeight");
    expect(result.source).toContain("const expandedTreeEntry = applyTreeRingSpeciesWgslExpansion(baseTreeEntry, TREE_SPECIES.length)");
    expect(result.source).toContain("applyTreeRingWgslLayoutConstants(expandedTreeEntry, treeLayout)");
  });

  it("preserves CRLF output", () => {
    const result = wireTreeRingWgslExpansionSource(FIXTURE.replace(/\n/g, "\r\n"));

    expect(result.changed).toBe(true);
    expect(result.applied).toHaveLength(EDIT_COUNT);
    expect(result.source).toContain("\r\n");
  });

  it("is idempotent", () => {
    const first = wireTreeRingWgslExpansionSource(FIXTURE);
    const second = wireTreeRingWgslExpansionSource(first.source);

    expect(second.changed).toBe(false);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped).toHaveLength(EDIT_COUNT);
  });
});
