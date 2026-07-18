import { describe, expect, it, vi } from "vitest";
import { createTerrainEditUnderstoryAdapter } from "./terrain_edit_understory_adapter.js";

describe("terrain edit understory adapter", () => {
  it("forwards affected node ids through the canonical rebuild path", () => {
    const rebuildNodePatches = vi.fn();
    const adapter = createTerrainEditUnderstoryAdapter({ rebuildNodePatches });

    expect(adapter).not.toBeNull();
    expect(adapter).not.toHaveProperty("markPatchesDirty");

    adapter!.rebuildNodePatches(["L0:1,2", "L0:2,2"]);

    expect(rebuildNodePatches).toHaveBeenCalledTimes(1);
    expect(rebuildNodePatches).toHaveBeenCalledWith(["L0:1,2", "L0:2,2"]);
  });

  it("preserves a missing optional understory system", () => {
    expect(createTerrainEditUnderstoryAdapter(null)).toBeNull();
  });
});
