import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings } from "./tree_config.js";
import { TreeSystem } from "./tree_system_runtime.js";

// Guards the bake -> ring invalidation link: when a bake succeeds the runtime must
// call clearGpuRing() so the GPU ring rebuilds and picks up the now-ready impostor
// atlas (createTreeRingImpostorNodeMaterialHandle). The resource-builder test proves
// the correct handle is chosen given a ready atlas; this proves the rebuild fires.
describe("tree system bake ring invalidation", () => {
  function bakeContext(result: { supported: boolean; reason: string | null }) {
    const ctx = {
      assets: {
        bakeImpostors: vi.fn(async () => result),
        applyMaterials: vi.fn(),
        replaceImpostorMeshGeometries: vi.fn(),
      },
      clearGpuRing: vi.fn(),
      updatePatchLods: vi.fn(),
      patches: [],
      meshBoundsState: new WeakMap(),
      lastCenter: new THREE.Vector3(1, 0, 2),
      settings: cloneTreeSettings(),
    };
    return ctx;
  }

  it("clears the GPU ring and reapplies materials when a bake succeeds", async () => {
    const ctx = bakeContext({ supported: true, reason: null });
    const onSubmittedWorkDone = vi.fn(async () => undefined);

    const result = await TreeSystem.prototype.bakeImpostors.call(ctx as unknown as TreeSystem, {
      backend: { device: { queue: { onSubmittedWorkDone } } },
    });

    expect(result).toEqual({ supported: true, reason: null });
    expect(onSubmittedWorkDone).toHaveBeenCalledTimes(1);
    expect(ctx.clearGpuRing).toHaveBeenCalledTimes(1);
    expect(onSubmittedWorkDone.mock.invocationCallOrder[0]).toBeLessThan(ctx.clearGpuRing.mock.invocationCallOrder[0]!);
    expect(ctx.assets.applyMaterials).toHaveBeenCalledWith(ctx.patches);
    expect(ctx.assets.replaceImpostorMeshGeometries).toHaveBeenCalledWith(ctx.patches, ctx.meshBoundsState);
    expect(ctx.updatePatchLods).toHaveBeenCalledWith(ctx.lastCenter, ctx.lastCenter);
  });

  it("leaves the GPU ring untouched when the bake is unsupported", async () => {
    const ctx = bakeContext({ supported: false, reason: "unsupported" });

    const result = await TreeSystem.prototype.bakeImpostors.call(ctx as unknown as TreeSystem, {});

    expect(result).toEqual({ supported: false, reason: "unsupported" });
    expect(ctx.clearGpuRing).not.toHaveBeenCalled();
    expect(ctx.assets.applyMaterials).not.toHaveBeenCalled();
    expect(ctx.updatePatchLods).not.toHaveBeenCalled();
  });
});
