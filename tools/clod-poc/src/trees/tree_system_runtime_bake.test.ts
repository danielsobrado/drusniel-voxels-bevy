import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { cloneTreeSettings } from "./tree_config.js";
import { TreeSystem } from "./tree_system_runtime.js";

// Guards the bake -> in-place resource swap link: a successful bake must keep the
// active GPU ring alive and replace only its impostor geometry/material resources.
describe("tree system bake ring refresh", () => {
  function bakeContext(result: { supported: boolean; reason: string | null }) {
    const ctx = {
      assets: {
        bakeImpostors: vi.fn(async () => result),
        applyMaterials: vi.fn(),
        replaceImpostorMeshGeometries: vi.fn(),
      },
      refreshGpuRingImpostors: vi.fn(() => true),
      clearGpuRing: vi.fn(),
      updatePatchLods: vi.fn(),
      patches: [],
      meshBoundsState: new WeakMap(),
      lastCenter: new THREE.Vector3(1, 0, 2),
      settings: cloneTreeSettings(),
    };
    return ctx;
  }

  it("refreshes GPU impostors in place and reapplies CPU materials when a bake succeeds", async () => {
    const ctx = bakeContext({ supported: true, reason: null });
    const onSubmittedWorkDone = vi.fn(async () => undefined);

    const result = await TreeSystem.prototype.bakeImpostors.call(ctx as unknown as TreeSystem, {
      backend: { device: { queue: { onSubmittedWorkDone } } },
    });

    expect(result).toEqual({ supported: true, reason: null });
    expect(onSubmittedWorkDone).toHaveBeenCalledTimes(1);
    expect(ctx.refreshGpuRingImpostors).toHaveBeenCalledTimes(1);
    expect(ctx.clearGpuRing).not.toHaveBeenCalled();
    expect(onSubmittedWorkDone.mock.invocationCallOrder[0]).toBeLessThan(ctx.refreshGpuRingImpostors.mock.invocationCallOrder[0]!);
    expect(ctx.assets.applyMaterials).toHaveBeenCalledWith(ctx.patches);
    expect(ctx.assets.replaceImpostorMeshGeometries).toHaveBeenCalledWith(ctx.patches, ctx.meshBoundsState);
    expect(ctx.updatePatchLods).toHaveBeenCalledWith(ctx.lastCenter, ctx.lastCenter);
  });

  it("leaves the GPU ring untouched when the bake is unsupported", async () => {
    const ctx = bakeContext({ supported: false, reason: "unsupported" });

    const result = await TreeSystem.prototype.bakeImpostors.call(ctx as unknown as TreeSystem, {});

    expect(result).toEqual({ supported: false, reason: "unsupported" });
    expect(ctx.refreshGpuRingImpostors).not.toHaveBeenCalled();
    expect(ctx.clearGpuRing).not.toHaveBeenCalled();
    expect(ctx.assets.applyMaterials).not.toHaveBeenCalled();
    expect(ctx.updatePatchLods).not.toHaveBeenCalled();
  });
});
