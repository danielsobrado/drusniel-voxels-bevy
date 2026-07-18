import { describe, expect, it } from "vitest";
import {
  createTreeCrownProxyGeometry,
  TREE_CROWN_PROXY_INDEX_COUNT,
} from "../trees/tree_crown_proxy_math.js";
import { composeTreeRingShader } from "./wgsl_modules.js";

describe("tree ring crown proxy shadow contract", () => {
  it("keeps the runtime proxy geometry and generated shader index count aligned", () => {
    const geometry = createTreeCrownProxyGeometry();
    expect(geometry.getIndex()?.count).toBe(TREE_CROWN_PROXY_INDEX_COUNT);

    const source = composeTreeRingShader();
    expect(source).toContain("fn shadow_index_count_for_group(group: u32) -> u32");
    expect(source).toContain(
      `if (lod >= TREE_LOD_FAR) { return ${TREE_CROWN_PROXY_INDEX_COUNT}u; }`,
    );
    expect(source).toContain(
      "shadow_indirect_args[base + 0u] = shadow_index_count_for_group(group);",
    );
    expect(source).not.toContain(
      "shadow_indirect_args[base + 0u] = index_count_for_group(group % TREE_GROUP_COUNT);",
    );

    geometry.dispose();
  });
});
