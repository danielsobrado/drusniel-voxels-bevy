import { describe, expect, it } from "vitest";
import { DEFAULT_TREE_SETTINGS, type TreeSettings } from "./tree_config.js";
import { treeGeometryKey } from "./tree_geometry.js";
import { planTreeSystemSettingsUpdate } from "./tree_system_settings_plan.js";

type ShadowMaxLod = TreeSettings["lod"]["shadowsMaxLod"];

// Tearing the GPU ring down destroys buffers the in-flight frame still references, which
// blacks out the view. The shader gates shadow casters on a per-frame uniform, so only a
// change that needs buffers the ring does not have may rebuild.
function planShadowChange(from: ShadowMaxLod, to: ShadowMaxLod) {
  const current: TreeSettings = {
    ...DEFAULT_TREE_SETTINGS,
    lod: { ...DEFAULT_TREE_SETTINGS.lod, shadowsMaxLod: from },
  };
  const patch: Partial<TreeSettings> = { lod: { ...current.lod, shadowsMaxLod: to } };
  return planTreeSystemSettingsUpdate(current, patch, treeGeometryKey(current));
}

describe("tree settings plan — shadow max LOD", () => {
  it("does not rebuild the GPU ring when moving between real LODs", () => {
    for (const [from, to] of [
      ["impostor", "far"],
      ["far", "impostor"],
      ["impostor", "near"],
      ["near", "mid"],
      ["mid", "far"],
    ] as const) {
      const plan = planShadowChange(from, to);
      expect(plan.needsGeometry).toBe(false);
      expect(plan.clearGpuRing).toBe(false);
    }
  });

  it("does not rebuild when disabling shadows: the uniform zeroes the caster capacity", () => {
    for (const from of ["near", "mid", "far", "impostor"] as const) {
      expect(planShadowChange(from, "none").clearGpuRing).toBe(false);
    }
  });

  it("rebuilds when leaving none, where the shadow buffers were never created", () => {
    for (const to of ["near", "mid", "far", "impostor"] as const) {
      expect(planShadowChange("none", to).clearGpuRing).toBe(true);
    }
  });

  it("does not rebuild when the shadow LOD is unchanged", () => {
    expect(planShadowChange("impostor", "impostor").clearGpuRing).toBe(false);
  });
});
