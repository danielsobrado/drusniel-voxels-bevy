import { describe, expect, it } from "vitest";
import { composeTreeRingShader } from "./wgsl_modules.js";

describe("tree terrain visibility cull", () => {
  it("returns before tree shadow append calls", () => {
    const source = composeTreeRingShader();
    const hiddenReturn = source.indexOf("if (terrain_hidden) { return; }");
    const shadowAppend = source.indexOf("append_shadow_lod_if_active(species, TREE_LOD_NEAR");
    const visibleAppend = source.indexOf("append_lod_if_active(species, TREE_LOD_NEAR");

    expect(hiddenReturn).toBeGreaterThan(-1);
    expect(shadowAppend).toBeGreaterThan(-1);
    expect(visibleAppend).toBeGreaterThan(-1);
    expect(hiddenReturn).toBeLessThan(shadowAppend);
    expect(hiddenReturn).toBeLessThan(visibleAppend);
  });
});
