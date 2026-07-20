import { describe, expect, it, vi } from "vitest";
import { createTerrainEditUnderstoryAdapter } from "./terrain_edit_understory_adapter.js";

describe("terrain edit understory adapter", () => {
  it("forwards affected node ids through the canonical CPU rebuild path", () => {
    const rebuildNodePatches = vi.fn();
    const adapter = createTerrainEditUnderstoryAdapter({ rebuildNodePatches });

    expect(adapter).not.toBeNull();
    expect(adapter).not.toHaveProperty("markPatchesDirty");

    adapter!.rebuildNodePatches(["L0:1,2", "L0:2,2"]);

    expect(rebuildNodePatches).toHaveBeenCalledTimes(1);
    expect(rebuildNodePatches).toHaveBeenCalledWith(["L0:1,2", "L0:2,2"]);
  });

  it("keeps the active GPU ring alive while its dispatch hot-syncs terrain edits", () => {
    const rebuildNodePatches = vi.fn();
    const markPatchesDirty = vi.fn();
    const adapter = createTerrainEditUnderstoryAdapter({
      rebuildNodePatches,
      markPatchesDirty,
      getStats: () => ({ gpuStatus: "ring" }),
    });

    adapter!.rebuildNodePatches(["L0:1,2"]);

    expect(markPatchesDirty).toHaveBeenCalledOnce();
    expect(rebuildNodePatches).not.toHaveBeenCalled();
  });

  it("uses the canonical rebuild when the GPU ring is not live", () => {
    const rebuildNodePatches = vi.fn();
    const markPatchesDirty = vi.fn();
    const adapter = createTerrainEditUnderstoryAdapter({
      rebuildNodePatches,
      markPatchesDirty,
      getStats: () => ({ gpuStatus: "fallback-cpu" }),
    });

    adapter!.rebuildNodePatches(["L0:1,2"]);

    expect(rebuildNodePatches).toHaveBeenCalledWith(["L0:1,2"]);
    expect(markPatchesDirty).not.toHaveBeenCalled();
  });

  it("preserves a missing optional understory system", () => {
    expect(createTerrainEditUnderstoryAdapter(null)).toBeNull();
  });
});
